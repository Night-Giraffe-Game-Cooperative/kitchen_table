defmodule Family.PushTest do
  use FamilyWeb.ConnCase, async: false
  import Ecto.Query
  alias Family.{Calls, Chat, FakePush, Games, Repo}
  alias Family.Push.{App, Inbox, Subscription, WebPush}

  setup do
    {:ok, base} = FakePush.start(self())
    Family.RateLimit.reset({:inbox, {127, 0, 0, 1}})
    admin = admin_fixture()
    lucy = person_fixture(admin, "grownup", "Lucy")
    kid = person_fixture(admin, "kid", "Mia")
    %{base: base, admin: admin, lucy: lucy, kid: kid, room: Chat.family_room()}
  end

  defp signed_in(name) do
    password = if name == "Alex", do: "a good password", else: "#{name} password"
    sign_in(build_conn() |> put_req_header("x-family", "1"), "#{String.downcase(name)}@example.com", password)
  end

  defp switch_on(conn, browser, endpoint) do
    conn |> post("/api/push/subscriptions", %{"subscription" => FakePush.subscription(browser, endpoint), "device" => "Chrome on Android"}) |> json_response(200)
  end

  # The Android app, switched on from the page inside it.
  defp app_on(conn, extra \\ %{}) do
    conn |> post("/api/push/app", Map.merge(%{"device" => "Kitchen Table app on Galaxy Tab A9"}, extra)) |> json_response(200)
  end

  # The app checking from the background, with its key and no cookie.
  defp inbox(key, seen \\ nil) do
    build_conn() |> put_req_header("authorization", "Bearer " <> key) |> get("/api/push/inbox", if(seen, do: %{"seen" => seen}, else: %{}))
  end

  defp looking(user, active) do
    key = to_string(user.id)

    case FamilyWeb.Presence.get_by_key("family:presence", key) do
      [] -> {:ok, _} = FamilyWeb.Presence.track(self(), "family:presence", key, %{active: active})
      _ -> {:ok, _} = FamilyWeb.Presence.update(self(), "family:presence", key, %{active: active})
    end
  end

  test "encrypts as RFC 8291's worked example does" do
    d = &Base.url_decode64!(&1, padding: false)
    sender = {d.("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"), d.("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")}
    browser = d.("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")

    out = WebPush.encrypt("When I grow up, I want to be a watermelon", browser, d.("BTBZMqHH6r4Tts7J_aSIgg"), sender, d.("DGv6ra1nlYgDCS1FRnbzlw"))

    assert Base.url_encode64(out, padding: false) ==
             "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
  end

  test "each notification is signed by the server and readable only by its browser", %{base: base} do
    browser = FakePush.browser()
    sub = %{endpoint: base <> "/one", p256dh: Base.url_encode64(browser.public, padding: false), auth: Base.url_encode64(browser.auth, padding: false)}

    assert :ok = WebPush.send(sub, ~s({"title":"Hello"}), ttl: 60, urgency: "high", topic: "room-1")
    assert_receive {:push, "/one", headers, body}
    assert %{"content-encoding" => "aes128gcm", "ttl" => "60", "urgency" => "high", "topic" => "room-1"} = headers
    assert FakePush.decrypt(body, browser) == %{"title" => "Hello"}

    # The signature checks out against the key browsers subscribe with.
    ["vapid t=" <> jwt, "k=" <> key] = String.split(headers["authorization"], ", ")
    assert key == WebPush.public_key()
    [h, c, s] = String.split(jwt, ".")
    <<r::unsigned-256, s_::unsigned-256>> = Base.url_decode64!(s, padding: false)
    der = :public_key.der_encode(:"ECDSA-Sig-Value", {:"ECDSA-Sig-Value", r, s_})
    assert :crypto.verify(:ecdsa, :sha256, h <> "." <> c, der, [Base.url_decode64!(key, padding: false), :prime256v1])

    claims = c |> Base.url_decode64!(padding: false) |> Jason.decode!()
    assert claims["aud"] == base
    assert claims["exp"] - System.system_time(:second) in 3600..86_400
    assert is_binary(claims["sub"])
  end

  test "messages reach the others in the chat, unless they're using the app, muted it or signed out",
       %{base: base, admin: admin, lucy: lucy, kid: kid, room: room} do
    alex = signed_in("Alex")
    lucy_conn = signed_in("Lucy")
    mia = signed_in("Mia")
    lucy_phone = FakePush.browser()
    mia_tablet = FakePush.browser()

    assert %{"devices" => [%{"device" => "Chrome on Android"} = device]} = switch_on(lucy_conn, lucy_phone, base <> "/lucy")
    refute Map.has_key?(device, "endpoint")
    switch_on(mia, mia_tablet, base <> "/mia")
    switch_on(alex, FakePush.browser(), base <> "/alex")

    # Mia has the app open, so it shows her there instead.
    looking(kid, true)
    alex |> post("/api/rooms/#{room.id}/messages", %{"body" => "Tea's ready"}) |> json_response(200)

    assert_receive {:push, "/lucy", _, body}
    assert %{"kind" => "message", "body" => "Alex: Tea's ready", "tag" => tag, "url" => url} = FakePush.decrypt(body, lucy_phone)
    assert tag == "room-#{room.id}" and url == "/#/chats/#{room.id}"
    refute_receive {:push, "/mia", _, _}
    refute_receive {:push, "/alex", _, _}

    # She puts the tablet down; Lucy mutes the family chat.
    looking(kid, false)
    lucy_conn |> put("/api/rooms/#{room.id}/muted", %{"muted" => true}) |> json_response(200)
    assert %{"rooms" => [%{"muted" => true}]} = lucy_conn |> get("/api/rooms") |> json_response(200)
    alex |> post("/api/rooms/#{room.id}/messages", %{"body" => "Bath time"}) |> json_response(200)
    assert_receive {:push, "/mia", _, body}
    assert %{"body" => "Alex: Bath time"} = FakePush.decrypt(body, mia_tablet)
    refute_receive {:push, "/lucy", _, _}

    # A direct message is titled with who sent it.
    %{"room_id" => direct} = alex |> post("/api/rooms/direct/#{lucy.id}") |> json_response(200)
    alex |> post("/api/rooms/#{direct}/messages", %{"body" => "Back at 6"}) |> json_response(200)
    assert_receive {:push, "/lucy", _, body}
    assert %{"title" => "Alex", "body" => "Back at 6"} = FakePush.decrypt(body, lucy_phone)

    # The test button reaches the device it's pressed on.
    lucy_conn |> post("/api/push/test", %{"endpoint" => base <> "/lucy"}) |> json_response(200)
    assert_receive {:push, "/lucy", _, body}
    assert %{"kind" => "test"} = FakePush.decrypt(body, lucy_phone)

    # Signing out on her phone stops its notifications.
    lucy_conn |> delete("/api/session") |> json_response(200)
    assert Repo.aggregate(from(s in Subscription, where: s.user_id == ^lucy.id), :count) == 0
    _ = admin
  end

  test "quiet hours keep a kid's tablet quiet", %{base: base, admin: admin, kid: kid, room: room} do
    now = DateTime.now!("Europe/London")
    hours = %{"from" => now |> DateTime.add(-3600) |> Calendar.strftime("%H:%M"), "to" => now |> DateTime.add(3600) |> Calendar.strftime("%H:%M")}
    {:ok, _} = Family.Accounts.set_permissions(admin, kid, %{}, hours)
    switch_on(signed_in("Mia"), FakePush.browser(), base <> "/mia")
    {:ok, _} = Chat.post_message(admin, room.id, %{"body" => "Night night"})
    refute_receive {:push, "/mia", _, _}
  end

  test "a subscription the browser dropped is forgotten", %{base: base, admin: admin, lucy: lucy, room: room} do
    switch_on(signed_in("Lucy"), FakePush.browser(), base <> "/gone/1")
    {:ok, _} = Chat.post_message(admin, room.id, %{"body" => "Hello?"})
    assert_receive {:push, "/gone/1", _, _}
    assert Repo.aggregate(from(s in Subscription, where: s.user_id == ^lucy.id), :count) == 0
  end

  test "addresses and keys that don't look right are refused", %{base: base} do
    lucy = signed_in("Lucy")
    browser = FakePush.browser()
    bad_key = put_in(FakePush.subscription(browser, base <> "/x"), ["keys", "p256dh"], Base.url_encode64(<<4>> <> :binary.copy(<<1>>, 64), padding: false))
    short_auth = put_in(FakePush.subscription(browser, base <> "/x"), ["keys", "auth"], "abc")

    assert lucy |> post("/api/push/subscriptions", %{"subscription" => bad_key}) |> json_response(422)
    assert lucy |> post("/api/push/subscriptions", %{"subscription" => short_auth}) |> json_response(422)
    assert lucy |> post("/api/push/subscriptions", %{"subscription" => "nope"}) |> json_response(422)

    # Outside tests, only the internet's push services, over https.
    Application.put_env(:family, :push_private_hosts, false)
    on_exit(fn -> Application.put_env(:family, :push_private_hosts, true) end)
    assert lucy |> post("/api/push/subscriptions", %{"subscription" => FakePush.subscription(browser, base <> "/x")}) |> json_response(422)
    assert lucy |> post("/api/push/subscriptions", %{"subscription" => FakePush.subscription(browser, "https://127.0.0.1/x")}) |> json_response(422)
    assert %{"devices" => []} = lucy |> get("/api/push") |> json_response(200)
  end

  test "calls ring, then say they were missed; games say whose go it is", %{base: base, admin: admin, lucy: lucy, room: room} do
    Application.put_env(:family, :call_grace_ms, 20)
    on_exit(fn -> Application.delete_env(:family, :call_grace_ms) end)
    phone = FakePush.browser()
    switch_on(signed_in("Lucy"), phone, base <> "/lucy")

    {:ok, _} = Calls.join(room.id, "dad-tablet", admin.id)
    assert_receive {:push, "/lucy", headers, body}
    assert %{"urgency" => "high", "ttl" => "45"} = headers
    assert %{"kind" => "call", "title" => "Alex is calling"} = FakePush.decrypt(body, phone)

    Calls.leave(room.id, "dad-tablet")
    assert_receive {:push, "/lucy", _, body}, 1_000
    assert %{"kind" => "missed", "title" => "Missed call from Alex"} = FakePush.decrypt(body, phone)

    {:ok, game} =
      Games.create(admin, room.id, %{"type" => "chess", "mode" => "versus", "seats" => %{"w" => admin.id, "b" => lucy.id}, "state" => %{"turn" => "w"}})

    # Lucy is asked to play; the chat itself stays quiet.
    assert_receive {:push, "/lucy", _, body}
    assert %{"kind" => "game", "title" => "New game", "body" => "Alex started Chess with you."} = FakePush.decrypt(body, phone)
    refute_receive {:push, "/lucy", _, _}, 100
    {:ok, _} = Games.move(admin, game.id, %{"version" => game.version, "state" => %{"turn" => "b"}})
    assert_receive {:push, "/lucy", _, body}
    assert %{"kind" => "turn", "body" => "Alex has had a go in Chess.", "url" => url} = FakePush.decrypt(body, phone)
    assert url == "/#/games/#{game.id}"

    # Play again reaches whoever played last time, even without a seat now.
    word_garden = fn seats, extra -> Map.merge(%{"type" => "word_garden", "mode" => "coop", "seats" => seats, "state" => %{"turn" => "anyone"}}, extra) end
    finish = fn g -> Games.move(admin, g.id, %{"version" => g.version, "state" => %{"turn" => "anyone"}, "status" => "finished"}) end
    {:ok, other} = Games.create(admin, room.id, word_garden.(%{}, %{}))
    {:ok, other} = finish.(other)
    {:ok, _} = Games.create(admin, room.id, word_garden.(%{}, %{"after" => other.id}))
    refute_receive {:push, "/lucy", _, _}, 100
    {:ok, done} = Games.create(admin, room.id, word_garden.(%{"p1" => lucy.id}, %{}))
    assert_receive {:push, "/lucy", _, _}
    {:ok, done} = finish.(done)
    {:ok, _} = Games.create(admin, room.id, word_garden.(%{}, %{"after" => done.id}))
    assert_receive {:push, "/lucy", _, body}
    assert %{"title" => "Next round", "body" => "Alex started the next round of Word Garden."} = FakePush.decrypt(body, phone)

    # With games switched off for her, it's no news to Lucy whose go it is.
    {:ok, game} = Games.move(lucy, game.id, %{"version" => game.version + 1, "state" => %{"turn" => "w"}})
    {:ok, _} = Family.Accounts.set_permissions(admin, lucy, %{"play_games" => false}, nil)
    {:ok, _} = Games.move(admin, game.id, %{"version" => game.version, "state" => %{"turn" => "b"}})
    refute_receive {:push, "/lucy", _, _}, 200
  end

  test "the Android app fetches its own notifications with its key, not the cookie", %{admin: admin, room: room} do
    lucy = signed_in("Lucy")
    assert %{"token" => key, "endpoint" => "app:" <> _ = endpoint, "devices" => [device]} = app_on(lucy)
    assert %{"device" => "Kitchen Table app on Galaxy Tab A9", "last_used_at" => nil} = device
    refute Map.has_key?(device, "token")

    {:ok, _} = Chat.post_message(admin, room.id, %{"body" => "Tea's ready"})
    assert %{"notifications" => [%{"id" => id, "kind" => "message", "body" => "Alex: Tea's ready", "url" => url}]} = inbox(key) |> json_response(200)
    assert url == "/#/chats/#{room.id}"

    # It waits until the app says it has shown it, so none go missing.
    assert %{"notifications" => [%{"id" => ^id}]} = inbox(key) |> json_response(200)
    assert %{"notifications" => []} = inbox(key, id) |> json_response(200)
    {:ok, _} = Chat.post_message(admin, room.id, %{"body" => "Coats on"})
    {:ok, _} = Chat.post_message(admin, room.id, %{"body" => "Shoes on"})
    assert %{"notifications" => [%{"id" => a, "body" => "Alex: Coats on"}, %{"id" => b}]} = inbox(key) |> json_response(200)
    assert %{"notifications" => []} = inbox(key, "#{a},#{b}") |> json_response(200)
    assert %{"devices" => [%{"last_used_at" => used}]} = lucy |> get("/api/push") |> json_response(200)
    assert used

    # The cookie alone won't do, nor will a made-up key.
    assert lucy |> get("/api/push/inbox") |> json_response(401)
    assert inbox(Base.url_encode64(:crypto.strong_rand_bytes(32), padding: false)) |> json_response(401)
    assert inbox("nonsense") |> json_response(401)

    # Opening the app again keeps the same key and the same device.
    assert %{"token" => ^key, "endpoint" => ^endpoint, "devices" => [_]} = app_on(lucy, %{"token" => key})

    # The test button reaches it too.
    lucy |> post("/api/push/test", %{"endpoint" => endpoint}) |> json_response(200)
    assert %{"notifications" => [%{"kind" => "test", "url" => "/#/me"}]} = inbox(key) |> json_response(200)

    # Switching it off stops them.
    assert %{"devices" => []} = lucy |> delete("/api/push/subscriptions", %{"endpoint" => endpoint}) |> json_response(200)
    assert inbox(key) |> json_response(401)
  end

  test "what waits for the app is replaced, joined up and dropped as a push service would", %{admin: admin, lucy: lucy, room: room} do
    %{"token" => key, "endpoint" => endpoint} = app_on(signed_in("Lucy"))
    sub = Repo.one!(from s in Subscription, where: s.endpoint == ^endpoint)
    waiting = fn -> inbox(key) |> json_response(200) |> Map.fetch!("notifications") end

    # Lucy is asked to play, then it's her turn: only her turn is news now.
    {:ok, game} =
      Games.create(admin, room.id, %{"type" => "chess", "mode" => "versus", "seats" => %{"w" => admin.id, "b" => lucy.id}, "state" => %{"turn" => "w"}})

    {:ok, _} = Games.move(admin, game.id, %{"version" => game.version, "state" => %{"turn" => "b"}})
    assert [%{"kind" => "turn", "url" => url}] = waiting.()
    assert url == "/#/games/#{game.id}"

    # A chat keeps its last five messages, to join up in one notification.
    for n <- 1..7, do: {:ok, _} = Chat.post_message(admin, room.id, %{"body" => "Message #{n}"})
    assert for(%{"kind" => "message", "body" => body} <- waiting.(), do: body) == for(n <- 3..7, do: "Alex: Message #{n}")

    # A missed call replaces the ringing; anything out of date goes.
    App.send(sub, %{kind: "call", title: "Alex is calling"}, ttl: 45, topic: "call-1")
    App.send(sub, %{kind: "missed", title: "Missed call from Alex"}, topic: "call-1")
    assert [%{"kind" => "missed"}] = Enum.filter(waiting.(), &(&1["kind"] in ["call", "missed"]))
    Repo.update_all(from(i in Inbox, where: i.topic == "call-1"), set: [expires_at: DateTime.add(DateTime.utc_now(:second), -1)])
    refute Enum.any?(waiting.(), &(&1["kind"] == "missed"))

    # A device that's been away a long time keeps the newest 50.
    for n <- 1..60, do: App.send(sub, %{kind: "family", title: "News #{n}"}, topic: "news-#{n}")
    assert [%{"title" => "News 11"} | _] = list = waiting.()
    assert length(list) == 50
  end

  test "the app's device goes to whoever signs in on it next, without what was waiting for the last person",
       %{admin: admin, lucy: lucy, room: room} do
    %{"token" => key, "endpoint" => endpoint} = app_on(signed_in("Lucy"))
    {:ok, _} = Chat.post_message(admin, room.id, %{"body" => "Just for Lucy"})

    # Lucy's sign-in runs out, so the app hears nothing for now.
    Repo.update_all(from(t in Family.Accounts.Token, where: t.user_id == ^lucy.id), set: [last_used_at: ~U[2020-01-01 00:00:00Z]])
    assert inbox(key) |> json_response(401)

    # Mia signs in on the tablet, and the page there hands back the app's key.
    mia = signed_in("Mia")
    assert %{"token" => ^key, "endpoint" => ^endpoint, "devices" => [_]} = app_on(mia, %{"token" => key})
    assert %{"notifications" => []} = inbox(key) |> json_response(200)
    {:ok, _} = Chat.post_message(admin, room.id, %{"body" => "Hello Mia"})
    assert %{"notifications" => [%{"body" => "Alex: Hello Mia"}]} = inbox(key) |> json_response(200)

    # Signing out there stops them.
    mia |> delete("/api/session") |> json_response(200)
    assert inbox(key) |> json_response(401)
  end
end
