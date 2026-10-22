defmodule Family.Calendar.Google do
  @moduledoc """
  Google Calendar's own API (v3), for calendars linked through a Google
  account someone signed in to. Repeating events come one occurrence at a
  time (Google works them out), so they're kept here the way a CalDAV
  calendar's are.

  The family's own bits of an event (its emoji and who it's for) ride along
  as private extended properties, which only this app sees.
  """

  alias Family.Calendar.{Connect, Event, Remote}

  defp api(path), do: Connect.url(:google_api) <> path

  @doc "The calendars in the account's list: `%{url, name, color, writable}`, `url` being Google's ID for it."
  def calendars(token) do
    first = api("/users/me/calendarList?" <> URI.encode_query(minAccessRole: "reader", maxResults: 250))

    with {:ok, items} <- Remote.pages(first, token, "items", &next(first, &1)) do
      calendars =
        for c <- items, c["deleted"] != true, is_binary(c["id"]) do
          %{
            url: c["id"],
            name: (c["summaryOverride"] || c["summary"] || c["id"]) |> String.slice(0, 60),
            color: color(c["backgroundColor"]),
            writable: c["accessRole"] in ["owner", "writer"],
            primary: c["primary"] == true
          }
        end

      # The account's own calendar first.
      {:ok, Enum.sort_by(calendars, &if(&1.primary, do: 0, else: 1)) |> Enum.map(&Map.delete(&1, :primary))}
    end
  end

  defp color("#" <> hex = c) when byte_size(hex) == 6, do: String.downcase(c)
  defp color(_), do: nil

  @doc "When anything in a calendar last changed, to skip copying it when nothing has."
  def ctag(token, calendar) do
    case Remote.request("GET", events_url(calendar) <> "?" <> URI.encode_query(maxResults: 1, fields: "updated"), token) do
      {:ok, 200, json, _} -> {:ok, json["updated"]}
      {:ok, status, _, _} -> Remote.status_error(status)
      error -> error
    end
  end

  @doc "Every occurrence between two days, as rows for Family.Calendar.Links."
  def events(token, calendar, %Date{} = from, %Date{} = to, zone) do
    first =
      events_url(calendar) <>
        "?" <>
        URI.encode_query(
          singleEvents: "true",
          showDeleted: "false",
          maxResults: 2500,
          timeMin: "#{Date.to_iso8601(from)}T00:00:00Z",
          timeMax: "#{Date.to_iso8601(Date.add(to, 1))}T00:00:00Z"
        )

    with {:ok, items} <- Remote.pages(first, token, "items", &next(first, &1)) do
      {:ok, for(item <- items, item["status"] != "cancelled", row = row(item, zone), row != nil, do: row)}
    end
  end

  defp next(first, %{"nextPageToken" => page}) when is_binary(page) do
    uri = URI.parse(first)
    query = (uri.query || "") |> URI.decode_query() |> Map.put("pageToken", page)
    URI.to_string(%{uri | query: URI.encode_query(query)})
  end

  defp next(_, _), do: nil

  defp events_url(calendar), do: api("/calendars/" <> Remote.segment(calendar) <> "/events")

  @doc false
  def row(item, zone) do
    own = get_in(item, ["extendedProperties", "private"]) || %{}
    start = item["start"] || %{}
    finish = item["end"] || %{}

    base = %{
      uid: item["iCalUID"] || item["id"],
      key: original(item["originalStartTime"]),
      recurring: is_binary(item["recurringEventId"]),
      title: Remote.title(item["summary"]),
      notes: Remote.text(item["description"]),
      location: item["location"] |> Remote.blank() |> Remote.slice(255),
      emoji: (own["kt_emoji"] |> Remote.blank() |> Remote.slice(16)) || "📅",
      who: Remote.who(own["kt_who"]),
      remote_href: item["id"],
      remote_etag: item["etag"]
    }

    cond do
      is_binary(start["date"]) ->
        with {:ok, first} <- Date.from_iso8601(start["date"]) do
          last =
            case finish["date"] && Date.from_iso8601(finish["date"]) do
              {:ok, d} -> Date.add(d, -1)
              _ -> first
            end

          last = if Date.compare(last, first) == :lt, do: first, else: last
          Map.merge(base, %{all_day: true, start_date: first, end_date: last, starts_at: nil, ends_at: nil, time_zone: zone})
        else
          _ -> nil
        end

      is_binary(start["dateTime"]) ->
        with {:ok, starts, _} <- DateTime.from_iso8601(start["dateTime"]) do
          starts = starts |> DateTime.shift_zone!("Etc/UTC") |> DateTime.truncate(:second)

          ends =
            with t when is_binary(t) <- finish["dateTime"],
                 {:ok, e, _} <- DateTime.from_iso8601(t) do
              e |> DateTime.shift_zone!("Etc/UTC") |> DateTime.truncate(:second)
            else
              _ -> starts
            end

          ends = if DateTime.compare(ends, starts) == :lt, do: starts, else: ends
          Map.merge(base, %{all_day: false, start_date: nil, end_date: nil, starts_at: starts, ends_at: ends, time_zone: start["timeZone"] || zone})
        else
          _ -> nil
        end

      true ->
        nil
    end
  end

  defp original(%{"date" => d}), do: d
  defp original(%{"dateTime" => t}), do: t
  defp original(_), do: ""

  ## Changes made here

  @doc "Adds an event. Gives Google's ID for it."
  def create(token, calendar, %Event{} = event) do
    case Remote.request("POST", events_url(calendar), token, body(event)) do
      {:ok, status, %{"id" => id}, _} when status in 200..201 -> {:ok, id}
      {:ok, status, _, _} -> Remote.status_error(status)
      error -> error
    end
  end

  @doc "Changes an event, if it's still as it was when last copied. Whatever else Google keeps on it stays."
  def update(token, calendar, id, %Event{} = event, etag) do
    headers = if etag, do: [{"if-match", etag}], else: []

    case Remote.request("PATCH", events_url(calendar) <> "/" <> Remote.segment(id), token, body(event), headers) do
      {:ok, 200, _, _} -> :ok
      {:ok, status, _, _} -> Remote.status_error(status)
      error -> error
    end
  end

  @doc "Deletes an event."
  def delete(token, calendar, id) do
    case Remote.request("DELETE", events_url(calendar) <> "/" <> Remote.segment(id), token) do
      {:ok, status, _, _} when status in 200..299 or status in [404, 410] -> :ok
      {:ok, status, _, _} -> Remote.status_error(status)
      error -> error
    end
  end

  defp body(%Event{} = e) do
    {start, finish} =
      if e.all_day do
        {%{date: Date.to_iso8601(e.start_date), dateTime: nil, timeZone: nil},
         %{date: Date.to_iso8601(Date.add(e.end_date || e.start_date, 1)), dateTime: nil, timeZone: nil}}
      else
        {%{dateTime: DateTime.to_iso8601(e.starts_at), timeZone: e.time_zone, date: nil},
         %{dateTime: DateTime.to_iso8601(e.ends_at || e.starts_at), timeZone: e.time_zone, date: nil}}
      end

    %{
      summary: e.title,
      description: e.notes || "",
      location: e.location || "",
      start: start,
      end: finish,
      extendedProperties: %{private: %{kt_emoji: e.emoji || "📅", kt_who: Enum.join(e.who || [], ",")}}
    }
  end
end
