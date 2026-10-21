defmodule Family.BubblesTest do
  use Family.DataCase, async: false
  alias Family.{Accounts, Chat, Contacts, Permissions}

  setup do
    admin = admin_fixture()
    mia = person_fixture(admin, "kid", "Mia")
    ruby = person_fixture(admin, "kid", "Ruby")
    jo = person_fixture(admin, "grownup", "Jo")
    %{admin: admin, mia: mia, ruby: ruby, jo: jo, home: Accounts.home_bubble()}
  end

  test "friends and cousins come in a bubble of their own, a grown-up first", %{admin: admin, home: home} do
    assert home.name == "Alex's family"

    assert {:error, "Add a guardian from The Smiths first" <> _} =
             Accounts.invite(admin, %{"name" => "Ollie", "email" => "ollie@example.com", "role" => "kid", "bubble_name" => "The Smiths"})

    assert [^home] = Accounts.list_bubbles()

    sam = person_fixture(admin, "grownup", "Sam", %{"bubble_name" => "The Smiths", "bubble_emoji" => "🌳"})
    smiths = Accounts.get_bubble(sam.bubble_id)
    assert %{name: "The Smiths", emoji: "🌳", home: false} = smiths
    ollie = person_fixture(admin, "kid", "Ollie", %{"bubble_id" => smiths.id})
    assert ollie.bubble_id == smiths.id

    # Only the home bubble is in the whole-family chat.
    refute Chat.member?(sam, Chat.family_room().id)
    assert Chat.list_rooms(ollie) == []
  end

  test "a family's grown-ups read only the chats their own kids are in", %{admin: admin, mia: mia, ruby: ruby, jo: jo} do
    sam = person_fixture(admin, "grownup", "Sam", %{"bubble_name" => "The Smiths"})
    ollie = person_fixture(admin, "kid", "Ollie", %{"bubble_id" => sam.bubble_id})

    {:ok, ask} = Contacts.ask(sam, ollie.id, mia.id)
    {:ok, _} = Contacts.approve(jo, ask.id)
    {:ok, friends} = Chat.direct_room(ollie, mia.id)
    {:ok, sisters} = Chat.direct_room(mia, ruby.id)
    family = Chat.family_room()

    FamilyWeb.Endpoint.subscribe("user:#{sam.id}")
    {:ok, _} = Chat.post_message(mia, friends.id, %{"body" => "Come to the park?"})
    assert_receive %Phoenix.Socket.Broadcast{event: "room_activity", payload: %{room_id: room_id}}
    assert room_id == friends.id

    # Sam reads Ollie's chat with Mia, and nothing else.
    assert [%{id: id, member: false, name: "Mia & Ollie", unread: 0}] = Chat.list_rooms(sam)
    assert id == friends.id
    assert Chat.can_read?(sam, friends.id)
    refute Chat.can_read?(sam, sisters.id)
    refute Chat.can_read?(sam, family.id)
    assert {:error, :forbidden} = Chat.post_message(sam, friends.id, %{"body" => "Hello"})

    # Jo, a grown-up at home, reads both of Mia's chats; switched off, neither.
    assert Chat.can_read?(jo, friends.id) and Chat.can_read?(jo, sisters.id)
    {:ok, jo} = Accounts.set_permissions(admin, jo, %{"manage_kids" => false}, nil)
    refute Chat.can_read?(jo, friends.id) or Chat.can_read?(jo, sisters.id)

    # Kids don't read anyone's chats; the admin reads them all.
    refute Chat.can_read?(ollie, sisters.id)
    assert Enum.all?([friends, sisters, family], &Chat.can_read?(admin, &1.id))
  end

  test "looking after kids stays inside the family", %{admin: admin, mia: mia, jo: jo} do
    sam = person_fixture(admin, "grownup", "Sam", %{"bubble_name" => "The Smiths"})
    ollie = person_fixture(admin, "kid", "Ollie", %{"bubble_id" => sam.bubble_id})

    assert {:ok, _} = Accounts.set_permissions(sam, ollie, %{"video_calls" => false}, nil)
    assert {:error, :forbidden} = Accounts.set_permissions(sam, mia, %{"video_calls" => false}, nil)
    assert {:error, :forbidden} = Accounts.set_permissions(jo, ollie, %{"video_calls" => false}, nil)
    assert Accounts.looks_after?(admin, ollie)

    # With Jo as family to the Smiths, Sam tidies up Ollie's messages, but not Jo's.
    :ok = Family.Contacts.set_relatives(admin, Accounts.get_bubble(sam.bubble_id), [jo.id])
    {:ok, plans} = Chat.create_room(sam, %{"name" => "Plans", "member_ids" => [ollie.id, jo.id]})
    {:ok, from_jo} = Chat.post_message(jo, plans.id, %{"body" => "Hi"})
    {:ok, from_ollie} = Chat.post_message(ollie, plans.id, %{"body" => "Hi back"})
    assert {:error, :forbidden} = Chat.delete_message(sam, from_jo.id)
    assert :ok = Chat.delete_message(sam, from_ollie.id)
  end

  test "moving someone to another bubble", %{admin: admin, mia: mia, home: home} do
    sam = person_fixture(admin, "grownup", "Sam", %{"bubble_name" => "The Smiths"})
    kim = person_fixture(admin, "grownup", "Kim", %{"bubble_name" => "The Joneses"})
    family = Chat.family_room()

    {:ok, mia} = Accounts.admin_update(admin, mia, %{"bubble_id" => sam.bubble_id})
    refute Chat.member?(mia, family.id)
    {:ok, mia} = Accounts.admin_update(admin, mia, %{"bubble_id" => to_string(home.id)})
    assert Chat.member?(mia, family.id)

    # A bubble left empty goes.
    {:ok, _} = Accounts.admin_update(admin, kim, %{"bubble_id" => home.id})
    refute Accounts.get_bubble(kim.bubble_id)

    # A kid can't move to a family with no grown-up there to look after them.
    {:ok, _} = Accounts.admin_update(admin, sam, %{"active" => false})
    assert {:error, "Add a guardian from The Smiths first" <> _} = Accounts.admin_update(admin, mia, %{"bubble_id" => sam.bubble_id})
  end

  test "admins rename bubbles", %{admin: admin, jo: jo, home: home} do
    assert {:ok, %{name: "The Robinsons"}} = Accounts.update_bubble(admin, home, %{"name" => " The Robinsons "})
    assert {:error, :forbidden} = Accounts.update_bubble(jo, home, %{"name" => "Jo's"})
    assert {:error, %Ecto.Changeset{}} = Accounts.update_bubble(admin, home, %{"name" => ""})
  end

  test "admins only ever come from the home family", %{admin: admin, jo: jo, home: home} do
    sam = person_fixture(admin, "grownup", "Sam", %{"bubble_name" => "The Smiths"})
    no_admin = "Admins come from the home family. People in other families can be grown-ups or kids."

    assert {:error, ^no_admin} =
             Accounts.invite(admin, %{"name" => "Kim", "email" => "kim@example.com", "role" => "admin", "bubble_id" => sam.bubble_id})

    assert {:error, ^no_admin} = Accounts.invite(admin, %{"name" => "Kim", "email" => "kim@example.com", "role" => "admin", "bubble_name" => "The Joneses"})
    assert {:error, ^no_admin} = Accounts.admin_update(admin, sam, %{"role" => "admin"})

    # A second admin at home can't be moved out while still an admin, but can as a grown-up.
    {:ok, jo} = Accounts.admin_update(admin, jo, %{"role" => "admin"})
    assert {:error, ^no_admin} = Accounts.admin_update(admin, jo, %{"bubble_id" => sam.bubble_id})
    assert {:ok, %{role: "grownup"} = jo} = Accounts.admin_update(admin, jo, %{"bubble_id" => sam.bubble_id, "role" => "grownup"})
    assert jo.bubble_id == sam.bubble_id
    assert {:ok, %{role: "admin"}} = Accounts.admin_update(admin, jo, %{"bubble_id" => home.id, "role" => "admin"})
  end

  test "the home family chooses what other bubbles can use", %{admin: admin, mia: mia, jo: jo, home: home} do
    sam = person_fixture(admin, "grownup", "Sam", %{"bubble_name" => "The Smiths"})
    ollie = person_fixture(admin, "kid", "Ollie", %{"bubble_id" => sam.bubble_id})
    smiths = Accounts.get_bubble(sam.bubble_id)

    # Everything but the calendar to start with.
    features = Permissions.bubble_features(smiths)
    assert features["games"] and features["calls"] and features["tasks"]
    refute features["calendar"]

    {:ok, smiths} = Accounts.update_bubble(admin, smiths, %{"features" => %{"games" => false, "calls" => false, "nonsense" => false}})
    assert smiths.features == %{"games" => false, "calls" => false}
    {:ok, smiths} = Accounts.update_bubble(admin, smiths, %{"features" => %{"calls" => true}})
    assert smiths.features == %{"games" => false, "calls" => true}

    # Off for everyone in the bubble, whatever their own settings say.
    refute Permissions.can?(sam, :play_games) or Permissions.can?(ollie, :start_games)
    assert Permissions.can?(sam, :video_calls)
    {:ok, ollie} = Accounts.set_permissions(sam, ollie, %{"play_games" => true}, nil)
    refute Permissions.can?(ollie, :play_games)
    {:ok, ask} = Contacts.ask(sam, ollie.id, mia.id)
    {:ok, _} = Contacts.approve(jo, ask.id)
    {:ok, playdate} = Chat.direct_room(mia, ollie.id)
    chess = %{"type" => "chess", "mode" => "versus", "seats" => %{"w" => mia.id, "b" => "open"}, "state" => %{"turn" => "w"}}
    assert {:error, :forbidden} = Family.Games.create(ollie, playdate.id, chess)
    assert {:ok, _} = Family.Games.create(mia, playdate.id, chess)

    # Only admins choose, and the home family always has everything.
    assert {:error, :forbidden} = Accounts.update_bubble(sam, smiths, %{"features" => %{"games" => true}})
    assert {:error, :forbidden} = Accounts.update_bubble(jo, smiths, %{"features" => %{"games" => true}})
    {:ok, home} = Accounts.update_bubble(admin, home, %{"features" => %{"games" => false}})
    assert home.features == %{}
    assert Permissions.can?(mia, :play_games)
  end

  test "bubble features over the API", %{admin: admin} do
    sam = person_fixture(admin, "grownup", "Sam", %{"bubble_name" => "The Smiths"})
    conn = Phoenix.ConnTest.build_conn() |> Plug.Conn.put_req_header("x-family", "1")
    alex = FamilyWeb.ConnCase.sign_in(conn, "alex@example.com", "a good password")

    assert %{"bubble" => %{"features" => %{"direct" => false, "games" => true}}} =
             alex |> Phoenix.ConnTest.dispatch(FamilyWeb.Endpoint, :patch, "/api/bubbles/#{sam.bubble_id}", %{"features" => %{"direct" => false}}) |> Phoenix.ConnTest.json_response(200)

    sam_conn = FamilyWeb.ConnCase.sign_in(conn, "sam@example.com", "Sam password")
    assert %{"permissions" => %{"direct_messages" => false, "share_photos" => true}} =
             sam_conn |> Phoenix.ConnTest.dispatch(FamilyWeb.Endpoint, :get, "/api/me", nil) |> Phoenix.ConnTest.json_response(200) |> Map.fetch!("me")
  end
end
