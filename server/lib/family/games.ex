defmodule Family.Games do
  @moduledoc """
  Games played in a room. The rules of each game live in the web app; the
  server keeps the board, checks whose turn it is and who may join, and makes
  sure moves happen one after another.

  Each game's state is a map with a `turn` naming the seat to move next, or
  `"anyone"` when everyone can move at once. Seats hold a person's id, `team`
  (anyone in the room), `computer`, or `open` (waiting for someone to join).
  """

  import Ecto.Query
  alias Family.{Repo, Chat, Permissions}
  alias Family.Accounts.User
  alias Family.Games.{Game, Referee}
  alias FamilyWeb.Present

  @types %{
    "doodle_together" => ~w(coop),
    "doodle_duel" => ~w(versus),
    "doodle_telephone" => ~w(coop),
    "chess" => ~w(versus coop),
    "backgammon" => ~w(versus coop),
    "word_garden" => ~w(coop versus),
    "picture_puzzle" => ~w(coop versus),
    "story_chain" => ~w(coop versus),
    "pairs" => ~w(coop versus),
    "four_in_a_row" => ~w(coop versus),
    "wheres_giraffe" => ~w(coop),
    "dots_boxes" => ~w(coop versus),
    "family_quiz" => ~w(coop),
    "snakes_ladders" => ~w(coop versus)
  }

  @names %{
    "doodle_together" => "Doodle Together",
    "doodle_duel" => "Doodle Battle",
    "doodle_telephone" => "Doodle Telephone",
    "chess" => "the chess game",
    "backgammon" => "the backgammon game",
    "word_garden" => "Word Garden",
    "picture_puzzle" => "Picture Puzzle",
    "story_chain" => "Story Chain",
    "pairs" => "Pairs",
    "four_in_a_row" => "the Four in a Row game",
    "wheres_giraffe" => "Where's the Giraffe?",
    "dots_boxes" => "the Dots and Boxes game",
    "family_quiz" => "the Family Quiz",
    "snakes_ladders" => "the Snakes and Ladders game"
  }

  # What a live doodle may add to without a version check.
  @appendable %{"doodle_together" => ["strokes"]}
  @max_state_bytes 4_000_000

  def types, do: @types

  def get(id), do: Repo.get(Game, id)

  def get_for(%User{} = user, id) do
    case Repo.get(Game, id) do
      %Game{} = game -> if Chat.member?(user, game.room_id), do: game
      nil -> nil
    end
  end

  @doc "Games in the rooms someone is in: everything active, and the latest finished, less any they took off their list."
  def list_for(%User{} = user) do
    rooms = from m in Chat.Member, where: m.user_id == ^user.id, select: m.room_id
    hidden = from h in "hidden_games", where: h.user_id == ^user.id, select: h.game_id
    mine = from g in Game, where: g.room_id in subquery(rooms) and g.id not in subquery(hidden)

    active = from(g in mine, where: g.status == "active", order_by: [desc: g.updated_at]) |> Repo.all()
    finished = from(g in mine, where: g.status == "finished", order_by: [desc: g.updated_at], limit: 12) |> Repo.all()

    Enum.map(active ++ finished, &Present.game/1)
  end

  def create(%User{} = user, room_id, attrs) do
    type = attrs["type"]
    mode = attrs["mode"]
    seats = attrs["seats"] || %{}
    state = attrs["state"] || %{}

    with :ok <- may_play(user, room_id, :start_games),
         true <- (Map.has_key?(@types, type) and mode in @types[type]) || {:error, "That game isn't available."},
         :ok <- check_seats(seats, room_id),
         :ok <- check_state(state) do
      game =
        Repo.insert!(%Game{
          room_id: room_id,
          created_by_id: user.id,
          type: type,
          mode: mode,
          title: attrs["title"] |> to_string() |> String.slice(0, 80),
          seats: seats,
          state: state,
          summary: attrs["summary"] |> to_string() |> String.slice(0, 200),
          last_move_by_id: user.id
        })

      {:ok, _} = Chat.post_system(room_id, %{kind: "game", user_id: user.id, game_id: game.id})
      announce(game)
      {:ok, game}
    end
  end

  @doc "Takes an open seat."
  def join(%User{} = user, game_id, seat) do
    Referee.run(fn ->
      with %Game{} = game <- get_for(user, game_id) || {:error, :not_found},
           :ok <- may_play(user, game.room_id, :play_games) do
        cond do
          not Map.has_key?(game.seats, seat) ->
            {:error, "That seat isn't there."}

          Map.get(game.seats, seat) != "open" ->
            {:error, "That seat is taken."}

          user.id in Map.values(game.seats) ->
            {:error, "You're already playing."}

          true ->
            game =
              game
              |> Ecto.Changeset.change(seats: Map.put(game.seats, seat, user.id), version: game.version + 1)
              |> Repo.update!()

            announce(game)
            {:ok, game}
        end
      end
    end)
  end

  @doc """
  Saves a move. `version` must be the version the mover was looking at, and it
  must be their turn in that version. The new state replaces the old one.
  """
  def move(%User{} = user, game_id, attrs) do
    Referee.run(fn ->
      with %Game{} = game <- get_for(user, game_id) || {:error, :not_found},
           :ok <- may_play(user, game.room_id, :play_games),
           :ok <- if(game.status == "active", do: :ok, else: {:error, "That game has finished."}),
           :ok <- if(attrs["version"] == game.version, do: :ok, else: {:error, :conflict}),
           :ok <- my_turn(user, game),
           state when is_map(state) <- attrs["state"] || {:error, "Send the new board."},
           :ok <- check_state(state) do
        finished = attrs["status"] == "finished"

        game =
          game
          |> Ecto.Changeset.change(
            state: state,
            version: game.version + 1,
            status: if(finished, do: "finished", else: "active"),
            summary: attrs["summary"] |> to_string() |> String.slice(0, 200),
            last_move_by_id: user.id
          )
          |> Repo.update!()

        announce(game)
        if finished, do: Chat.post_system(game.room_id, %{kind: "system", body: game.summary, game_id: game.id})
        {:ok, game}
      end
    end)
  end

  @doc """
  Takes a game off someone's Games list. A game still being played stops
  for everyone first, when they may stop it: they started it, they're
  playing, or they're an admin. Otherwise it only leaves their own list.
  """
  def remove(%User{} = user, game_id) do
    Referee.run(fn ->
      with %Game{} = game <- get_for(user, game_id) || {:error, :not_found} do
        stopped = game.status == "active" and may_stop?(user, game)

        if stopped do
          game =
            game
            |> Ecto.Changeset.change(
              status: "finished",
              state: Map.put(game.state, "ended", "stopped"),
              version: game.version + 1,
              summary: "#{user.name} stopped #{Map.get(@names, game.type, "the game")}",
              last_move_by_id: user.id
            )
            |> Repo.update!()

          announce(game)
          Chat.post_system(game.room_id, %{kind: "system", body: game.summary, game_id: game.id})
        end

        now = DateTime.utc_now(:second)
        Repo.insert_all("hidden_games", [%{game_id: game.id, user_id: user.id, inserted_at: now}], on_conflict: :nothing)
        Chat.notify_user(user.id, "games_changed", %{game_id: game.id})
        {:ok, stopped}
      end
    end)
  end

  @idle_hours 48

  @doc """
  Finishes every game nobody has touched for two days, so the Games list
  doesn't fill up with ones the family has wandered away from. Their last
  board stays readable. Gives how many it finished.
  """
  def finish_idle(now \\ DateTime.utc_now(:second)) do
    cutoff = DateTime.add(now, -@idle_hours * 3600)

    Referee.run(fn ->
      from(g in Game, where: g.status == "active" and g.updated_at < ^cutoff)
      |> Repo.all()
      |> Enum.map(fn game ->
        game
        |> Ecto.Changeset.change(
          status: "finished",
          state: Map.put(game.state, "ended", "idle"),
          version: game.version + 1,
          summary: "Put away after two days with no moves"
        )
        |> Repo.update!()
        |> announce()
      end)
      |> length()
    end)
  end

  defp may_stop?(user, game),
    do: game.created_by_id == user.id or user.id in Map.values(game.seats) or Permissions.can?(user, :manage_people)

  @doc "Adds to a list in a live game (a doodle stroke), without a version check."
  def append(%User{} = user, game_id, key, item) do
    Referee.run(fn ->
      with %Game{} = game <- get_for(user, game_id) || {:error, :not_found},
           :ok <- may_play(user, game.room_id, :play_games),
           true <- (key in Map.get(@appendable, game.type, []) and game.status == "active") || {:error, :forbidden},
           true <- (is_map(item) and Map.get(item, "u") == user.id) || {:error, :forbidden} do
        list = Map.get(game.state, key, [])

        if length(list) >= 4000 do
          {:error, "This picture is full."}
        else
          state = Map.put(game.state, key, list ++ [item])

          with :ok <- check_state(state) do
            game =
              game
              |> Ecto.Changeset.change(state: state, version: game.version + 1, last_move_by_id: user.id)
              |> Repo.update!()

            {:ok, game}
          end
        end
      end
    end)
  end

  defp may_play(user, room_id, permission) do
    cond do
      not Chat.member?(user, room_id) -> {:error, :forbidden}
      not Permissions.can?(user, permission) -> {:error, :forbidden}
      true -> Family.Contacts.check_room(room_id)
    end
  end

  defp my_turn(user, %Game{state: state, seats: seats}) do
    case Map.get(state, "turn", "anyone") do
      "anyone" ->
        :ok

      seat ->
        case Map.get(seats, seat) do
          "team" -> :ok
          id when id == user.id -> :ok
          _ -> {:error, "It isn't your turn."}
        end
    end
  end

  defp check_seats(seats, room_id) when is_map(seats) do
    members = Chat.member_ids(room_id)

    if Enum.all?(seats, fn {seat, who} ->
         is_binary(seat) and (who in ["team", "computer", "open"] or who in members)
       end),
       do: :ok,
       else: {:error, "Everyone playing must be in this chat."}
  end

  defp check_seats(_, _), do: {:error, "Choose who is playing."}

  defp check_state(state) do
    if byte_size(Jason.encode!(state)) <= @max_state_bytes,
      do: :ok,
      else: {:error, "That game has grown too big to save."}
  end

  defp announce(game) do
    payload = Present.game(game)
    FamilyWeb.Endpoint.broadcast("room:#{game.room_id}", "game:updated", payload)
    FamilyWeb.Endpoint.broadcast("game:#{game.id}", "game:updated", payload)

    case Map.get(game.seats, Map.get(game.state, "turn", "anyone")) do
      id when is_integer(id) and game.status == "active" and id != game.last_move_by_id ->
        Chat.notify_user(id, "your_turn", payload)
        Family.Push.your_turn(game, id)

      _ ->
        :ok
    end

    Chat.notify_members(game.room_id, "games_changed", %{game_id: game.id})
  end
end
