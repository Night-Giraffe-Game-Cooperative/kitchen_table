defmodule Family.ContactsTest do
  use FamilyWeb.ConnCase, async: false
  alias Family.{Accounts, Chat, Contacts, Games}

  # The Robinsons at home; Grandma's house; the cousins; and a school friend's family.
  setup do
    alex = admin_fixture()
    lucy = person_fixture(alex, "grownup", "Lucy")
    mia = person_fixture(alex, "kid", "Mia")
    jade = person_fixture(alex, "kid", "Jade")
    grandma = person_fixture(alex, "grownup", "Grandma", %{"bubble_name" => "Grandma's house"})
    auntie = person_fixture(alex, "grownup", "Auntie", %{"bubble_name" => "The cousins"})
    cousin = person_fixture(alex, "kid", "Cousin", %{"bubble_id" => auntie.bubble_id})
    priya = person_fixture(alex, "grownup", "Priya", %{"bubble_name" => "The Patels"})
    asha = person_fixture(alex, "kid", "Asha", %{"bubble_id" => priya.bubble_id})

    %{
      alex: alex,
      lucy: lucy,
      mia: mia,
      jade: jade,
      grandma: grandma,
      auntie: auntie,
      cousin: cousin,
      priya: priya,
      asha: asha,
      home: Accounts.home_bubble()
    }
  end

  test "grown-ups chat with grown-ups; kids with their own family", ctx do
    %{alex: alex, lucy: lucy, mia: mia, jade: jade, grandma: grandma, priya: priya, asha: asha} = ctx

    assert Contacts.may_talk?(alex, priya) and Contacts.may_talk?(grandma, priya)
    assert Contacts.may_talk?(lucy, mia) and Contacts.may_talk?(mia, jade)

    # Grandma isn't family to Mia until an admin says she is.
    refute Contacts.may_talk?(grandma, mia)
    assert {:error, "Grandma isn't family to Mia" <> _} = Chat.direct_room(grandma, mia.id)
    assert {:error, :forbidden} = Contacts.set_relatives(lucy, ctx.home, [grandma.id])
    assert :ok = Contacts.set_relatives(alex, ctx.home, [grandma.id, mia.id, alex.id])
    assert Contacts.relative_ids(ctx.home) == [grandma.id]
    assert Contacts.may_talk?(grandma, mia) and Contacts.may_talk?(mia, grandma)
    assert {:ok, _} = Chat.direct_room(mia, grandma.id)

    # A friend's grown-up checks in with the grown-ups, never the kids; nor do they with theirs.
    assert {:ok, _} = Chat.direct_room(priya, lucy.id)
    assert {:error, "Priya isn't family to Mia" <> _} = Chat.direct_room(priya, mia.id)
    assert {:error, "Alex isn't family to Asha" <> _} = Chat.direct_room(alex, asha.id)
  end

  test "kids from different families chat once a guardian from each says yes", ctx do
    %{alex: alex, lucy: lucy, mia: mia, priya: priya, asha: asha, grandma: grandma} = ctx

    assert {:error, "Asha and Mia can chat once a guardian from each family says yes."} = Chat.direct_room(mia, asha.id)

    # Mia asks; a guardian from each family needs to say yes.
    {:ok, ask} = Contacts.ask(mia, mia.id, asha.id)
    assert %{kid_ok_by_id: nil, friend_ok_by_id: nil} = ask
    assert {:error, :forbidden} = Contacts.approve(grandma, ask.id)
    # Alex is a guardian at home, not of the Patels' kids.
    {:ok, ask} = Contacts.approve(alex, ask.id)
    refute Contacts.Friendship.approved?(ask)
    refute Contacts.may_talk?(mia, asha)
    {:ok, ask} = Contacts.approve(alex, ask.id)
    refute Contacts.Friendship.approved?(ask)
    {:ok, ask} = Contacts.approve(priya, ask.id)
    assert Contacts.Friendship.approved?(ask)
    {:ok, chat} = Chat.direct_room(asha, mia.id)
    assert {:ok, _} = Chat.post_message(asha, chat.id, %{"body" => "Park?"})

    # Asking again changes nothing; kids in one family don't need to ask.
    assert {:ok, %{id: same}} = Contacts.ask(asha, asha.id, mia.id)
    assert same == ask.id
    assert {:error, "Mia and Jade are in the same family" <> _} = Contacts.ask(lucy, mia.id, ctx.jade.id)
    assert {:error, :forbidden} = Contacts.ask(grandma, mia.id, asha.id)

    # A group needs everyone to be able to talk to everyone.
    assert {:error, "Lucy isn't family to Asha" <> _} =
             Chat.create_room(lucy, %{"name" => "Sleepover", "member_ids" => [mia.id, asha.id]})

    # Taken back, the chat closes: no messages, games or calls, and it says why.
    assert :ok = Contacts.remove(priya, ask.id)
    assert {:error, "Asha and Mia can chat once" <> _} = Chat.post_message(mia, chat.id, %{"body" => "Hello?"})
    chess = %{"type" => "chess", "mode" => "versus", "seats" => %{"w" => mia.id, "b" => asha.id}, "state" => %{"turn" => "w"}}
    assert {:error, "Asha and Mia" <> _} = Games.create(mia, chat.id, chess)
    assert %{closed: "Asha and Mia can chat once" <> _} = Enum.find(Chat.list_rooms(mia), &(&1.id == chat.id))
    assert %{closed: nil} = Enum.find(Chat.list_rooms(mia), &(&1.kind == "family"))

    # Only the kids and their guardians end a friendship.
    {:ok, again} = Contacts.ask(priya, asha.id, mia.id)
    assert again.kid_ok_by_id == priya.id or again.friend_ok_by_id == priya.id
    assert {:error, :forbidden} = Contacts.remove(grandma, again.id)
    assert :ok = Contacts.remove(mia, again.id)
  end

  test "who sees which friendships", ctx do
    %{alex: alex, lucy: lucy, mia: mia, asha: asha, cousin: cousin, auntie: auntie, priya: priya} = ctx
    {:ok, a} = Contacts.ask(lucy, mia.id, asha.id)
    {:ok, b} = Contacts.ask(auntie, cousin.id, asha.id)

    ids = fn user -> user |> Contacts.friendships_for() |> Enum.map(& &1.id) |> Enum.sort() end
    assert ids.(alex) == Enum.sort([a.id, b.id])
    assert ids.(priya) == Enum.sort([a.id, b.id])
    assert ids.(lucy) == [a.id]
    assert ids.(mia) == [a.id]
    assert ids.(auntie) == [b.id]
    assert ids.(ctx.grandma) == []

    # Family to the cousins, Grandma sees their friends; Jade sees her sister's.
    :ok = Contacts.set_relatives(alex, Family.Accounts.get_bubble(cousin.bubble_id), [ctx.grandma.id])
    assert ids.(ctx.grandma) == [b.id]
    assert ids.(ctx.jade) == [a.id]
  end

  test "family and friends over the API", %{conn: conn} = ctx do
    %{mia: mia, asha: asha, grandma: grandma, home: home} = ctx
    alex = sign_in(conn, "alex@example.com", "a good password")
    priya = sign_in(build_conn() |> put_req_header("x-family", "1"), "priya@example.com", "Priya password")
    kid = sign_in(build_conn() |> put_req_header("x-family", "1"), "mia@example.com", "Mia password")

    assert %{"bubble" => %{"relative_ids" => [grandma_id]}} =
             alex |> patch("/api/bubbles/#{home.id}", %{"relative_ids" => [grandma.id]}) |> json_response(200)

    assert grandma_id == grandma.id
    assert priya |> patch("/api/bubbles/#{home.id}", %{"relative_ids" => []}) |> json_response(403)

    %{"friendship" => %{"id" => id, "approved" => false, "kid_ids" => [_, _]}} =
      kid |> post("/api/friends", %{"kid_id" => mia.id, "friend_id" => asha.id}) |> json_response(200)

    assert %{"friendships" => [%{"id" => ^id}]} = priya |> get("/api/people") |> json_response(200)
    assert %{"friendship" => %{"approved" => false}} = alex |> post("/api/friends/#{id}/yes") |> json_response(200)
    assert %{"friendship" => %{"approved" => true}} = priya |> post("/api/friends/#{id}/yes") |> json_response(200)
    assert %{"room_id" => _} = kid |> post("/api/rooms/direct/#{asha.id}") |> json_response(200)
    assert %{"ok" => true} = priya |> delete("/api/friends/#{id}") |> json_response(200)
    assert %{"error" => "Asha and Mia can chat once" <> _} = kid |> post("/api/rooms/direct/#{asha.id}") |> json_response(422)
  end
end
