defmodule Family.Push do
  @moduledoc """
  Notifications on phones, tablets and computers while the app is closed: a
  new message, a call ringing or missed, and a turn in a game. Each device
  switches them on from the Me page. Its browser gives an address at its
  push service, kept against the session that asked, so signing out on that
  device stops them.

  Nobody gets a notification about what they could already see: while the
  app is open and in use on any of their devices, it shows things there
  instead. Quiet hours keep a person's devices quiet, and a chat someone has
  muted sends no notifications for its messages.
  """

  import Ecto.Query
  require Logger
  alias Family.{Accounts, Permissions, Repo}
  alias Family.Accounts.{Token, User}
  alias Family.Chat.{Member, Message, Room}
  alias Family.Push.{Subscription, WebPush}

  @max_devices 20

  @games %{
    "doodle_together" => "Doodle Together",
    "doodle_duel" => "Doodle Battle",
    "doodle_telephone" => "Doodle Telephone",
    "chess" => "Chess",
    "backgammon" => "Backgammon",
    "word_garden" => "Word Garden",
    "picture_puzzle" => "Picture Puzzle",
    "story_chain" => "Story Chain",
    "pairs" => "Pairs",
    "four_in_a_row" => "Four in a Row",
    "wheres_giraffe" => "Where's the Giraffe?",
    "dots_boxes" => "Dots and Boxes",
    "family_quiz" => "Family Quiz",
    "snakes_ladders" => "Snakes and Ladders"
  }

  def public_key, do: WebPush.public_key()

  ## Devices

  @doc """
  Keeps a device's subscription (the `endpoint` and `keys` its browser
  gave) for this person and session. The same device again replaces its
  old one, whoever had it.
  """
  def subscribe(%User{} = user, token_id, %{"endpoint" => endpoint, "keys" => %{"p256dh" => p256dh, "auth" => auth}} = attrs)
      when is_binary(endpoint) and is_binary(p256dh) and is_binary(auth) and is_integer(token_id) do
    with :ok <- check_endpoint(endpoint),
         {:ok, point} <- Base.url_decode64(p256dh, padding: false),
         true <- WebPush.valid_key?(point),
         {:ok, <<_::binary-16>>} <- Base.url_decode64(auth, padding: false) do
      now = DateTime.utc_now(:second)

      # A browser that renewed its subscription says which one it replaces.
      replaced = is_binary(attrs["replaces"]) && Repo.one(from s in Subscription, where: s.endpoint == ^attrs["replaces"] and s.user_id == ^user.id)
      if replaced, do: Repo.delete!(replaced)
      device = device_name(attrs["device"]) || if(replaced, do: replaced.device)

      Repo.insert!(
        %Subscription{user_id: user.id, token_id: token_id, endpoint: endpoint, p256dh: p256dh, auth: auth, device: device},
        on_conflict: [set: [user_id: user.id, token_id: token_id, p256dh: p256dh, auth: auth, device: device, updated_at: now]],
        conflict_target: :endpoint
      )

      trim(user)
      :ok
    else
      {:error, _} = error -> error
      _ -> {:error, "That device's notification details don't look right."}
    end
  end

  def subscribe(_, _, _), do: {:error, "That device's notification details don't look right."}

  defp check_endpoint(endpoint) do
    uri = URI.parse(endpoint)
    private = Application.get_env(:family, :push_private_hosts, false)

    cond do
      byte_size(endpoint) > 2048 or not is_binary(uri.host) -> {:error, "That isn't a notification address."}
      uri.scheme != "https" and not (private and uri.scheme == "http") -> {:error, "That isn't a notification address."}
      not private and Family.HTTP.private_host?(uri.host) -> {:error, "That isn't a notification address."}
      true -> :ok
    end
  end

  defp device_name(name) when is_binary(name), do: name |> String.trim() |> String.slice(0, 60)
  defp device_name(_), do: nil

  # Old devices beyond the most a person needs drop off.
  defp trim(user) do
    keep = from(s in Subscription, where: s.user_id == ^user.id, order_by: [desc: s.updated_at, desc: s.id], limit: @max_devices, select: s.id)
    Repo.delete_all(from s in Subscription, where: s.user_id == ^user.id and s.id not in subquery(keep))
  end

  def unsubscribe(%User{} = user, endpoint) when is_binary(endpoint) do
    Repo.delete_all(from s in Subscription, where: s.user_id == ^user.id and s.endpoint == ^endpoint)
    :ok
  end

  def remove_device(%User{} = user, id) do
    Repo.delete_all(from s in Subscription, where: s.user_id == ^user.id and s.id == ^id)
    :ok
  end

  @doc "This person's devices with notifications on, newest first, without their addresses."
  def devices(%User{} = user) do
    from(s in live(), where: s.user_id == ^user.id, order_by: [desc: s.updated_at, desc: s.id])
    |> Repo.all()
    |> Enum.map(&%{id: &1.id, device: &1.device, since: &1.inserted_at, last_used_at: &1.last_used_at, endpoint_hash: hash(&1.endpoint)})
  end

  @doc "A short fingerprint of a device's address, so the app can tell which one it is without the server handing addresses out."
  def hash(endpoint), do: :crypto.hash(:sha256, endpoint) |> binary_part(0, 9) |> Base.url_encode64(padding: false)

  @doc "Sends a notification to one of this person's devices straight away, to see that it works."
  def test(%User{} = user, endpoint) when is_binary(endpoint) do
    case Repo.one(from s in live(), where: s.user_id == ^user.id and s.endpoint == ^endpoint) do
      nil ->
        {:error, "Notifications aren't on for this device yet."}

      sub ->
        payload = %{kind: "test", title: "Kitchen Table", body: "Notifications work on this device.", tag: "test", url: "/#/me"}

        case send_one(sub, payload, ttl: 600, urgency: "high") do
          :ok -> :ok
          :gone -> {:error, "This device's browser has forgotten its notifications. Switch them off and on again."}
          {:error, _} -> {:error, "The browser's notification service didn't take it. Try again in a minute."}
        end
    end
  end

  # Subscriptions whose session hasn't expired.
  defp live do
    cutoff = Accounts.session_cutoff()
    from s in Subscription, join: t in Token, on: t.id == s.token_id, where: t.context == "session" and t.last_used_at > ^cutoff
  end

  ## Chats

  @doc "Mutes or unmutes a chat's notifications for one of its members."
  def mute(%User{} = user, room_id, muted) when is_boolean(muted) do
    case Repo.update_all(from(m in Member, where: m.room_id == ^room_id and m.user_id == ^user.id), set: [muted: muted]) do
      {1, _} -> :ok
      _ -> {:error, :not_found}
    end
  end

  ## What happens

  @doc "A new message: everyone else in the chat hears about it."
  def message_posted(%Message{kind: kind} = message) when kind in ~w(text photo doodle game) do
    later(fn ->
      room = Repo.get(Room, message.room_id)
      author = message.user || Repo.get(User, message.user_id)

      ids =
        Repo.all(
          from m in Member,
            where: m.room_id == ^room.id and m.user_id != ^message.user_id and not m.muted,
            select: m.user_id
        )

      # A new game is only news to those who can play it.
      ids = if kind == "game", do: able(ids, :play_games), else: ids
      text = preview(message)

      {title, body} =
        if room.kind == "direct",
          do: {author.name, text},
          else: {"#{room.emoji} #{room.name}", "#{author.name}: #{text}"}

      notify(ids, %{kind: "message", title: title, body: body, tag: "room-#{room.id}", url: "/#/chats/#{room.id}"},
        topic: "room-#{room.id}"
      )
    end)
  end

  def message_posted(_), do: :ok

  @doc "Someone started a call: it rings on the others' devices."
  def call_started(room_id, by_id, user_ids) do
    later(fn ->
      room = Repo.get(Room, room_id)
      caller = Repo.get(User, by_id)
      where = if room.kind == "direct", do: "Video call. Open the app to answer.", else: "Video call in #{room.emoji} #{room.name}. Open the app to join."

      user_ids
      |> able(:video_calls)
      |> notify(%{kind: "call", title: "#{caller.name} is calling", body: where, tag: "call-#{room_id}", url: "/#/chats/#{room_id}"},
        ttl: 45,
        urgency: "high",
        topic: "call-#{room_id}"
      )
    end)
  end

  @doc "A call ended without these people joining it."
  def call_missed(room_id, by_id, user_ids) do
    later(fn ->
      room = Repo.get(Room, room_id)
      caller = Repo.get(User, by_id)
      where = if room.kind == "direct", do: "Open the app to call back.", else: "In #{room.emoji} #{room.name}."

      user_ids
      |> able(:video_calls)
      |> notify(%{kind: "missed", title: "Missed call from #{caller.name}", body: where, tag: "call-#{room_id}", url: "/#/chats/#{room_id}"},
        topic: "call-#{room_id}"
      )
    end)
  end

  # The people who can still do the thing a notification is about.
  defp able(ids, ability) do
    from(u in User, where: u.id in ^ids, preload: :bubble) |> Repo.all() |> Enum.filter(&Permissions.can?(&1, ability)) |> Enum.map(& &1.id)
  end

  @doc "It's someone's go in a game."
  def your_turn(game, user_id) do
    later(fn ->
      who = game.last_move_by_id && Repo.get(User, game.last_move_by_id)
      name = Map.get(@games, game.type, "your game")
      body = if who, do: "#{who.name} has had a go in #{name}.", else: "#{name} is waiting for you."

      notify(able([user_id], :play_games), %{kind: "turn", title: "Your turn", body: body, tag: "game-#{game.id}", url: "/#/games/#{game.id}"},
        topic: "game-#{game.id}"
      )
    end)
  end

  @doc """
  A new game: the people given a seat in it hear who asked them to play,
  except the starter, and whoever's turn it is, who hears that instead.
  """
  def game_started(game, last \\ nil) do
    turn = Map.get(game.seats, Map.get(game.state, "turn", "anyone"))
    # A next round also reaches whoever played in the last one.
    seats = Map.values(game.seats) ++ if(last, do: Map.values(last.seats), else: [])
    ids = for id <- seats, is_integer(id), id != game.created_by_id, id != turn, uniq: true, do: id

    if ids != [] do
      later(fn ->
        who = Repo.get(User, game.created_by_id)
        name = Map.get(@games, game.type, "a game")

        {title, body} =
          if last, do: {"Next round", "#{who.name} started the next round of #{name}."}, else: {"New game", "#{who.name} started #{name} with you."}

        notify(able(ids, :play_games), %{kind: "game", title: title, body: body, tag: "game-#{game.id}", url: "/#/games/#{game.id}"}, topic: "game-#{game.id}")
      end)
    end

    :ok
  end

  @doc "A morning or evening summary (Family.DaySummary), on all of someone's devices. Its own timing already took quiet hours into account."
  def day_summary(%User{} = user, kind, %{title: title, body: body}) when kind in [:morning, :evening] do
    payload = %{kind: to_string(kind), title: title, body: body, tag: to_string(kind), url: "/#/calendar", at: System.system_time(:millisecond)}

    for sub <- Repo.all(from s in live(), where: s.user_id == ^user.id), do: send_one(sub, payload, topic: to_string(kind), ttl: 4 * 3600)

    :ok
  end

  @doc "The people with at least one device to send notifications to."
  def with_devices, do: from(s in live(), select: s.user_id)

  @doc "News about the family, such as two kids asking to chat."
  def family_news(user_ids, title, body) do
    later(fn -> notify(user_ids, %{kind: "family", title: title, body: body, tag: "family", url: "/#/people"}, topic: "family") end)
  end

  ## Sending

  # Sends in the background, so posting a message never waits on Google or
  # Apple. Tests send straight away instead.
  defp later(fun) do
    if Application.get_env(:family, :push_sync, false) do
      fun.()
    else
      Task.Supervisor.start_child(Family.TaskSupervisor, fun)
    end

    :ok
  end

  defp notify(user_ids, payload, opts) do
    looking = looking()

    people =
      from(u in User, where: u.id in ^user_ids and u.active)
      |> Repo.all()
      |> Enum.reject(&(&1.id in looking or Permissions.quiet_now?(&1)))
      |> Enum.map(& &1.id)

    payload = Map.put(payload, :at, System.system_time(:millisecond))

    for sub <- Repo.all(from s in live(), where: s.user_id in ^people) do
      send_one(sub, payload, opts)
    end

    :ok
  end

  defp send_one(sub, payload, opts) do
    case WebPush.send(sub, Jason.encode!(payload), opts) do
      :ok ->
        Repo.update_all(from(s in Subscription, where: s.id == ^sub.id), set: [last_used_at: DateTime.utc_now(:second)])
        :ok

      :gone ->
        Repo.delete_all(from s in Subscription, where: s.id == ^sub.id)
        :gone

      {:error, reason} = error ->
        Logger.warning("Notification to #{URI.parse(sub.endpoint).host} failed: #{inspect(reason) |> String.slice(0, 200)}")
        error
    end
  end

  @doc "The people using the app right now on some device, who see things there instead."
  def looking do
    for {id, %{metas: metas}} <- FamilyWeb.Presence.list("family:presence"),
        Enum.any?(metas, &(Map.get(&1, :active, true) != false)),
        do: String.to_integer(id)
  end

  defp preview(%Message{kind: "photo", body: body}), do: "📷 " <> (body || "Photo")
  defp preview(%Message{kind: "doodle", body: body}), do: "🖍️ " <> (body || "Doodle")
  defp preview(%Message{kind: "game"}), do: "🎲 Started a game"

  defp preview(%Message{body: body}) do
    if String.length(body || "") > 160, do: String.slice(body, 0, 159) <> "…", else: body || ""
  end
end
