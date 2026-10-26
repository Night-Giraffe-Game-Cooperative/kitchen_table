defmodule Family.ChatGamesTest do
  use Family.DataCase, async: false
  import Ecto.Query
  alias Family.{Accounts, Chat, Games, Repo}

  setup do
    admin = admin_fixture()
    kid = person_fixture(admin, "kid", "Mia")
    grownup = person_fixture(admin, "grownup", "Jo")
    %{admin: admin, kid: kid, grownup: grownup, room: Chat.family_room()}
  end

  test "posting, reacting and deleting", %{kid: kid, grownup: grownup, room: room} do
    {:ok, msg} = Chat.post_message(kid, room.id, %{"body" => "  Hello!  "})
    assert msg.body == "Hello!"
    assert {:error, _} = Chat.post_message(kid, room.id, %{"body" => "   "})

    assert :ok = Chat.toggle_reaction(grownup, msg.id, "❤️")
    assert {:error, _} = Chat.toggle_reaction(grownup, msg.id, "🍕")
    assert [%{reactions: [%{emoji: "❤️"}]}] = Chat.list_messages(room.id)

    # A kid can't delete a grown-up's message; a grown-up can tidy a kid's.
    {:ok, other} = Chat.post_message(grownup, room.id, %{"body" => "Tea's ready"})
    assert {:error, :forbidden} = Chat.delete_message(kid, other.id)
    assert :ok = Chat.delete_message(grownup, msg.id)
    assert Enum.find(Chat.list_messages(room.id), &(&1.id == msg.id)).deleted
  end

  test "permissions and quiet hours stop a kid posting", %{admin: admin, kid: kid, room: room} do
    {:ok, kid} = Accounts.set_permissions(admin, kid, %{"send_messages" => false}, nil)
    assert {:error, :forbidden} = Chat.post_message(kid, room.id, %{"body" => "hi"})

    {:ok, kid} = Accounts.set_permissions(admin, kid, %{}, %{"from" => "00:00", "to" => "23:59"})
    {_, {h, m, _}} = :calendar.local_time()

    if h * 60 + m < 23 * 60 + 59 do
      assert {:error, :quiet_hours} = Chat.post_message(kid, room.id, %{"body" => "hi"})
    end
  end

  test "rooms: kids can't make them, grown-ups can, direct rooms are reused", %{kid: kid, grownup: grownup} do
    assert {:error, :forbidden} = Chat.create_room(kid, %{"name" => "Secret", "member_ids" => [grownup.id]})
    {:ok, room} = Chat.create_room(grownup, %{"name" => "Grown-ups", "member_ids" => [kid.id]})
    assert Chat.member?(kid, room.id)

    {:ok, d1} = Chat.direct_room(kid, grownup.id)
    {:ok, d2} = Chat.direct_room(grownup, kid.id)
    assert d1.id == d2.id
    assert Enum.any?(Chat.list_rooms(kid), &(&1.kind == "direct" and &1.name == "Jo"))
  end

  test "games check turns and versions", %{kid: kid, grownup: grownup, admin: admin, room: room} do
    {:ok, game} =
      Games.create(kid, room.id, %{
        "type" => "chess",
        "mode" => "versus",
        "seats" => %{"w" => kid.id, "b" => "open"},
        "state" => %{"turn" => "w", "fen" => "start"}
      })

    assert {:error, "It isn't your turn."} =
             Games.move(grownup, game.id, %{"version" => 0, "state" => %{"turn" => "b"}})

    assert {:ok, game} = Games.join(grownup, game.id, "b")
    assert {:error, _} = Games.join(admin, game.id, "b")
    assert {:error, :conflict} = Games.move(kid, game.id, %{"version" => 0, "state" => %{"turn" => "b"}})
    assert {:ok, game} = Games.move(kid, game.id, %{"version" => game.version, "state" => %{"turn" => "b"}})
    assert {:ok, game} = Games.move(grownup, game.id, %{"version" => game.version, "state" => %{"turn" => "w"}, "status" => "finished", "summary" => "Jo won"})
    assert game.status == "finished"
    assert {:error, "That game has finished."} = Games.move(kid, game.id, %{"version" => game.version, "state" => %{}})
    # Starting and finishing a game leave the chat itself alone.
    assert Chat.list_messages(room.id) == []
  end

  test "taking a game off the list stops it for everyone, when you may", %{kid: kid, grownup: grownup, admin: admin, room: room} do
    chess = %{"type" => "chess", "mode" => "versus", "seats" => %{"w" => kid.id, "b" => grownup.id}, "state" => %{"turn" => "w"}}
    {:ok, game} = Games.create(kid, room.id, chess)
    {:ok, other} = Games.create(kid, room.id, chess)

    # Jo is playing, so it stops for everyone and leaves Jo's list.
    assert {:ok, true} = Games.remove(grownup, game.id)
    assert %{status: "finished", summary: "Jo stopped the chess game", state: %{"ended" => "stopped"}} = Games.get(game.id)
    ids = fn user -> user |> Games.list_for() |> Enum.map(& &1.id) end
    refute game.id in ids.(grownup)
    # A finished chess game leaves everyone's list: only pictures and stories stay.
    refute game.id in ids.(kid)
    assert Chat.list_messages(room.id) == []

    # Someone not playing only takes it off their own list; a finished game just goes.
    third = person_fixture(admin, "grownup", "Kim")
    assert {:ok, false} = Games.remove(third, other.id)
    assert %{status: "active"} = Games.get(other.id)
    refute other.id in ids.(third)
    assert {:ok, false} = Games.remove(kid, game.id)
    assert {:error, :not_found} = Games.remove(kid, -1)
  end

  test "games nobody has touched for two days are put away", %{kid: kid, grownup: grownup, room: room} do
    chess = %{"type" => "chess", "mode" => "versus", "seats" => %{"w" => kid.id, "b" => grownup.id}, "state" => %{"turn" => "w"}}
    {:ok, quiet} = Games.create(kid, room.id, chess)
    {:ok, recent} = Games.create(kid, room.id, chess)
    {:ok, done} = Games.create(kid, room.id, chess)
    {:ok, _} = Games.move(kid, done.id, %{"version" => 0, "state" => %{"turn" => "b"}, "status" => "finished", "summary" => "Mia won"})

    now = DateTime.utc_now(:second)
    age = fn game, hours -> Repo.update_all(from(g in Games.Game, where: g.id == ^game.id), set: [updated_at: DateTime.add(now, -hours * 3600)]) end
    age.(quiet, 49)
    age.(recent, 47)
    age.(done, 100)

    assert Games.finish_idle(now) == 1
    assert %{status: "finished", summary: "Put away after two days with no moves", state: %{"ended" => "idle", "turn" => "w"}, version: 1} = Games.get(quiet.id)
    assert %{status: "active"} = Games.get(recent.id)
    assert %{summary: "Mia won"} = Games.get(done.id)
    assert {:error, "That game has finished."} = Games.move(kid, quiet.id, %{"version" => 1, "state" => %{"turn" => "b"}})
    assert Games.finish_idle(now) == 0
  end

  test "play again starts one next round, and the last game points at it", %{kid: kid, grownup: grownup, admin: admin, room: room} do
    chess = %{"type" => "chess", "mode" => "versus", "seats" => %{"w" => kid.id, "b" => grownup.id}, "state" => %{"turn" => "w"}}
    {:ok, last} = Games.create(kid, room.id, chess)
    {:ok, last} = Games.move(kid, last.id, %{"version" => 0, "state" => %{"turn" => "b"}, "status" => "finished", "summary" => "Mia won"})
    FamilyWeb.Endpoint.subscribe("game:#{last.id}")

    again = Map.merge(chess, %{"after" => last.id, "seats" => %{"w" => grownup.id, "b" => kid.id}})
    {:ok, next} = Games.create(grownup, room.id, again)
    assert Games.get(last.id).next_id == next.id
    # Everyone looking at the last game hears where the next one is.
    next_id = next.id
    assert_receive %Phoenix.Socket.Broadcast{event: "game:updated", payload: %{id: _, next_id: ^next_id}}

    # Mia pressed Play again at the same moment: she joins the same round.
    assert {:ok, %{id: ^next_id}} = Games.create(kid, room.id, Map.put(again, "after", to_string(last.id)))
    assert [%{id: ^next_id}] = Games.list_for(kid)

    # Once that round is over too, Play again on the old one starts afresh.
    {:ok, _} = Games.remove(grownup, next.id)
    {:ok, third} = Games.create(kid, room.id, again)
    refute third.id == next.id
    assert Games.get(last.id).next_id == third.id

    # Only a game from the same chat counts.
    {:ok, other} = Chat.create_room(admin, %{"name" => "Grown-ups", "member_ids" => [grownup.id]})
    assert {:error, :not_found} = Games.create(grownup, other.id, again)
  end

  test "finished games stay on the list only when they made a picture or a story", %{kid: kid, room: room} do
    finish = fn g -> {:ok, g} = Games.move(kid, g.id, %{"version" => g.version, "state" => %{"turn" => "anyone"}, "status" => "finished"}); g end
    make = fn type, mode -> {:ok, g} = Games.create(kid, room.id, %{"type" => type, "mode" => mode, "seats" => %{}, "state" => %{"turn" => "anyone"}}); g end

    doodle = make.("doodle_together", "coop") |> finish.()
    story = make.("story_chain", "coop") |> finish.()
    quiz = make.("family_quiz", "coop") |> finish.()
    going = make.("family_quiz", "coop")

    listed = kid |> Games.list_for() |> Enum.map(& &1.id)
    assert going.id in listed and doodle.id in listed and story.id in listed
    refute quiz.id in listed
    # It's still there to look at for anyone who has it open.
    assert %{status: "finished"} = Games.get_for(kid, quiz.id)
  end

  test "one person against the computer is only on their own list", %{kid: kid, grownup: grownup, room: room} do
    make = fn seats -> {:ok, g} = Games.create(kid, room.id, %{"type" => "chess", "mode" => "coop", "seats" => seats, "state" => %{"turn" => "white"}}); g end

    solo = make.(%{"white" => kid.id, "black" => "computer"})
    family = make.(%{"white" => "team", "black" => "computer"})

    assert solo.id in (kid |> Games.list_for() |> Enum.map(& &1.id))
    theirs = grownup |> Games.list_for() |> Enum.map(& &1.id)
    refute solo.id in theirs
    assert family.id in theirs
  end

  test "co-op games let anyone on the team move, and doodles append strokes", %{kid: kid, grownup: grownup, room: room} do
    {:ok, game} =
      Games.create(kid, room.id, %{
        "type" => "doodle_together",
        "mode" => "coop",
        "seats" => %{"team" => "team"},
        "state" => %{"turn" => "anyone", "strokes" => []}
      })

    assert {:ok, _} = Games.append(grownup, game.id, "strokes", %{"u" => grownup.id, "p" => [1, 2, 3, 4]})
    assert {:error, :forbidden} = Games.append(grownup, game.id, "strokes", %{"u" => kid.id, "p" => []})
    assert {:error, :forbidden} = Games.append(grownup, game.id, "other", %{"u" => grownup.id})
    assert length(Games.get(game.id).state["strokes"]) == 1

    assert {:error, "That game isn't available."} =
             Games.create(kid, room.id, %{"type" => "doodle_together", "mode" => "versus", "seats" => %{}, "state" => %{}})
  end

  test "the newer games: a computer seat never moves, so its reply comes with the person's move", %{kid: kid, grownup: grownup, room: room} do
    for {type, modes} <- [
          {"pairs", ~w(coop versus)},
          {"four_in_a_row", ~w(coop versus)},
          {"wheres_giraffe", ~w(coop)},
          {"dots_boxes", ~w(coop versus)},
          {"family_quiz", ~w(coop)},
          {"snakes_ladders", ~w(coop versus)}
        ] do
      assert Games.types()[type] == modes
    end

    {:ok, game} =
      Games.create(kid, room.id, %{
        "type" => "four_in_a_row",
        "mode" => "coop",
        "seats" => %{"red" => "team", "yellow" => "computer"},
        "state" => %{"turn" => "red", "moves" => []}
      })

    assert {:ok, game} = Games.move(grownup, game.id, %{"version" => 0, "state" => %{"turn" => "red", "moves" => [3, 4]}})
    assert {:ok, game} = Games.move(kid, game.id, %{"version" => 1, "state" => %{"turn" => "yellow", "moves" => [3, 4, 2]}})
    assert {:error, "It isn't your turn."} = Games.move(kid, game.id, %{"version" => 2, "state" => %{"turn" => "red"}})
    assert {:error, "That game isn't available."} = Games.create(kid, room.id, %{"type" => "family_quiz", "mode" => "versus", "seats" => %{}, "state" => %{}})
  end
end
