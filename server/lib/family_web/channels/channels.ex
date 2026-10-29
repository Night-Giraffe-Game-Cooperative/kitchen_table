defmodule FamilyWeb.UserChannel do
  use FamilyWeb, :channel

  @impl true
  def join("user:" <> id, _, socket) do
    if String.to_integer(id) == socket.assigns.user_id, do: {:ok, socket}, else: {:error, %{reason: "forbidden"}}
  end
end

defmodule FamilyWeb.RoomChannel do
  use FamilyWeb, :channel
  alias Family.Chat

  @impl true
  def join("room:" <> id, _, socket) do
    room_id = String.to_integer(id)
    user = FamilyWeb.UserSocket.current_user(socket)

    # An admin reading a room they aren't in gets its messages live, unseen.
    if user && user.active && Chat.can_read?(user, room_id),
      do: {:ok, assign(socket, room_id: room_id, member: Chat.member?(user, room_id))},
      else: {:error, %{reason: "forbidden"}}
  end

  @impl true
  def handle_in("typing", _, socket) do
    if socket.assigns.member, do: broadcast_from(socket, "typing", %{user_id: socket.assigns.user_id})
    {:noreply, socket}
  end
end

defmodule FamilyWeb.GameChannel do
  @moduledoc "Live play: doodle strokes appear for everyone as they're drawn."
  use FamilyWeb, :channel
  alias Family.Games

  @impl true
  def join("game:" <> id, _, socket) do
    user = FamilyWeb.UserSocket.current_user(socket)

    case user && Games.get_for(user, String.to_integer(id)) do
      %{} = game -> {:ok, assign(socket, :game_id, game.id)}
      _ -> {:error, %{reason: "forbidden"}}
    end
  end

  @impl true
  def handle_in("stroke", %{"stroke" => stroke}, socket) do
    user = FamilyWeb.UserSocket.current_user(socket)
    stroke = Map.put(stroke, "u", user.id)

    case Games.append(user, socket.assigns.game_id, "strokes", stroke) do
      {:ok, game} ->
        broadcast_from(socket, "stroke", %{stroke: stroke, version: game.version})
        {:reply, {:ok, %{version: game.version}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  # Where someone's pen is, so others see them drawing.
  def handle_in("pen", payload, socket) do
    broadcast_from(socket, "pen", Map.put(payload, "u", socket.assigns.user_id))
    {:noreply, socket}
  end
end

defmodule FamilyWeb.PresenceChannel do
  use FamilyWeb, :channel
  alias FamilyWeb.Presence

  @impl true
  def join("family:presence", _, socket) do
    send(self(), :after_join)
    {:ok, socket}
  end

  @impl true
  def handle_info(:after_join, socket) do
    {:ok, _} = Presence.track(socket, to_string(socket.assigns.user_id), %{since: System.system_time(:second), active: true})
    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  # Whether this device is on screen and being used, so notifications go to
  # the person's other devices only while it isn't.
  @impl true
  def handle_in("active", %{"active" => active}, socket) when is_boolean(active) do
    Presence.update(socket, to_string(socket.assigns.user_id), &Map.put(&1, :active, active))
    {:noreply, socket}
  end

  def handle_in(_, _, socket), do: {:noreply, socket}
end

defmodule FamilyWeb.CallChannel do
  @moduledoc """
  A video call in a room. Each device joins with its own peer id; the channel
  passes connection offers and answers between devices (the video itself goes
  straight between them), shares who is muted, and carries the games played
  in the call.

  A grown-up in the call can mute a kid, or put a kid's pens away. The kid's
  microphone goes off and stays off until a grown-up lets them talk again,
  and everyone else's device stops playing their sound too, so it holds even
  on a device that hasn't caught up. Drawings from a kid whose pens are away
  aren't passed on.
  """
  use FamilyWeb, :channel
  require Logger
  alias Family.{Accounts, Calls, Chat, Permissions}
  alias FamilyWeb.Presence

  intercept ["rules"]

  @max_signal 64_000
  @max_snap 400_000
  @max_points 6_000
  @stickers ~w(moustache nose whiskers glasses crown hat bow flower star heart)

  @impl true
  def join("call:" <> id, %{"peer" => peer}, socket) when is_binary(peer) and byte_size(peer) in 8..64 do
    room_id = String.to_integer(id)
    user = FamilyWeb.UserSocket.current_user(socket)

    cond do
      not (user && user.active && Chat.member?(user, room_id)) ->
        {:error, %{reason: "forbidden"}}

      not Permissions.can?(user, :video_calls) ->
        {:error, %{reason: "no_calls"}}

      Family.Contacts.check_room(room_id) != :ok ->
        {:error, %{reason: "closed"}}

      true ->
        {:ok, %{started_at: started_at}} = Calls.join(room_id, peer, user.id)
        send(self(), :after_join)
        {:ok, %{started_at: started_at}, assign(socket, room_id: room_id, peer: peer)}
    end
  end

  def join(_, _, _), do: {:error, %{reason: "bad_request"}}

  @impl true
  def handle_info(:after_join, socket) do
    socket = assign(socket, :rules, Calls.rules(socket.assigns.room_id))

    {:ok, _} =
      Presence.track(socket, socket.assigns.peer, %{
        user_id: socket.assigns.user_id,
        muted: held?(socket, :muted),
        camera: true,
        since: System.system_time(:millisecond)
      })

    push(socket, "presence_state", Presence.list(socket))
    push(socket, "rules", socket.assigns.rules)
    if game = Calls.game(socket.assigns.room_id), do: push(socket, "game", %{game: game})

    case Calls.ink(socket.assigns.room_id) do
      [] -> :ok
      strokes -> push(socket, "ink_state", %{strokes: strokes})
    end

    {:noreply, socket}
  end

  # Connection offers, answers and network candidates, for one other device.
  @impl true
  def handle_in("signal", %{"to" => to, "data" => data}, socket) when is_binary(to) do
    if byte_size(Jason.encode!(data)) <= @max_signal do
      broadcast_from(socket, "signal", %{from: socket.assigns.peer, to: to, data: data})
    end

    {:noreply, socket}
  end

  def handle_in("state", payload, socket) do
    hushed = held?(socket, :muted)

    Presence.update(socket, socket.assigns.peer, fn meta ->
      meta
      |> Map.put(:muted, payload["muted"] == true or hushed)
      |> Map.put(:camera, payload["camera"] != false)
    end)

    {:noreply, socket}
  end

  # The whole state of the game being played in the call, from whoever moved.
  def handle_in("game", %{"game" => game}, socket) when is_map(game) or is_nil(game) do
    if byte_size(Jason.encode!(game)) <= @max_signal do
      Calls.put_game(socket.assigns.room_id, game)
      broadcast(socket, "game", %{game: game, by: socket.assigns.user_id})
    end

    {:noreply, socket}
  end

  # A photo from someone's camera, for Pull a Face.
  def handle_in("snap", %{"image" => "data:image/jpeg;base64," <> _ = image, "round" => round}, socket)
      when byte_size(image) <= @max_snap do
    broadcast(socket, "snap", %{peer: socket.assigns.peer, user_id: socket.assigns.user_id, image: image, round: round})
    {:noreply, socket}
  end

  # A quick emoji that floats up over everyone's screen.
  def handle_in("react", %{"emoji" => emoji}, socket) when is_binary(emoji) and byte_size(emoji) <= 32 do
    broadcast(socket, "react", %{peer: socket.assigns.peer, user_id: socket.assigns.user_id, emoji: emoji})
    {:noreply, socket}
  end

  # Drawing on someone's picture: a pen stroke or a sticker, or the newest
  # points of one while it's being drawn. A finished one is kept for late
  # joiners.
  def handle_in("ink", payload, socket) do
    with false <- held?(socket, :no_pens),
         {:ok, ink} <- clean_ink(payload, socket.assigns.peer) do
      ink = Map.put(ink, "by", socket.assigns.user_id)
      broadcast_from(socket, "ink", ink)

      if ink["done"] do
        stroke = ink |> Map.drop(~w(i p done)) |> Map.put("points", ink["p"])
        Calls.put_stroke(socket.assigns.room_id, stroke)
      end
    end

    {:noreply, socket}
  end

  # Only the device that drew something can take it back.
  def handle_in("ink_undo", %{"id" => id}, socket) when is_binary(id) do
    if String.starts_with?(id, socket.assigns.peer <> "-") do
      Calls.remove_stroke(socket.assigns.room_id, id)
      broadcast_from(socket, "ink_undo", %{id: id})
    end

    {:noreply, socket}
  end

  def handle_in("ink_wipe", _, socket) do
    unless held?(socket, :no_pens) do
      Calls.wipe_ink(socket.assigns.room_id)
      broadcast_from(socket, "ink_wipe", %{by: socket.assigns.user_id})
    end

    {:noreply, socket}
  end

  def handle_in("ink_idea", %{"text" => text}, socket) when is_binary(text) and byte_size(text) <= 200 do
    unless held?(socket, :no_pens), do: broadcast(socket, "ink_idea", %{text: text, by: socket.assigns.user_id})
    {:noreply, socket}
  end

  # A grown-up mutes kids in the call or puts their pens away ("mute" or
  # "pens", with on true), or lets them again. Kids can't, and only kids can
  # be.
  def handle_in("rule", %{"rule" => rule, "user_ids" => ids, "on" => on}, socket)
      when rule in ["mute", "pens"] and is_list(ids) and length(ids) <= 50 and is_boolean(on) do
    user = FamilyWeb.UserSocket.current_user(socket)
    kids = for id <- Enum.uniq(ids), is_integer(id), kid = Accounts.get_user(id), kid.role == "kid", do: id

    with true <- user != nil and user.role != "kid" and kids != [],
         {:ok, rules} <- Calls.put_rule(socket.assigns.room_id, if(rule == "mute", do: :muted, else: :no_pens), kids, on, user.id) do
      broadcast(socket, "rules", rules)
      {:reply, :ok, socket}
    else
      _ -> {:reply, {:error, %{reason: "forbidden"}}, socket}
    end
  end

  # When two devices can't connect, each says what it could see, for the log.
  def handle_in("debug", payload, socket) when is_map(payload) do
    Logger.info("#{socket.topic} #{socket.assigns.peer} can't connect: #{String.slice(Jason.encode!(payload), 0, 4000)}")
    {:noreply, socket}
  end

  def handle_in(_, _, socket), do: {:noreply, socket}

  # Every device keeps the call's rules to hand, so drawings can be checked
  # without asking the call each time.
  @impl true
  def handle_out("rules", rules, socket) do
    push(socket, "rules", rules)
    {:noreply, assign(socket, :rules, rules)}
  end

  defp held?(socket, rule), do: Map.has_key?(socket.assigns[:rules][rule] || %{}, socket.assigns.user_id)

  defp clean_ink(%{"id" => id, "on" => on, "kind" => kind, "colour" => colour, "size" => size, "i" => i, "p" => p} = m, peer)
       when is_binary(id) and byte_size(id) <= 96 and is_binary(on) and byte_size(on) <= 64 and kind in ["pen", "sticker"] and
              is_binary(colour) and is_number(size) and size > 0 and size <= 0.6 and is_integer(i) and i >= 0 and
              is_list(p) and length(p) <= @max_points do
    sticker = m["sticker"]

    cond do
      not String.starts_with?(id, peer <> "-") -> :error
      not Regex.match?(~r/^#[0-9a-fA-F]{6}$/, colour) -> :error
      not Enum.all?(p, &is_number/1) -> :error
      kind == "sticker" and sticker not in @stickers -> :error
      true ->
        ink = %{"id" => id, "on" => on, "kind" => kind, "colour" => colour, "size" => size, "i" => i, "p" => p, "done" => m["done"] == true}
        {:ok, if(kind == "sticker", do: Map.put(ink, "sticker", sticker), else: ink)}
    end
  end

  defp clean_ink(_, _), do: :error

  @impl true
  def terminate(_, socket) do
    if peer = socket.assigns[:peer], do: Calls.leave(socket.assigns.room_id, peer)
    :ok
  end
end
