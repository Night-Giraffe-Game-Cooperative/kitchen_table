defmodule FamilyWeb.CallChannelTest do
  use Family.DataCase, async: false
  import Phoenix.ChannelTest
  alias Family.{Accounts, Calls, Chat}
  alias Phoenix.Socket.Broadcast

  @endpoint FamilyWeb.Endpoint

  setup do
    Application.put_env(:family, :call_grace_ms, 50)
    on_exit(fn -> Application.delete_env(:family, :call_grace_ms) end)
    admin = admin_fixture()
    kid = person_fixture(admin, "kid", "Mia")
    %{admin: admin, kid: kid, room: Chat.family_room()}
  end

  # Every test ends its calls itself, so no call ends after the test's database is gone.
  defp hang_up(socket) do
    Process.unlink(socket.channel_pid)
    close(socket)
  end

  defp join_call(user, room, peer) do
    FamilyWeb.UserSocket
    |> socket("user_socket:#{user.id}", %{user_id: user.id})
    |> subscribe_and_join(FamilyWeb.CallChannel, "call:#{room.id}", %{"peer" => peer})
  end

  test "a call rings the chat, passes signals and game state, and is noted when it ends",
       %{admin: admin, kid: kid, room: room} do
    room_id = room.id
    admin_id = admin.id
    @endpoint.subscribe("user:#{kid.id}")

    {:ok, _, dad} = join_call(admin, room, "dad-tablet-1")
    assert_receive %Broadcast{event: "call_ring", payload: %{room_id: ^room_id, by: ^admin_id}}
    assert_receive %Broadcast{event: "call_changed", payload: %{call: %{user_ids: [^admin_id]}}}
    assert %{^room_id => %{user_ids: [^admin_id]}} = Calls.live([room_id])

    {:ok, _, mia} = join_call(kid, room, "mia-tablet")
    refute_receive %Broadcast{event: "call_ring"}

    push(dad, "signal", %{"to" => "mia-tablet", "data" => %{"description" => %{"type" => "offer"}}})
    assert_broadcast "signal", %{from: "dad-tablet-1", to: "mia-tablet", data: %{"description" => _}}

    push(mia, "game", %{"game" => %{"kind" => "face", "round" => 1}})
    assert_broadcast "game", %{game: %{"kind" => "face"}}
    assert Calls.game(room_id) == %{"kind" => "face", "round" => 1}

    hang_up(dad)
    hang_up(mia)
    assert_receive %Broadcast{event: "call_changed", payload: %{call: nil}}, 2_000

    call = Enum.find(Chat.list_messages(room_id), &(&1.kind == "call"))
    assert %{"live" => false, "seconds" => seconds, "people" => people} = call.data
    assert seconds >= 0
    assert Enum.sort(people) == Enum.sort([admin.id, kid.id])
    assert Calls.live([room_id]) == %{}
  end

  test "rejoining during the grace period keeps the same call", %{admin: admin, room: room} do
    Application.put_env(:family, :call_grace_ms, 300)
    @endpoint.subscribe("user:#{admin.id}")
    {:ok, _, first} = join_call(admin, room, "dad-tablet-1")
    hang_up(first)
    {:ok, _, again} = join_call(admin, room, "dad-tablet-2")
    Process.sleep(500)
    assert Enum.count(Chat.list_messages(room.id), &(&1.kind == "call")) == 1
    assert %{} = Calls.live([room.id])[room.id]

    hang_up(again)
    assert_receive %Broadcast{event: "call_changed", payload: %{call: nil}}, 2_000
  end

  test "drawings on pictures are shared, kept for late joiners, and go with the person",
       %{admin: admin, kid: kid, room: room} do
    @endpoint.subscribe("user:#{admin.id}")
    {:ok, _, dad} = join_call(admin, room, "dad-tablet-1")
    {:ok, _, mia} = join_call(kid, room, "mia-tablet")

    stroke = %{"id" => "mia-tablet-1", "on" => "dad-tablet-1", "kind" => "pen", "colour" => "#e5383b", "size" => 0.025}
    push(mia, "ink", Map.merge(stroke, %{"i" => 0, "p" => [0.4, 0.5, 0.45, 0.52]}))
    assert_broadcast "ink", %{"id" => "mia-tablet-1", "by" => by, "done" => false}
    assert by == kid.id
    assert Calls.ink(room.id) == []

    push(mia, "ink", Map.merge(stroke, %{"i" => 0, "p" => [0.4, 0.5, 0.45, 0.52, 0.5, 0.5], "done" => true}))
    sticker = %{"id" => "mia-tablet-2", "on" => "mia-tablet", "kind" => "sticker", "sticker" => "crown"}
    push(mia, "ink", Map.merge(sticker, %{"colour" => "#24201d", "size" => 0.2, "i" => 0, "p" => [0.5, 0.2], "done" => true}))
    # Someone else's id, a bad colour or an unknown sticker are turned away.
    push(dad, "ink", Map.merge(stroke, %{"i" => 0, "p" => [0.1, 0.1], "done" => true}))
    push(dad, "ink", Map.merge(stroke, %{"id" => "dad-tablet-1-1", "colour" => "red", "i" => 0, "p" => [], "done" => true}))
    push(dad, "ink", Map.merge(sticker, %{"id" => "dad-tablet-1-2", "sticker" => "skull", "colour" => "#24201d", "size" => 0.2, "i" => 0, "p" => [0.5, 0.5], "done" => true}))
    Process.sleep(50)
    assert [%{"id" => "mia-tablet-1", "points" => [0.4, 0.5, 0.45, 0.52, 0.5, 0.5], "by" => ^by}, %{"sticker" => "crown"}] = Calls.ink(room.id)

    {:ok, _, mum} = join_call(admin, room, "mum-phone")
    assert_push "ink_state", %{strokes: [_, _]}

    # Dad can't take back Mia's drawing; Mia can.
    push(dad, "ink_undo", %{"id" => "mia-tablet-2"})
    push(mia, "ink_undo", %{"id" => "mia-tablet-2"})
    assert_broadcast "ink_undo", %{id: "mia-tablet-2"}
    Process.sleep(50)
    assert [%{"id" => "mia-tablet-1"}] = Calls.ink(room.id)

    # When Dad leaves, the drawing on his picture goes too.
    hang_up(dad)
    Process.sleep(100)
    assert Calls.ink(room.id) == []

    push(mum, "ink_idea", %{"text" => "Give Mia a moustache"})
    assert_broadcast "ink_idea", %{text: "Give Mia a moustache"}
    push(mum, "ink_wipe", %{})
    assert_broadcast "ink_wipe", %{}

    hang_up(mia)
    hang_up(mum)
    assert_receive %Broadcast{event: "call_changed", payload: %{call: nil}}, 2_000
  end

  test "a grown-up mutes a kid and puts their pens away until they let them again, and kids can't",
       %{admin: admin, kid: kid, room: room} do
    @endpoint.subscribe("user:#{admin.id}")
    {mia_id, dad_id} = {kid.id, admin.id}
    {:ok, _, dad} = join_call(admin, room, "dad-tablet-1")
    assert_push "rules", %{muted: none, no_pens: none} when none == %{}
    {:ok, _, mia} = join_call(kid, room, "mia-tablet")

    # Mia can't mute anyone, and only kids can be muted.
    ref = push(mia, "rule", %{"rule" => "mute", "user_ids" => [mia_id], "on" => true})
    assert_reply ref, :error, %{reason: "forbidden"}
    ref = push(dad, "rule", %{"rule" => "mute", "user_ids" => [dad_id], "on" => true})
    assert_reply ref, :error, %{reason: "forbidden"}

    ref = push(dad, "rule", %{"rule" => "mute", "user_ids" => [mia_id], "on" => true})
    assert_reply ref, :ok
    assert_broadcast "rules", %{muted: %{^mia_id => ^dad_id}}

    # Muted stays muted, whatever Mia's tablet says.
    push(mia, "state", %{"muted" => false, "camera" => true})
    Process.sleep(50)
    assert %{"mia-tablet" => %{metas: [%{muted: true}]}} = FamilyWeb.Presence.list("call:#{room.id}")

    # With her pens away, Mia's drawings and wipes go nowhere.
    ref = push(dad, "rule", %{"rule" => "pens", "user_ids" => [mia_id], "on" => true})
    assert_reply ref, :ok
    assert_broadcast "rules", %{muted: %{^mia_id => _}, no_pens: %{^mia_id => ^dad_id}}
    stroke = %{"id" => "mia-tablet-1", "on" => "dad-tablet-1", "kind" => "pen", "colour" => "#e5383b", "size" => 0.025}
    push(mia, "ink", Map.merge(stroke, %{"i" => 0, "p" => [0.4, 0.5], "done" => true}))
    push(mia, "ink_wipe", %{})
    push(mia, "ink_idea", %{"text" => "Give Dad a moustache"})
    refute_broadcast "ink", _, 100
    refute_broadcast "ink_wipe", _
    refute_broadcast "ink_idea", _
    assert Calls.ink(room.id) == []

    # Coming back into the call doesn't clear them.
    hang_up(mia)
    {:ok, _, mia} = join_call(kid, room, "mia-tablet-2")
    assert_push "rules", %{muted: %{^mia_id => _}, no_pens: %{^mia_id => _}}
    assert %{"mia-tablet-2" => %{metas: [%{muted: true}]}} = FamilyWeb.Presence.list("call:#{room.id}")

    # Dad lets her draw again; she's still muted.
    ref = push(dad, "rule", %{"rule" => "pens", "user_ids" => [mia_id], "on" => false})
    assert_reply ref, :ok
    assert_broadcast "rules", %{muted: %{^mia_id => _}, no_pens: none} when none == %{}
    push(mia, "ink", Map.merge(stroke, %{"id" => "mia-tablet-2-1", "i" => 0, "p" => [0.4, 0.5], "done" => true}))
    assert_broadcast "ink", %{"id" => "mia-tablet-2-1"}

    hang_up(dad)
    hang_up(mia)
    assert_receive %Broadcast{event: "call_changed", payload: %{call: nil}}, 2_000
  end

  test "people without video calls, or outside the chat, can't join", %{admin: admin, kid: kid, room: room} do
    {:ok, kid} = Accounts.set_permissions(admin, kid, %{"video_calls" => false}, nil)
    assert {:error, %{reason: "no_calls"}} = join_call(kid, room, "mia-tablet")
    assert {:error, %{reason: "bad_request"}} = join_call(admin, room, "x")
    grownup = person_fixture(admin, "grownup", "Jo")
    {:ok, other} = Chat.create_room(admin, %{"name" => "Grown-ups", "member_ids" => [grownup.id]})
    assert {:error, %{reason: "forbidden"}} = join_call(kid, other, "mia-tablet")
  end

  test "an admin reads a chat they aren't in live, unseen, and can't join its calls", %{admin: admin, kid: kid} do
    jo = person_fixture(admin, "grownup", "Jo")
    {:ok, direct} = Chat.direct_room(kid, jo.id)
    on_room = fn user -> socket(FamilyWeb.UserSocket, "user_socket:#{user.id}", %{user_id: user.id}) end

    {:ok, _, reading} = on_room.(admin) |> subscribe_and_join(FamilyWeb.RoomChannel, "room:#{direct.id}")
    {:ok, _, mia} = on_room.(kid) |> join(FamilyWeb.RoomChannel, "room:#{direct.id}")

    {:ok, _} = Chat.post_message(kid, direct.id, %{"body" => "Hi Jo"})
    assert_push "message:new", %{body: "Hi Jo"}

    # Mia's typing reaches the room; the admin's never does.
    push(reading, "typing", %{})
    refute_broadcast "typing", %{user_id: _}, 200
    push(mia, "typing", %{})
    assert_broadcast "typing", %{user_id: _}

    assert {:error, %{reason: "forbidden"}} = join_call(admin, direct, "dad-tablet-1")
    sam = person_fixture(admin, "grownup", "Sam", %{"bubble_name" => "The Smiths"})
    assert {:error, %{reason: "forbidden"}} = on_room.(sam) |> join(FamilyWeb.RoomChannel, "room:#{direct.id}")
  end
end
