defmodule Family.ChatGamesTest do
  use Family.DataCase, async: false
  alias Family.{Accounts, Chat, Games}

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
    assert Enum.any?(Chat.list_messages(room.id), &(&1.kind == "system" and &1.body == "Jo won"))
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
    assert game.id in ids.(kid)
    assert Enum.any?(Chat.list_messages(room.id), &(&1.body == "Jo stopped the chess game"))

    # Someone not playing only takes it off their own list; a finished game just goes.
    third = person_fixture(admin, "grownup", "Kim")
    assert {:ok, false} = Games.remove(third, other.id)
    assert %{status: "active"} = Games.get(other.id)
    refute other.id in ids.(third)
    assert {:ok, false} = Games.remove(kid, game.id)
    refute game.id in ids.(kid)
    assert {:error, :not_found} = Games.remove(kid, -1)
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
end
