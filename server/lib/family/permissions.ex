defmodule Family.Permissions do
  @moduledoc """
  What each person may do. Every role has defaults; an admin (or a grown-up
  allowed to manage kids) can switch single permissions on or off for a
  person. Admins always have everything, and can read every chat.

  The home family also decides which features each other bubble gets. A
  feature it switches off is off for everyone in that bubble, whatever their
  own settings say.
  """

  alias Family.Repo
  alias Family.Accounts.{User, Bubble}

  @all ~w(send_messages share_photos doodle play_games start_games video_calls direct_messages create_rooms delete_others_messages manage_kids calendar edit_calendar tasks)

  # The features the home family can switch off for another bubble, and the
  # abilities each one covers. Chatting itself is always on.
  @features [
    {"photos", ~w(share_photos)},
    {"doodle", ~w(doodle)},
    {"games", ~w(play_games start_games)},
    {"calls", ~w(video_calls)},
    {"direct", ~w(direct_messages)},
    {"groups", ~w(create_rooms)},
    {"tasks", ~w(tasks)},
    {"calendar", ~w(calendar edit_calendar)}
  ]

  # Other bubbles start with everything but the calendar, which is the home
  # family's own until they share it.
  @feature_off_by_default ~w(calendar)

  @defaults %{
    "admin" => Map.new(@all, &{&1, true}),
    "grownup" => Map.new(@all, &{&1, true}),
    "kid" => %{
      "send_messages" => true,
      "share_photos" => true,
      "doodle" => true,
      "play_games" => true,
      "start_games" => true,
      "video_calls" => true,
      "direct_messages" => true,
      "create_rooms" => false,
      "delete_others_messages" => false,
      "manage_kids" => false,
      "calendar" => true,
      "edit_calendar" => false,
      "tasks" => true
    }
  }

  def all, do: @all
  def defaults(role), do: Map.fetch!(@defaults, role)

  @doc "The permissions that apply to this person, overrides included."
  def effective(%User{role: "admin"}), do: defaults("admin") |> Map.put("manage_people", true)

  def effective(%User{role: role, permissions: overrides} = user) do
    defaults(role)
    |> Map.merge(Map.take(overrides || %{}, @all))
    |> Map.merge(switched_off(user))
    |> Map.put("manage_people", false)
  end

  def features, do: Enum.map(@features, &elem(&1, 0))

  @doc "Which features a bubble has: everything at home, and elsewhere what the home family allows."
  def bubble_features(%Bubble{home: true}), do: Map.new(@features, fn {f, _} -> {f, true} end)

  def bubble_features(%Bubble{features: features}) do
    Map.new(@features, fn {f, _} -> {f, Map.get(features || %{}, f, f not in @feature_off_by_default)} end)
  end

  @doc "The abilities someone's bubble doesn't have, each set to false."
  def switched_off(%User{} = user) do
    case bubble_of(user) do
      nil ->
        %{}

      bubble ->
        for {f, false} <- bubble_features(bubble), {^f, abilities} <- @features, a <- abilities, into: %{}, do: {a, false}
    end
  end

  defp bubble_of(%User{bubble: %Bubble{} = bubble}), do: bubble
  defp bubble_of(%User{bubble_id: nil}), do: nil
  defp bubble_of(%User{bubble_id: id}), do: Repo.get(Bubble, id)

  @doc "Keeps only real feature names with true or false values."
  def clean_features(map) when is_map(map) do
    map
    |> Map.take(features())
    |> Enum.filter(fn {_, v} -> is_boolean(v) end)
    |> Map.new()
  end

  def clean_features(_), do: %{}

  def can?(%User{active: false}, _), do: false
  def can?(%User{} = user, permission), do: Map.get(effective(user), to_string(permission), false)

  @doc "Keeps only real permission names with true or false values."
  def clean_overrides(map) when is_map(map) do
    map
    |> Map.take(@all)
    |> Enum.filter(fn {_, v} -> is_boolean(v) end)
    |> Map.new()
  end

  def clean_overrides(_), do: %{}

  @doc "Whether this person's quiet hours are on now, in the family's own time."
  def quiet_now?(user, now \\ family_time())

  def quiet_now?(%User{quiet_hours: %{"from" => from, "to" => to}}, {_date, {h, m, _}}) do
    with {:ok, from} <- minutes(from), {:ok, to} <- minutes(to) do
      now = h * 60 + m

      cond do
        from == to -> false
        from < to -> now >= from and now < to
        true -> now >= from or now < to
      end
    else
      _ -> false
    end
  end

  def quiet_now?(_, _), do: false

  defp family_time do
    Application.get_env(:family, :time_zone, "Europe/London")
    |> DateTime.now!()
    |> DateTime.to_naive()
    |> NaiveDateTime.to_erl()
  end

  def valid_quiet_hours?(nil), do: true

  def valid_quiet_hours?(%{"from" => from, "to" => to}),
    do: match?({:ok, _}, minutes(from)) and match?({:ok, _}, minutes(to))

  def valid_quiet_hours?(_), do: false

  defp minutes(<<h::binary-size(2), ":", m::binary-size(2)>>) do
    with {h, ""} when h in 0..23 <- Integer.parse(h), {m, ""} when m in 0..59 <- Integer.parse(m) do
      {:ok, h * 60 + m}
    else
      _ -> :error
    end
  end

  defp minutes(_), do: :error
end
