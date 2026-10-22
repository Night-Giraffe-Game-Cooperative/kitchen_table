defmodule Family.Calendar.Microsoft do
  @moduledoc """
  Outlook calendars (Outlook.com, Hotmail, Microsoft 365) through Microsoft
  Graph, for calendars linked through a Microsoft account someone signed in
  to. Graph works out repeating events too, so they come one occurrence at a
  time, as Google's do.

  The family's own bits of an event (its emoji and who it's for) ride along
  as extended properties under the app's own name.
  """

  alias Family.Calendar.{Connect, Event, Remote}

  @set "{3f6d2b8e-5c1a-4e9b-a7d0-6b2c9e4f1a83}"
  @emoji "String #{@set} Name KitchenTableEmoji"
  @who "String #{@set} Name KitchenTableWho"

  defp api(path), do: Connect.url(:microsoft_graph) <> path

  @doc "The account's calendars: `%{url, name, color, writable}`, `url` being Graph's ID for it."
  def calendars(token) do
    first = api("/me/calendars?" <> URI.encode_query(%{"$top" => 100, "$select" => "id,name,hexColor,canEdit,isDefaultCalendar"}, :rfc3986))

    with {:ok, items} <- Remote.pages(first, token, "value", & &1["@odata.nextLink"]) do
      calendars =
        for c <- items, is_binary(c["id"]) do
          %{
            url: c["id"],
            name: (c["name"] || "Calendar") |> String.slice(0, 60),
            color: color(c["hexColor"]),
            writable: c["canEdit"] == true,
            default: c["isDefaultCalendar"] == true
          }
        end

      {:ok, Enum.sort_by(calendars, &if(&1.default, do: 0, else: 1)) |> Enum.map(&Map.delete(&1, :default))}
    end
  end

  defp color("#" <> hex = c) when byte_size(hex) == 6, do: String.downcase(c)
  defp color(_), do: nil

  @doc "Every occurrence between two days, as rows for Family.Calendar.Links."
  def events(token, calendar, %Date{} = from, %Date{} = to, zone) do
    first =
      api("/me/calendars/" <> Remote.segment(calendar) <> "/calendarView?") <>
        URI.encode_query(%{
          "startDateTime" => "#{Date.to_iso8601(from)}T00:00:00Z",
          "endDateTime" => "#{Date.to_iso8601(Date.add(to, 1))}T00:00:00Z",
          "$top" => 500,
          "$select" => "id,iCalUId,subject,body,location,start,end,isAllDay,isCancelled,type,originalStart",
          "$expand" => "singleValueExtendedProperties($filter=id eq '#{@emoji}' or id eq '#{@who}')"
        }, :rfc3986)

    # Times in UTC, and notes as plain text rather than Outlook's HTML.
    headers = [{"prefer", ~s(outlook.timezone="UTC", outlook.body-content-type="text")}]

    with {:ok, items} <- Remote.pages(first, token, "value", & &1["@odata.nextLink"], headers) do
      {:ok, for(item <- items, item["isCancelled"] != true, row = row(item, zone), row != nil, do: row)}
    end
  end

  @doc false
  def row(item, zone) do
    own = Map.new(item["singleValueExtendedProperties"] || [], &{&1["id"], &1["value"]})
    recurring = item["type"] in ["occurrence", "exception"]

    base = %{
      uid: item["iCalUId"] || item["id"],
      key: if(recurring, do: item["originalStart"] || get_in(item, ["start", "dateTime"]) || "", else: ""),
      recurring: recurring,
      title: Remote.title(item["subject"]),
      notes: Remote.text(get_in(item, ["body", "content"])),
      location: get_in(item, ["location", "displayName"]) |> Remote.blank() |> Remote.slice(255),
      emoji: (own[@emoji] |> Remote.blank() |> Remote.slice(16)) || "📅",
      who: Remote.who(own[@who]),
      remote_href: item["id"],
      remote_etag: item["@odata.etag"]
    }

    with {:ok, starts} <- moment(item["start"]),
         {:ok, ends} <- moment(item["end"]) do
      if item["isAllDay"] do
        first = day(starts)
        last = Date.add(day(ends), -1)
        last = if Date.compare(last, first) == :lt, do: first, else: last
        Map.merge(base, %{all_day: true, start_date: first, end_date: last, starts_at: nil, ends_at: nil, time_zone: zone})
      else
        ends = if DateTime.compare(ends, starts) == :lt, do: starts, else: ends
        Map.merge(base, %{all_day: false, start_date: nil, end_date: nil, starts_at: starts, ends_at: ends, time_zone: zone})
      end
    else
      _ -> nil
    end
  end

  # Graph writes "2026-10-24T09:00:00.0000000" with the zone apart; asked for UTC, that's UTC.
  defp moment(%{"dateTime" => t} = m) when is_binary(t) do
    naive = t |> String.replace(~r/\.\d+$/, "") |> String.replace(~r/Z$/, "")

    with {:ok, n} <- NaiveDateTime.from_iso8601(naive) do
      case m["timeZone"] do
        z when z in [nil, "UTC", "Etc/UTC", "tzone://Microsoft/Utc"] -> {:ok, DateTime.from_naive!(n, "Etc/UTC")}
        z -> with({:ok, d} <- DateTime.from_naive(n, z), do: {:ok, DateTime.shift_zone!(d, "Etc/UTC")}, else: (_ -> {:ok, DateTime.from_naive!(n, "Etc/UTC")}))
      end
    end
  end

  defp moment(_), do: :error

  # An all-day event runs midnight to midnight where it was made, which in UTC
  # can be an hour or so either side: the nearest midnight is its day.
  defp day(%DateTime{} = t), do: t |> DateTime.add(12 * 3600) |> DateTime.to_date()

  ## Changes made here

  @doc "Adds an event. Gives Graph's ID for it."
  def create(token, calendar, %Event{} = event) do
    case Remote.request("POST", api("/me/calendars/" <> Remote.segment(calendar) <> "/events"), token, body(event)) do
      {:ok, status, %{"id" => id}, _} when status in 200..201 -> {:ok, id}
      {:ok, status, _, _} -> Remote.status_error(status)
      error -> error
    end
  end

  @doc "Changes an event, if it's still as it was when last copied. Whatever else Outlook keeps on it stays."
  def update(token, _calendar, id, %Event{} = event, etag) do
    headers = if etag, do: [{"if-match", etag}], else: []

    case Remote.request("PATCH", api("/me/events/" <> Remote.segment(id)), token, body(event), headers) do
      {:ok, 200, _, _} -> :ok
      {:ok, status, _, _} -> Remote.status_error(status)
      error -> error
    end
  end

  @doc "Deletes an event."
  def delete(token, _calendar, id) do
    case Remote.request("DELETE", api("/me/events/" <> Remote.segment(id)), token) do
      {:ok, status, _, _} when status in 200..299 or status in [404, 410] -> :ok
      {:ok, status, _, _} -> Remote.status_error(status)
      error -> error
    end
  end

  defp body(%Event{} = e) do
    {start, finish} =
      if e.all_day do
        {"#{Date.to_iso8601(e.start_date)}T00:00:00", "#{Date.to_iso8601(Date.add(e.end_date || e.start_date, 1))}T00:00:00"}
      else
        {stamp(e.starts_at), stamp(e.ends_at || e.starts_at)}
      end

    %{
      subject: e.title,
      body: %{contentType: "text", content: e.notes || ""},
      location: %{displayName: e.location || ""},
      isAllDay: e.all_day == true,
      start: %{dateTime: start, timeZone: "UTC"},
      end: %{dateTime: finish, timeZone: "UTC"},
      singleValueExtendedProperties: [%{id: @emoji, value: e.emoji || "📅"}, %{id: @who, value: Enum.join(e.who || [], ",")}]
    }
  end

  defp stamp(%DateTime{} = t), do: t |> DateTime.shift_zone!("Etc/UTC") |> DateTime.to_naive() |> NaiveDateTime.truncate(:second) |> NaiveDateTime.to_iso8601()
end
