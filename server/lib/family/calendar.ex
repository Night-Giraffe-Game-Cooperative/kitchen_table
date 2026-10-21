defmodule Family.Calendar do
  @moduledoc """
  The family calendar. Everyone with the `calendar` ability sees it, and
  those with `edit_calendar` add and change events: in the home family,
  kids see it and grown-ups change it unless an admin says otherwise. Other
  families have it only if the home family switches it on for them.

  Events are kept here, or in a linked calendar (Family.Calendar.Links):
  changes to a linked calendar's events are saved there first, then copied
  back here.
  """

  import Ecto.Query
  alias Family.{Permissions, Repo}
  alias Family.Accounts.User
  alias Family.Calendar.{Event, Link, Links}

  def can_see?(%User{} = user), do: Permissions.can?(user, :calendar)

  def can_edit?(%User{} = user), do: can_see?(user) and Permissions.can?(user, :edit_calendar)

  @doc """
  Events that may fall between two days (inclusive), with a day's slack each
  side for time zones, and every repeating event that has started by then.
  The web app works out the repeats and trims to what it shows.
  """
  def list(%User{} = user, %Date{} = from, %Date{} = to) do
    if can_see?(user) do
      from_day = Date.add(from, -1)
      to_day = Date.add(to, 1)
      from_time = DateTime.new!(from_day, ~T[00:00:00])
      to_time = DateTime.new!(Date.add(to_day, 1), ~T[00:00:00])

      Repo.all(
        from e in Event,
          where: is_nil(e.link_id) or e.link_id in subquery(Links.visible_ids(user)),
          where:
            (e.all_day and e.start_date <= ^to_day and
               (e.end_date >= ^from_day or (e.repeat != "none" and (is_nil(e.repeat_until) or e.repeat_until >= ^from_day)))) or
              (not e.all_day and e.starts_at < ^to_time and
                 (e.ends_at >= ^from_time or (e.repeat != "none" and (is_nil(e.repeat_until) or e.repeat_until >= ^from_day)))),
          order_by: [desc: e.all_day, asc: e.start_date, asc: e.starts_at, asc: e.id]
      )
    else
      []
    end
  end

  def get(id), do: Repo.get(Event, id)

  @doc """
  Adds an event, here or to a linked calendar: `calendar` is a link's id,
  or missing (or "here") for the calendar kept here.
  """
  def create(%User{} = user, attrs) do
    with :ok <- may_edit(user),
         {:ok, link} <- target(user, attrs["calendar"]),
         attrs = clean(attrs),
         %Ecto.Changeset{valid?: true} = changeset <- Event.changeset(%Event{created_by_id: user.id}, attrs),
         :ok <- check_who(changeset) do
      case link do
        nil ->
          event = Repo.insert!(changeset)
          changed()
          {:ok, event}

        link ->
          Links.create_event(link, Ecto.Changeset.apply_changes(changeset))
      end
    else
      %Ecto.Changeset{} = changeset -> {:error, changeset}
      other -> other
    end
  end

  defp target(_user, calendar) when calendar in [nil, "", "here"], do: {:ok, nil}

  defp target(user, id) do
    with id when is_integer(id) <- to_id(id),
         %Link{} = link <- Links.get(id),
         true <- Links.may_write?(user, link) do
      {:ok, link}
    else
      _ -> {:error, "You can't add to that calendar."}
    end
  end

  defp to_id(id) when is_integer(id), do: id

  defp to_id(id) when is_binary(id) do
    case Integer.parse(id) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp to_id(_), do: nil

  def update(%User{} = user, id, attrs) do
    with :ok <- may_edit(user),
         %Event{} = event <- get(id) || {:error, :not_found},
         {:ok, link} <- link_of(user, event),
         # A linked calendar's events repeat there, if at all.
         attrs = if(link, do: Map.drop(attrs, ~w(repeat repeat_until)), else: attrs),
         attrs = clean(attrs),
         %Ecto.Changeset{valid?: true} = changeset <- Event.changeset(event, attrs),
         :ok <- check_who(changeset) do
      case link do
        nil ->
          event = Repo.update!(changeset)
          changed()
          {:ok, event}

        link ->
          Links.update_event(link, event, Ecto.Changeset.apply_changes(changeset))
      end
    else
      %Ecto.Changeset{} = changeset -> {:error, changeset}
      other -> other
    end
  end

  def delete(%User{} = user, id) do
    with :ok <- may_edit(user),
         %Event{} = event <- get(id) || {:error, :not_found},
         {:ok, link} <- link_of(user, event) do
      case link do
        nil ->
          Repo.delete!(event)
          changed()
          :ok

        link ->
          Links.delete_event(link, event)
      end
    end
  end

  # The linked calendar an event is from, if it may be changed from here.
  defp link_of(_user, %Event{link_id: nil}), do: {:ok, nil}

  defp link_of(user, %Event{} = event) do
    link = Links.get(event.link_id)

    cond do
      is_nil(link) -> {:error, :not_found}
      link.share == "me" and link.user_id != user.id -> {:error, :not_found}
      not link.writable -> {:error, "This is from #{link.name}, which is only shown here. Change it there."}
      not Links.may_write?(user, link) -> {:error, "Only whoever linked #{link.name} can change its events."}
      event.recurring -> {:error, "This repeats in #{link.name}, so change it there."}
      true -> {:ok, link}
    end
  end

  defp may_edit(user), do: if(can_edit?(user), do: :ok, else: {:error, :forbidden})

  # The web app sends times as ISO 8601 with the device's offset; Ecto wants UTC.
  defp clean(attrs) do
    attrs
    |> Map.take(~w(title emoji notes location all_day starts_at ends_at start_date end_date time_zone repeat repeat_until who))
    |> Map.new(fn
      {k, v} when k in ~w(starts_at ends_at) and is_binary(v) ->
        case DateTime.from_iso8601(v) do
          {:ok, dt, _} -> {k, DateTime.truncate(dt, :second)}
          _ -> {k, v}
        end

      {"who", v} ->
        {"who", if(is_list(v), do: Enum.filter(v, &is_integer/1) |> Enum.uniq(), else: [])}

      {k, ""} when k in ~w(repeat_until end_date notes location) ->
        {k, nil}

      kv ->
        kv
    end)
  end

  defp check_who(changeset) do
    who = Ecto.Changeset.get_field(changeset, :who) || []
    viewers = viewer_ids()
    if Enum.all?(who, &(&1 in viewers)), do: :ok, else: {:error, "Only people who can see the calendar can be on an event."}
  end

  @doc "Everyone who can see the calendar."
  def viewer_ids do
    Repo.all(from u in User, where: u.active, preload: :bubble)
    |> Enum.filter(&can_see?/1)
    |> Enum.map(& &1.id)
  end

  @doc "Tells everyone who can see the calendar to fetch it again."
  def changed do
    Enum.each(viewer_ids(), &Family.Chat.notify_user(&1, "calendar_changed", %{}))
  end
end
