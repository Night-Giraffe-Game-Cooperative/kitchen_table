defmodule FamilyWeb.ApiTest do
  use FamilyWeb.ConnCase, async: false

  test "setup, sign-in, forced password change, and the header check", %{conn: conn} do
    assert %{"needed" => true} = conn |> get("/api/setup") |> json_response(200)

    conn = post(conn, "/api/setup", %{"name" => "Alex", "email" => "alex@example.com", "password" => "a good password"})
    assert %{"me" => %{"role" => "admin"}} = json_response(conn, 200)
    admin = recycle(conn) |> put_req_header("x-family", "1")

    resp = admin |> post("/api/people", %{"name" => "Mia", "email" => "mia@example.com", "role" => "kid"}) |> json_response(200)
    otp = resp["one_time_password"]
    assert resp["person"]["must_change_password"]

    kid = sign_in(build_conn() |> put_req_header("x-family", "1"), "mia@example.com", otp)
    assert %{"me" => %{"must_change_password" => true}} = kid |> get("/api/me") |> json_response(200)
    assert %{"error" => "must_change_password"} = kid |> get("/api/rooms") |> json_response(403)

    kid = kid |> post("/api/me/password", %{"current" => otp, "new" => "rainbow clouds"}) |> then(&recycle/1) |> put_req_header("x-family", "1")
    assert %{"rooms" => [%{"kind" => "family"}]} = kid |> get("/api/rooms") |> json_response(200)

    # Without the header, a change is refused even with a valid cookie.
    no_header = kid |> delete_req_header("x-family")
    assert no_header |> post("/api/rooms/1/messages", %{"body" => "hi"}) |> json_response(403)
  end

  test "wrong passwords are refused and limited", %{conn: conn} do
    admin_fixture()

    for _ <- 1..8 do
      assert conn |> post("/api/session", %{"email" => "alex@example.com", "password" => "nope"}) |> json_response(401)
    end

    assert conn |> post("/api/session", %{"email" => "alex@example.com", "password" => "nope"}) |> json_response(429)
    Family.RateLimit.reset({:email, "alex@example.com"})
  end

  test "photos upload, and only room members can see them", %{conn: conn} do
    admin = admin_fixture()
    person_fixture(admin, "grownup", "Jo")
    conn = sign_in(conn, "alex@example.com", "a good password")
    room = Family.Chat.family_room()

    png = Path.join(System.tmp_dir!(), "dot.png")
    File.write!(png, Base.decode64!("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="))
    upload = %Plug.Upload{path: png, filename: "dot.png", content_type: "image/png"}

    %{"media_id" => media_id, "media" => %{"url" => url}} =
      conn |> post("/api/rooms/#{room.id}/media", %{"file" => upload, "width" => "1", "height" => "1"}) |> json_response(200)

    assert %{"message" => %{"kind" => "photo"}} =
             conn |> post("/api/rooms/#{room.id}/messages", %{"kind" => "photo", "media_id" => media_id}) |> json_response(200)

    assert conn |> get(url) |> response(200)
    assert build_conn() |> get(url) |> response(404)

    fake = Path.join(System.tmp_dir!(), "fake.png")
    File.write!(fake, "not really a png")

    assert %{"error" => _} =
             conn
             |> post("/api/rooms/#{room.id}/media", %{"file" => %Plug.Upload{path: fake, filename: "fake.png", content_type: "image/png"}})
             |> json_response(422)
  end

  test "admins can read every chat without being in it", %{conn: conn} do
    admin = admin_fixture()
    kid = person_fixture(admin, "kid", "Mia")
    jo = person_fixture(admin, "grownup", "Jo")
    # Sam is a grown-up from another family.
    person_fixture(admin, "grownup", "Sam", %{"bubble_name" => "The Smiths"})

    {:ok, direct} = Family.Chat.direct_room(kid, jo.id)
    {:ok, said} = Family.Chat.post_message(kid, direct.id, %{"body" => "Can I have a biscuit?"})

    png = Path.join(System.tmp_dir!(), "dot.png")
    File.write!(png, Base.decode64!("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="))
    {:ok, media} = Family.Chat.store_media(kid, direct.id, %Plug.Upload{path: png, filename: "dot.png"}, %{})
    {:ok, _} = Family.Chat.post_message(kid, direct.id, %{"kind" => "photo", "media_id" => media.id})

    admin_conn = sign_in(conn, "alex@example.com", "a good password")
    rooms = admin_conn |> get("/api/rooms") |> json_response(200) |> Map.fetch!("rooms")
    assert %{"kind" => "family", "member" => true} = hd(rooms)
    seen = Enum.find(rooms, &(&1["id"] == direct.id))
    assert %{"member" => false, "unread" => 0, "name" => "Jo & Mia"} = seen
    assert seen["last_message"]["text"] =~ "Photo"

    messages = admin_conn |> get("/api/rooms/#{direct.id}/messages") |> json_response(200) |> Map.fetch!("messages")
    assert [%{"body" => "Can I have a biscuit?"}, %{"kind" => "photo", "media" => %{"url" => url}}] = messages
    assert admin_conn |> get(url) |> response(200)

    # Reading only: no writing, reacting or deleting there.
    assert admin_conn |> post("/api/rooms/#{direct.id}/messages", %{"body" => "No"}) |> json_response(403)
    assert admin_conn |> post("/api/messages/#{said.id}/reactions", %{"emoji" => "👍"}) |> json_response(404)
    assert admin_conn |> delete("/api/messages/#{said.id}") |> json_response(404)

    # A grown-up who isn't in it can't see it at all.
    sam_conn = sign_in(build_conn() |> put_req_header("x-family", "1"), "sam@example.com", "Sam password")
    refute sam_conn |> get("/api/rooms") |> json_response(200) |> Map.fetch!("rooms") |> Enum.any?(&(&1["id"] == direct.id))
    assert sam_conn |> get("/api/rooms/#{direct.id}/messages") |> json_response(404)
    assert sam_conn |> get(url) |> response(404)
  end

  test "family bubbles over the API: adding, listing and renaming", %{conn: conn} do
    admin_fixture()
    admin = sign_in(conn, "alex@example.com", "a good password")

    sam =
      admin
      |> post("/api/people", %{"name" => "Sam", "email" => "sam@example.com", "role" => "grownup", "bubble_name" => "The Smiths"})
      |> json_response(200)

    smiths = sam["person"]["bubble_id"]

    assert %{"error" => "Add a guardian from" <> _} =
             admin
             |> post("/api/people", %{"name" => "Ivy", "email" => "ivy@example.com", "role" => "kid", "bubble_name" => "The Joneses"})
             |> json_response(422)

    admin |> post("/api/people", %{"name" => "Ollie", "email" => "ollie@example.com", "role" => "kid", "bubble_id" => smiths}) |> json_response(200)

    %{"people" => people, "bubbles" => bubbles} = admin |> get("/api/people") |> json_response(200)
    assert [%{"name" => "Alex's family", "home" => true}, %{"id" => ^smiths, "name" => "The Smiths", "home" => false}] = bubbles
    assert %{"bubble_id" => ^smiths} = Enum.find(people, &(&1["name"] == "Ollie"))

    assert %{"bubble" => %{"name" => "Smith family"}} =
             admin |> patch("/api/bubbles/#{smiths}", %{"name" => "Smith family"}) |> json_response(200)

    # Sam sees Ollie's details, as Ollie's grown-up, but can't rename families.
    {:ok, _} = Family.Accounts.change_password(Family.Accounts.get_user(sam["person"]["id"]), sam["one_time_password"], "Sam password")
    sam_conn = sign_in(build_conn() |> put_req_header("x-family", "1"), "sam@example.com", "Sam password")
    seen = sam_conn |> get("/api/people") |> json_response(200) |> Map.fetch!("people")
    assert Enum.find(seen, &(&1["name"] == "Ollie"))["email"] == "ollie@example.com"
    refute Map.has_key?(Enum.find(seen, &(&1["name"] == "Alex")), "email")
    assert sam_conn |> patch("/api/bubbles/#{smiths}", %{"name" => "Ours"}) |> json_response(403)
  end

  describe "on the internet" do
    setup do
      Application.put_env(:family, :setup_code, true)
      Application.put_env(:family, :behind_proxy, true)
      File.rm(Path.join(Application.fetch_env!(:family, :data_dir), "setup_code"))

      on_exit(fn ->
        Application.delete_env(:family, :setup_code)
        Application.delete_env(:family, :behind_proxy)
        File.rm(Path.join(Application.fetch_env!(:family, :data_dir), "setup_code"))
      end)
    end

    test "the first admin needs the setup code", %{conn: conn} do
      assert %{"needed" => true, "code" => true} = conn |> get("/api/setup") |> json_response(200)
      code = File.read!(Path.join(Application.fetch_env!(:family, :data_dir), "setup_code"))
      me = %{"name" => "Alex", "email" => "alex@example.com", "password" => "a good password"}

      assert %{"error" => "That setup code isn't right."} = conn |> post("/api/setup", me) |> json_response(403)

      assert %{"error" => "That setup code isn't right."} =
               conn |> post("/api/setup", Map.put(me, "setup_code", "otter-maple-drum-42")) |> json_response(403)

      assert %{"me" => %{"role" => "admin"}} =
               conn |> post("/api/setup", Map.put(me, "setup_code", " #{String.upcase(code)} ")) |> json_response(200)

      refute File.exists?(Path.join(Application.fetch_env!(:family, :data_dir), "setup_code"))
      assert %{"needed" => false, "code" => false} = build_conn() |> get("/api/setup") |> json_response(200)
    end

    test "Caddy's headers say who's asking and that it was https, and only Caddy's", %{conn: conn} do
      admin_fixture()
      sign_in = %{"email" => "alex@example.com", "password" => "a good password"}

      via_caddy =
        conn
        |> put_req_header("x-forwarded-proto", "https")
        |> put_req_header("x-forwarded-for", "203.0.113.7")
        |> post("/api/session", sign_in)

      assert via_caddy.remote_ip == {203, 0, 113, 7}
      assert via_caddy.scheme == :https
      assert [cookie] = get_resp_header(via_caddy, "set-cookie")
      assert cookie =~ "secure"

      straight_in =
        %{build_conn() | remote_ip: {198, 51, 100, 9}}
        |> put_req_header("x-family", "1")
        |> put_req_header("x-forwarded-proto", "https")
        |> put_req_header("x-forwarded-for", "203.0.113.7")
        |> post("/api/session", sign_in)

      assert straight_in.remote_ip == {198, 51, 100, 9}
      assert straight_in.scheme == :http
    end
  end

  test "MOVED_TO sends everyone to the new address", %{conn: conn} do
    Application.put_env(:family, :moved_to, "https://family.example.org")
    on_exit(fn -> Application.delete_env(:family, :moved_to) end)

    conn = get(conn, "/rooms/3?x=1")
    assert redirected_to(conn, 302) == "https://family.example.org/rooms/3?x=1"
  end
end
