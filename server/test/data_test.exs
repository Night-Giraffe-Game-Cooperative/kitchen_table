defmodule Family.DataTest do
  use FamilyWeb.ConnCase, async: false
  import Ecto.Query
  alias Family.{Calendar, Chat, Repo, Tasks}
  alias Family.Accounts.{Bubble, User}
  alias Family.Calendar.{Event, Link}
  alias Family.Chat.Message
  alias Family.Tasks.Task

  setup do
    admin = admin_fixture()
    lucy = person_fixture(admin, "grownup", "Lucy")
    kid = person_fixture(admin, "kid", "Mia")
    %{admin: admin, lucy: lucy, kid: kid, room: Chat.family_room()}
  end

  defp signed_in(name) do
    password = if name == "Alex", do: "a good password", else: "#{name} password"
    sign_in(build_conn() |> put_req_header("x-family", "1"), "#{String.downcase(name)}@example.com", password)
  end

  defp photo(user, room) do
    png = Path.join(System.tmp_dir!(), "dot-#{System.unique_integer([:positive])}.png")
    File.write!(png, Base.decode64!("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="))
    {:ok, media} = Chat.store_media(user, room.id, %Plug.Upload{path: png, filename: "dot.png", content_type: "image/png"}, %{})
    {:ok, _} = Chat.post_message(user, room.id, %{"kind" => "photo", "media_id" => media.id, "body" => "The garden"})
    media
  end

  defp unzip(conn) do
    assert ["application/zip"] = get_resp_header(conn, "content-type") |> Enum.map(&(&1 |> String.split(";") |> hd()))
    {:ok, files} = :zip.unzip(conn.resp_body, [:memory])
    Map.new(files, fn {name, data} -> {to_string(name), data} end)
  end

  defp link(user, share) do
    Repo.insert!(%Link{user_id: user.id, provider: "caldav", name: "#{user.name}'s #{share}", url: "https://caldav.example.com/#{share}/", username: user.email, secret: Family.Calendar.Vault.seal("hunter2-#{share}"), share: share})
  end

  test "anyone can download what the app keeps about them, and nothing secret goes in", %{admin: admin, lucy: lucy, kid: kid, room: room} do
    {:ok, _} = Chat.post_message(lucy, room.id, %{"body" => "Back at six"})
    {:ok, alexs} = Chat.post_message(admin, room.id, %{"body" => "Tea's ready"})
    :ok = Chat.toggle_reaction(lucy, alexs.id, Enum.at(Chat.reaction_emoji(), 0))
    media = photo(lucy, room)
    {:ok, task} = Tasks.create(lucy, %{"title" => "Water the plants", "user_ids" => [lucy.id], "days" => [1, 2, 3, 4, 5, 6, 7]})
    :ok = Tasks.tick(lucy, task.id, lucy.id, Date.utc_today(), true)
    {:ok, _} = Calendar.create(lucy, %{"title" => "Swimming", "all_day" => true, "start_date" => "2026-10-25", "who" => [lucy.id, kid.id]})
    private = link(lucy, "me")
    Repo.insert!(%Event{title: "Work dinner", all_day: true, start_date: ~D[2026-10-26], end_date: ~D[2026-10-26], link_id: private.id, source: "caldav"})

    conn = signed_in("Lucy") |> get("/api/export/me")
    files = unzip(conn)
    assert get_resp_header(conn, "content-disposition") |> hd() =~ "kitchen-table-lucy-"

    me = Jason.decode!(files["me.json"])
    assert %{"name" => "Lucy", "email" => "lucy@example.com", "role" => "grownup", "linked_calendars" => [%{"name" => "Lucy's me"}]} = me
    [chat] = Jason.decode!(files["chats.json"])
    assert [%{"text" => "Back at six"}, %{"text" => "The garden", "picture" => picture}] = chat["messages"]
    assert [%{"on_message_from" => _}] = chat["reactions"]
    assert files[picture] && picture == Path.relative_to(Chat.media_path(media.key, media.content_type), Application.fetch_env!(:family, :data_dir))
    refute Enum.any?(chat["messages"], &(&1["text"] == "Tea's ready"))

    titles = files["calendar.json"] |> Jason.decode!() |> Enum.map(& &1["title"])
    assert "Swimming" in titles and "Work dinner" in titles
    assert %{"tasks" => [%{"title" => "Water the plants"}], "ticks" => [%{"task" => "Water the plants"}]} = Jason.decode!(files["tasks.json"])

    # No password, sign-in or calendar password anywhere in it.
    everything = files |> Map.values() |> Enum.join()
    lucy = Repo.get!(User, lucy.id)
    refute everything =~ lucy.password_hash
    refute everything =~ "hunter2"
    refute everything =~ "password_hash"
  end

  test "a kid's download has only the reminders they set, even after a grown-up who set one leaves", %{admin: admin, kid: kid} do
    remind = %{"kind" => "reminder", "user_ids" => [kid.id], "days" => [1, 2, 3, 4, 5]}
    {:ok, _} = Tasks.create(kid, Map.put(remind, "title", "Library book"))
    {:ok, forms} = Tasks.create(admin, Map.put(remind, "title", "Bring the forms"))
    {:ok, _} = Tasks.create(admin, Map.put(remind, "title", "Swimming bag"))
    # What happens to the reminders of a grown-up whose account is removed.
    Repo.update_all(from(t in Task, where: t.id == ^forms.id), set: [created_by_id: nil])

    titles = signed_in("Mia") |> get("/api/export/me") |> unzip() |> Map.fetch!("tasks.json") |> Jason.decode!() |> Map.fetch!("tasks") |> Enum.map(& &1["title"])
    assert titles == ["Library book"]
  end

  test "an admin downloads the whole family, without anyone's private calendars", %{admin: admin, lucy: lucy, room: room} do
    {:ok, _} = Chat.post_message(lucy, room.id, %{"body" => "Back at six"})
    {:ok, _} = Chat.post_message(admin, room.id, %{"body" => "Tea's ready"})
    photo(admin, room)
    private = link(lucy, "me")
    shared = link(lucy, "family")
    Repo.insert!(%Event{title: "Work dinner", all_day: true, start_date: ~D[2026-10-26], end_date: ~D[2026-10-26], link_id: private.id, source: "caldav"})
    Repo.insert!(%Event{title: "School trip", all_day: true, start_date: ~D[2026-10-27], end_date: ~D[2026-10-27], link_id: shared.id, source: "caldav"})

    assert signed_in("Lucy") |> get("/api/export/family") |> json_response(403)

    files = signed_in("Alex") |> get("/api/export/family") |> unzip()
    [chat_file] = for {name, _} <- files, String.starts_with?(name, "chats/"), do: name
    chat = Jason.decode!(files[chat_file])
    texts = for m <- chat["messages"], do: {m["from"], m["text"]}
    assert {"Lucy", "Back at six"} in texts and {"Alex", "Tea's ready"} in texts
    assert Enum.any?(Map.keys(files), &String.starts_with?(&1, "media/"))

    titles = files["calendar.json"] |> Jason.decode!() |> Enum.map(& &1["title"])
    assert "School trip" in titles
    refute "Work dinner" in titles
    family = Jason.decode!(files["family.json"])
    assert Enum.map(family["linked_calendars"], & &1["name"]) == ["Lucy's family"]
    assert Enum.sort(Enum.map(family["people"], & &1["name"])) == ["Alex", "Lucy", "Mia"]
    refute files |> Map.values() |> Enum.join() =~ "hunter2"
  end

  test "removing an account takes what was only theirs and keeps what the family shares",
       %{admin: admin, lucy: lucy, kid: kid, room: room} do
    {:ok, _} = Chat.post_message(lucy, room.id, %{"body" => "Back at six"})
    {:ok, alexs} = Chat.post_message(admin, room.id, %{"body" => "Tea's ready"})
    :ok = Chat.toggle_reaction(lucy, alexs.id, Enum.at(Chat.reaction_emoji(), 0))
    media = photo(lucy, room)
    {:ok, direct} = Chat.direct_room(admin, lucy.id)
    {:ok, _} = Chat.post_message(admin, direct.id, %{"body" => "Can you get milk?"})
    {:ok, hers} = Tasks.create(lucy, %{"title" => "Water the plants", "user_ids" => [lucy.id], "days" => [1]})
    {:ok, shared} = Tasks.create(lucy, %{"title" => "Tidy up", "user_ids" => [lucy.id, kid.id], "days" => [1]})
    {:ok, event} = Calendar.create(lucy, %{"title" => "Swimming", "all_day" => true, "start_date" => "2026-10-25", "who" => [lucy.id, kid.id]})
    link(lucy, "family")

    conn = signed_in("Lucy")
    assert %{"error" => "That password isn't right."} = conn |> delete("/api/me", %{"password" => "nope"}) |> json_response(422)
    conn |> delete("/api/me", %{"password" => "Lucy password"}) |> json_response(200)
    assert conn |> get("/api/me") |> json_response(401)

    refute Repo.get(User, lucy.id)
    assert [%{deleted_at: %DateTime{}, body: nil, user_id: nil} | _] = Repo.all(from m in Message, where: m.room_id == ^room.id and m.kind == "text" and is_nil(m.user_id))
    refute File.exists?(Chat.media_path(media.key, media.content_type))
    assert Repo.get!(Message, alexs.id).body == "Tea's ready"
    assert Repo.preload(Repo.get!(Message, alexs.id), :reactions).reactions == []
    refute Repo.get(Task, hers.id)
    assert Repo.get!(Task, shared.id).user_ids == [kid.id]
    assert %{who: who, created_by_id: nil} = Repo.get!(Event, event.id)
    assert who == [kid.id]
    assert Repo.all(Link) == []
    refute Repo.exists?(from e in Family.Mailer.Email, where: e.to == "lucy@example.com")

    # Alex keeps his side of their chat.
    rooms = signed_in("Alex") |> get("/api/rooms") |> json_response(200)
    assert %{"name" => "Someone who left"} = Enum.find(rooms["rooms"], &(&1["id"] == direct.id))
  end

  test "the family keeps an admin, kids keep a grown-up, and kids ask a grown-up", %{admin: admin} do
    assert %{"error" => "The family needs an admin." <> _} = signed_in("Alex") |> delete("/api/me", %{"password" => "a good password"}) |> json_response(422)
    assert %{"error" => "Ask your guardian to delete your account."} = signed_in("Mia") |> delete("/api/me", %{"password" => "Mia password"}) |> json_response(422)

    gran = person_fixture(admin, "grownup", "Gran", %{"bubble_name" => "Gran's house"})
    cousin = person_fixture(admin, "kid", "Cousin", %{"bubble_id" => gran.bubble_id})
    alex = signed_in("Alex")
    assert signed_in("Lucy") |> delete("/api/people/#{cousin.id}", %{"confirm" => "Cousin"}) |> json_response(403)
    assert %{"error" => "The kids in this family need a guardian." <> _} = alex |> delete("/api/people/#{gran.id}", %{"confirm" => "Gran"}) |> json_response(422)
    assert %{"error" => "Type Cousin to be sure."} = alex |> delete("/api/people/#{cousin.id}", %{"confirm" => "cousin?"}) |> json_response(422)
    alex |> delete("/api/people/#{cousin.id}", %{"confirm" => "Cousin"}) |> json_response(200)
    alex |> delete("/api/people/#{gran.id}", %{"confirm" => "Gran"}) |> json_response(200)
    refute Repo.get(Bubble, gran.bubble_id)
  end
end
