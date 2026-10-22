defmodule Family.CalendarConnectTest do
  use FamilyWeb.ConnCase, async: false
  import Ecto.Query
  alias Family.{Calendar, Repo}
  alias Family.Calendar.{Account, Connect, Event, Link, Links}
  alias Family.FakeConnect

  @site "https://kitchentable.example"

  setup do
    {:ok, _} = FakeConnect.start()
    on_exit(fn -> Application.delete_env(:family, :connect_urls) end)

    admin = admin_fixture()
    jo = person_fixture(admin, "grownup", "Jo")
    mia = person_fixture(admin, "kid", "Mia")
    %{admin: admin, jo: jo, mia: mia}
  end

  defp set_up(admin, provider) do
    {id, secret} = if provider == "google", do: FakeConnect.google_client(), else: FakeConnect.microsoft_client()
    :ok = Connect.setup(admin, provider, %{"client_id" => id, "client_secret" => secret})
  end

  # Signs in to a provider as someone in the family would, through the stand-in's yes.
  defp sign_in_to(user, provider, account \\ nil) do
    {:ok, url} = Connect.start(user, provider, @site, account)
    Connect.finish(user, provider, @site, FakeConnect.consent(provider, url))
  end

  defp rows(link), do: Repo.all(from e in Event, where: e.link_id == ^link.id, order_by: [e.start_date, e.starts_at])

  describe "setting up the apps registered with Google and Microsoft" do
    test "only an admin pastes them in, and a secret pasted as the ID is caught", %{admin: admin, jo: jo} do
      refute Connect.ready?("google")
      assert {:error, "Signing in to Google isn't set up yet" <> _} = Connect.start(jo, "google", @site)

      [google, microsoft] = Connect.status(admin, @site)
      assert %{provider: "google", ready: false, can_setup: true, redirect_uri: "https://kitchentable.example/calendar-connect/google"} = google
      assert microsoft.redirect_uri == "https://kitchentable.example/calendar-connect/microsoft"
      # Others see only whether it's ready.
      assert [%{ready: false, can_setup: false} = seen, _] = Connect.status(jo, @site)
      refute Map.has_key?(seen, :redirect_uri)

      assert {:error, :forbidden} = Connect.setup(jo, "google", %{"client_id" => "x.apps.googleusercontent.com", "client_secret" => "s"})
      assert {:error, "Google's client ID ends in" <> _} = Connect.setup(admin, "google", %{"client_id" => "GOCSPX-a-secret", "client_secret" => "s"})
      assert {:error, "Microsoft's client ID" <> _} = Connect.setup(admin, "microsoft", %{"client_id" => "abc", "client_secret" => "s"})
      assert {:error, "Put in the client secret."} = Connect.setup(admin, "google", %{"client_id" => "1-x.apps.googleusercontent.com"})

      set_up(admin, "google")
      assert Connect.ready?("google")
      # The secret is sealed, never kept as it was typed.
      refute Family.Settings.get("google_client_secret") =~ "google-secret"
      # Changing the ID keeps the secret.
      assert :ok = Connect.setup(admin, "google", %{"client_id" => "999-x.apps.googleusercontent.com", "client_secret" => ""})
      assert {:ok, "999-x.apps.googleusercontent.com", "google-secret", :app} = Connect.client("google")

      assert :ok = Connect.clear(admin, "google")
      refute Connect.ready?("google")
    end

    test "the server's own settings win, and then admins can't change them", %{admin: admin} do
      Application.put_env(:family, :connect_clients, %{"microsoft" => FakeConnect.microsoft_client()})
      on_exit(fn -> Application.delete_env(:family, :connect_clients) end)

      assert Connect.ready?("microsoft")
      assert [_, %{provider: "microsoft", ready: true, can_setup: false}] = Connect.status(admin, @site)
      assert {:error, "This server's own settings" <> _} = Connect.setup(admin, "microsoft", %{"client_id" => "x"})
    end
  end

  describe "Google" do
    setup %{admin: admin} do
      set_up(admin, "google")
      today = Date.utc_today()
      at = fn days, time -> "#{Date.add(today, days)}T#{time}+01:00" end

      FakeConnect.put_google("a-dentist", %{
        "status" => "confirmed",
        "iCalUID" => "dentist@google.com",
        "summary" => "Dentist",
        "description" => "Bring the <b>form</b><br>See <a href=\"https://example.com/form\">the form</a>",
        "location" => "High Street",
        "start" => %{"dateTime" => at.(3, "09:00:00"), "timeZone" => "Europe/London"},
        "end" => %{"dateTime" => at.(3, "09:30:00"), "timeZone" => "Europe/London"}
      })

      FakeConnect.put_google("b-swim_20261024", %{
        "status" => "confirmed",
        "iCalUID" => "swim@google.com",
        "recurringEventId" => "b-swim",
        "originalStartTime" => %{"dateTime" => at.(5, "17:00:00")},
        "summary" => "Swimming",
        "start" => %{"dateTime" => at.(5, "17:00:00")},
        "end" => %{"dateTime" => at.(5, "18:00:00")}
      })

      FakeConnect.put_google("c-camp", %{
        "status" => "confirmed",
        "summary" => "Camping",
        "start" => %{"date" => Date.to_iso8601(Date.add(today, 10))},
        "end" => %{"date" => Date.to_iso8601(Date.add(today, 13))},
        "extendedProperties" => %{"private" => %{"kt_emoji" => "⛺", "kt_who" => "1,2"}}
      })

      FakeConnect.put_google("d-gone", %{"status" => "cancelled", "start" => %{"date" => Date.to_iso8601(today)}})
      :ok
    end

    test "sign in, pick calendars, and their events come here", %{jo: jo, mia: mia} do
      {:ok, url} = Connect.start(jo, "google", @site)
      query = url |> URI.parse() |> Map.get(:query) |> URI.decode_query()
      assert url =~ "/google-accounts/o/oauth2/v2/auth?"
      assert %{"client_id" => "123-family.apps.googleusercontent.com", "redirect_uri" => "https://kitchentable.example/calendar-connect/google"} = query
      assert %{"access_type" => "offline", "prompt" => "consent", "code_challenge_method" => "S256"} = query
      assert query["scope"] =~ "calendar.events" and not (query["scope"] =~ "auth/calendar ")

      # Someone else can't finish Jo's sign-in.
      params = FakeConnect.consent("google", url)
      assert {:error, "This sign-in was started by someone else" <> _} = Connect.finish(mia, "google", @site, params)
      assert {:error, "Sign in to Kitchen Table" <> _} = Connect.finish(nil, "google", @site, params)
      assert {:error, "You said no to Google" <> _} = Connect.finish(jo, "google", @site, %{"error" => "access_denied", "state" => params["state"]})

      assert {:ok, %Account{email: "alex.family@gmail.com"} = account} = Connect.finish(jo, "google", @site, params)
      # The tokens are sealed.
      refute account.secret =~ "google-refresh"

      # Only Jo sees the account's calendars, Jo's own first.
      assert {:error, _} = Links.account_calendars(mia, account.id)
      assert {:ok, _, [own, holidays]} = Links.account_calendars(jo, account.id)
      assert %{url: "alex.family@gmail.com", name: "Alex", writable: true, color: "#9fc6e7"} = own
      assert %{name: "Holidays in the United Kingdom", writable: false} = holidays

      assert {:ok, [link, hol]} =
               Links.add(jo, %{"provider" => "google", "account" => account.id, "calendars" => [%{"url" => own.url}, %{"url" => holidays.url}]})

      assert %Link{provider: "google", writable: true, default: true, username: "alex.family@gmail.com", last_error: nil} = link
      assert %Link{writable: false, default: false} = hol

      [dentist, swim, camp] = rows(link)
      assert %{title: "Dentist", location: "High Street", recurring: false, source: "google", remote_href: "a-dentist"} = dentist
      assert dentist.notes == "Bring the form\nSee the form (https://example.com/form)"
      assert DateTime.to_time(dentist.starts_at) == ~T[08:00:00]
      assert %{title: "Swimming", recurring: true} = swim
      assert %{all_day: true, emoji: "⛺", who: [1, 2]} = camp
      assert Date.diff(camp.end_date, camp.start_date) == 2
      assert [%{title: "Christmas Day", all_day: true}] = rows(hol)

      # Mia sees them on the family calendar, and the account's email isn't shown to her.
      seen = Calendar.list(mia, Date.utc_today(), Date.add(Date.utc_today(), 30))
      assert Enum.any?(seen, &(&1.title == "Dentist"))
      assert %{host: "google.com", username: nil, account_id: nil} = FamilyWeb.Present.link(link, mia)
      assert %{username: "alex.family@gmail.com"} = FamilyWeb.Present.link(link, jo)
    end

    test "added, changed and deleted here, it's changed in Google", %{jo: jo} do
      {:ok, account} = sign_in_to(jo, "google")
      {:ok, [link]} = Links.add(jo, %{"provider" => "google", "account" => account.id, "calendars" => [%{"url" => "alex.family@gmail.com"}]})

      day = Date.add(Date.utc_today(), 4)

      assert {:ok, party} =
               Calendar.create(jo, %{
                 "title" => "Party",
                 "emoji" => "🎂",
                 "who" => [jo.id],
                 "starts_at" => "#{day}T14:00:00Z",
                 "ends_at" => "#{day}T16:00:00Z",
                 "time_zone" => "Europe/London",
                 "calendar" => link.id
               })

      assert party.link_id == link.id
      saved = FakeConnect.google(party.remote_href)
      assert %{"summary" => "Party", "start" => %{"dateTime" => starts, "timeZone" => "Europe/London"}} = saved
      assert starts == "#{day}T14:00:00Z"
      assert saved["extendedProperties"]["private"] == %{"kt_emoji" => "🎂", "kt_who" => "#{jo.id}"}

      assert {:ok, _} = Calendar.update(jo, party.id, %{"title" => "Mia's party", "all_day" => true, "start_date" => "#{day}", "end_date" => "#{day}"})
      assert %{"summary" => "Mia's party", "start" => %{"date" => date, "dateTime" => nil}} = FakeConnect.google(party.remote_href)
      assert date == Date.to_iso8601(day)

      # Changed in Google meanwhile: not overwritten.
      row = Repo.one(from e in Event, where: e.remote_href == ^party.remote_href)
      FakeConnect.put_google(party.remote_href, Map.delete(FakeConnect.google(party.remote_href), "etag"))
      assert {:error, "That event just changed in Alex" <> _} = Calendar.update(jo, row.id, %{"title" => "Lost"})

      # A repeating one is changed in Google.
      swim = Repo.one(from e in Event, where: e.title == "Swimming")
      assert {:error, "This repeats in Alex" <> _} = Calendar.update(jo, swim.id, %{"title" => "No"})

      Links.sync(link, force: true)
      row = Repo.one(from e in Event, where: e.remote_href == ^party.remote_href)
      assert :ok = Calendar.delete(jo, row.id)
      assert FakeConnect.google(party.remote_href) == nil
      refute Repo.exists?(from e in Event, where: e.remote_href == ^party.remote_href)
    end

    test "nothing new in Google, nothing copied; a token that ran out is refreshed", %{jo: jo} do
      {:ok, account} = sign_in_to(jo, "google")
      {:ok, [link]} = Links.add(jo, %{"provider" => "google", "account" => account.id, "calendars" => [%{"url" => "alex.family@gmail.com"}]})
      lists = fn -> Enum.count(FakeConnect.log(), &(&1 == {"GET", "/google-api/calendars/alex.family%40gmail.com/events"})) end
      before = lists.()

      Links.sync(Repo.get(Link, link.id))
      # Asked when it last changed, and not for the events again.
      assert lists.() == before + 1

      # Google turns the old access token down: a new one, and on it goes.
      FakeConnect.expire("google")
      FakeConnect.put_google("e-new", %{"status" => "confirmed", "summary" => "Football", "start" => %{"date" => Date.to_iso8601(Date.utc_today())}, "end" => %{"date" => Date.to_iso8601(Date.add(Date.utc_today(), 1))}})
      assert :ok = Links.sync(Repo.get(Link, link.id))
      assert Enum.any?(rows(link), &(&1.title == "Football"))
      assert {"POST", "/google-oauth/token"} in FakeConnect.log()
    end

    test "when Google lets go of the app, they're asked to sign in again, and then it carries on", %{jo: jo} do
      {:ok, account} = sign_in_to(jo, "google")
      {:ok, [link]} = Links.add(jo, %{"provider" => "google", "account" => account.id, "calendars" => [%{"url" => "alex.family@gmail.com"}]})

      FakeConnect.revoke("google")
      FakeConnect.expire("google")
      assert {:error, message} = Links.sync(Repo.get(Link, link.id), force: true)
      assert message =~ "needs signing in to Google again"
      assert Repo.get(Link, link.id).last_error == message

      # Signing in again as someone else isn't the same account.
      {:ok, url} = Connect.start(jo, "google", @site, account.id)
      assert URI.decode_query(URI.parse(url).query)["login_hint"] == "alex.family@gmail.com"
      assert {:ok, %Account{id: same}} = Connect.finish(jo, "google", @site, FakeConnect.consent("google", url))
      assert same == account.id
      assert Repo.get(Link, link.id).last_synced_at == nil
      assert :ok = Links.sync(Repo.get(Link, link.id), force: true)
      assert Repo.get(Link, link.id).last_error == nil
    end

    test "unlinking its last calendar lets the account go, and Google is told", %{jo: jo} do
      {:ok, account} = sign_in_to(jo, "google")
      {:ok, [a, b]} = Links.add(jo, %{"provider" => "google", "account" => account.id, "calendars" => [%{"url" => "alex.family@gmail.com"}, %{"url" => "en.uk#holiday@group.v.calendar.google.com"}]})

      assert :ok = Links.remove(jo, a.id)
      assert Repo.get(Account, account.id)
      assert :ok = Links.remove(jo, b.id)
      refute Repo.get(Account, account.id)
      Process.sleep(200)
      assert [_] = FakeConnect.revoked()
    end
  end

  describe "Microsoft" do
    setup %{admin: admin} do
      set_up(admin, "microsoft")
      today = Date.utc_today()

      FakeConnect.put_graph("AAMk-1", %{
        "iCalUId" => "040000008200E00074C5B7101A82E008",
        "subject" => "Parents' evening",
        "body" => %{"contentType" => "text", "content" => "Room 4"},
        "location" => %{"displayName" => "Oak Primary"},
        "isAllDay" => false,
        "type" => "singleInstance",
        "start" => %{"dateTime" => "#{Date.add(today, 2)}T17:30:00.0000000", "timeZone" => "UTC"},
        "end" => %{"dateTime" => "#{Date.add(today, 2)}T18:00:00.0000000", "timeZone" => "UTC"}
      })

      # All day in the UK, so midnight there is 23:00 the day before in UTC.
      FakeConnect.put_graph("AAMk-2", %{
        "subject" => "Inset day",
        "isAllDay" => true,
        "type" => "occurrence",
        "start" => %{"dateTime" => "#{Date.add(today, 6)}T23:00:00.0000000", "timeZone" => "UTC"},
        "end" => %{"dateTime" => "#{Date.add(today, 7)}T23:00:00.0000000", "timeZone" => "UTC"}
      })

      FakeConnect.put_graph("AAMk-3", %{"subject" => "Cancelled", "isCancelled" => true, "start" => %{"dateTime" => "#{today}T10:00:00", "timeZone" => "UTC"}, "end" => %{"dateTime" => "#{today}T11:00:00", "timeZone" => "UTC"}})
      :ok
    end

    test "sign in, link, and it goes both ways", %{jo: jo} do
      {:ok, url} = Connect.start(jo, "microsoft", @site)
      assert url =~ "/microsoft-login/common/oauth2/v2.0/authorize?"
      assert URI.decode_query(URI.parse(url).query)["scope"] == "openid email offline_access Calendars.ReadWrite"

      assert {:ok, %Account{email: "alex.family@outlook.com"} = account} = Connect.finish(jo, "microsoft", @site, FakeConnect.consent("microsoft", url))
      assert {:ok, _, [%{name: "Calendar", writable: true, color: "#e9a06b"}, %{name: "Birthdays", writable: false, color: nil}]} = Links.account_calendars(jo, account.id)

      assert {:ok, [link]} = Links.add(jo, %{"provider" => "microsoft", "account" => account.id, "calendars" => [%{"url" => "AAMkAGI2-calendar="}], "share" => "me"})
      assert %{share: "me", default: false, writable: true} = link

      [evening, inset] = rows(link)
      assert %{title: "Parents' evening", notes: "Room 4", location: "Oak Primary", recurring: false} = evening
      assert DateTime.to_time(evening.starts_at) == ~T[17:30:00]
      assert %{all_day: true, recurring: true} = inset
      assert inset.start_date == Date.add(Date.utc_today(), 7) and inset.end_date == inset.start_date

      day = Date.add(Date.utc_today(), 9)

      assert {:ok, picnic} =
               Calendar.create(jo, %{"title" => "Picnic", "emoji" => "🧺", "all_day" => true, "start_date" => "#{day}", "end_date" => "#{day}", "calendar" => link.id})

      saved = FakeConnect.graph(picnic.remote_href)
      assert %{"subject" => "Picnic", "isAllDay" => true, "start" => %{"dateTime" => start, "timeZone" => "UTC"}} = saved
      assert start == "#{day}T00:00:00"
      assert Enum.any?(saved["singleValueExtendedProperties"], &(&1["value"] == "🧺"))

      # The emoji comes back with it, as Graph sends extended properties when asked.
      [picnic_row] = Enum.filter(rows(Repo.get(Link, link.id)), &(&1.title == "Picnic"))
      assert picnic_row.emoji == "🧺"

      assert {:ok, _} = Calendar.update(jo, picnic_row.id, %{"title" => "Picnic in the park"})
      assert FakeConnect.graph(picnic.remote_href)["subject"] == "Picnic in the park"
      [row] = Enum.filter(rows(Repo.get(Link, link.id)), &(&1.title == "Picnic in the park"))
      assert :ok = Calendar.delete(jo, row.id)
      assert FakeConnect.graph(picnic.remote_href) == nil
    end

    test "Microsoft's new refresh token each time is kept", %{jo: jo} do
      {:ok, account} = sign_in_to(jo, "microsoft")
      {:ok, [link]} = Links.add(jo, %{"provider" => "microsoft", "account" => account.id, "calendars" => [%{"url" => "AAMkAGI2-calendar="}]})

      for _ <- 1..2 do
        FakeConnect.expire("microsoft")
        assert :ok = Links.sync(Repo.get(Link, link.id), force: true)
      end

      assert Repo.get(Link, link.id).last_error == nil
    end
  end

  describe "the web" do
    test "Google sends someone back: on to pick calendars, or a page saying what went wrong", %{conn: conn, admin: admin} do
      set_up(admin, "google")
      jo = sign_in(conn, "jo@example.com", "Jo password")

      %{"providers" => [%{"provider" => "google", "ready" => true}, %{"provider" => "microsoft", "ready" => false}]} =
        jo |> get("/api/calendar/connect") |> json_response(200)

      %{"url" => url} = jo |> post("/api/calendar/connect/google/start", %{}) |> json_response(200)
      assert jo |> post("/api/calendar/connect/yahoo/start", %{}) |> json_response(404)
      params = FakeConnect.consent("google", url)

      # Signed out, it can't be finished.
      page = build_conn() |> get("/calendar-connect/google", params) |> html_response(400)
      assert page =~ "Sign in to Kitchen Table in this browser first"

      back = jo |> recycle() |> get("/calendar-connect/google", params)
      assert "/#/calendar/link/" <> id = redirected_to(back)

      jo = recycle(jo) |> put_req_header("x-family", "1")
      assert %{"account" => %{"email" => "alex.family@gmail.com"}, "calendars" => [%{"name" => "Alex"}, _]} =
               jo |> get("/api/calendar/accounts/#{id}/calendars") |> json_response(200)

      # The same code doesn't work twice.
      page = jo |> get("/calendar-connect/google", params) |> html_response(400)
      assert page =~ "accept the sign-in"
    end
  end
end
