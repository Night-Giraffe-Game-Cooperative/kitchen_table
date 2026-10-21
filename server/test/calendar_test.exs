defmodule Family.CalendarTest do
  use FamilyWeb.ConnCase, async: false
  alias Family.{Calendar, Repo}
  alias Family.Calendar.{DAV, Link, Links}
  alias Family.FakeCalDAV

  setup do
    admin = admin_fixture()
    mia = person_fixture(admin, "kid", "Mia")
    jo = person_fixture(admin, "grownup", "Jo")
    sam = person_fixture(admin, "grownup", "Sam", %{"bubble_name" => "The Smiths"})
    %{admin: admin, mia: mia, jo: jo, sam: sam}
  end

  defp swim(extra \\ %{}) do
    Map.merge(
      %{"title" => "Swimming", "emoji" => "🏊", "starts_at" => "2026-10-24T09:00:00+01:00", "ends_at" => "2026-10-24T10:00:00+01:00", "time_zone" => "Europe/London"},
      extra
    )
  end

  test "the home family sees the calendar; grown-ups change it; visitors don't see it", ctx do
    %{admin: admin, mia: mia, jo: jo, sam: sam} = ctx
    assert Calendar.can_see?(mia) and not Calendar.can_edit?(mia)
    assert Calendar.can_edit?(jo) and Calendar.can_edit?(admin)
    refute Calendar.can_see?(sam)

    assert {:error, :forbidden} = Calendar.create(mia, swim())
    assert {:error, :forbidden} = Calendar.create(sam, swim())

    FamilyWeb.Endpoint.subscribe("user:#{mia.id}")
    FamilyWeb.Endpoint.subscribe("user:#{sam.id}")
    {:ok, event} = Calendar.create(jo, swim(%{"who" => [mia.id]}))
    assert event.starts_at == ~U[2026-10-24 08:00:00Z]
    assert event.who == [mia.id]

    # A zone the server doesn't know becomes the family's own.
    {:ok, odd} = Calendar.create(jo, swim(%{"time_zone" => "Mars/Olympus_Mons", "repeat" => "weekly"}))
    assert odd.time_zone == "Europe/London"
    assert :ok = Calendar.delete(jo, odd.id)
    mia_topic = "user:#{mia.id}"
    assert_receive %{topic: ^mia_topic, event: "calendar_changed"}
    sam_topic = "user:#{sam.id}"
    refute_receive %{topic: ^sam_topic, event: "calendar_changed"}

    assert [%{title: "Swimming"}] = Calendar.list(mia, ~D[2026-10-01], ~D[2026-10-31])
    assert [] = Calendar.list(sam, ~D[2026-10-01], ~D[2026-10-31])

    # Only people who see the calendar can be on an event.
    assert {:error, "Only people who can see the calendar" <> _} = Calendar.create(jo, swim(%{"who" => [sam.id]}))
  end

  test "times and repeats are checked, and repeats are found in later months", %{jo: jo} do
    assert {:error, %Ecto.Changeset{errors: [ends_at: {"is before it starts", _}]}} =
             Calendar.create(jo, swim(%{"ends_at" => "2026-10-24T08:00:00+01:00"}))

    assert {:error, %Ecto.Changeset{errors: [title: _]}} = Calendar.create(jo, swim(%{"title" => "  "}))

    {:ok, _} = Calendar.create(jo, swim(%{"repeat" => "weekly"}))
    {:ok, _} = Calendar.create(jo, %{"title" => "Half term", "all_day" => true, "start_date" => "2026-10-26", "end_date" => "2026-10-30"})
    {:ok, _} = Calendar.create(jo, swim(%{"title" => "Old club", "repeat" => "weekly", "repeat_until" => "2026-10-31"}))

    assert ["Swimming"] = Calendar.list(jo, ~D[2026-12-01], ~D[2026-12-31]) |> Enum.map(& &1.title)
    assert ["Half term", "Swimming", "Old club"] = Calendar.list(jo, ~D[2026-10-26], ~D[2026-11-01]) |> Enum.map(& &1.title)
    # Before it starts, nothing.
    assert [] = Calendar.list(jo, ~D[2026-09-01], ~D[2026-09-30])
  end

  test "the calendar over the API", %{conn: conn, mia: mia} do
    jo = sign_in(conn, "jo@example.com", "Jo password")

    %{"event" => %{"id" => id, "all_day" => false, "starts_at" => "2026-10-24T08:00:00Z"}} =
      jo |> post("/api/calendar/events", swim(%{"who" => [mia.id]})) |> json_response(200)

    assert %{"event" => %{"title" => "Swimming lesson"}} =
             jo |> patch("/api/calendar/events/#{id}", %{"title" => "Swimming lesson"}) |> json_response(200)

    assert %{"events" => [%{"id" => ^id, "who" => [_], "link_id" => nil}], "can_edit" => true, "links" => [], "can_link" => true} =
             jo |> get("/api/calendar?from=2026-10-01&to=2026-10-31") |> json_response(200)

    kid = sign_in(build_conn() |> put_req_header("x-family", "1"), "mia@example.com", "Mia password")
    assert %{"events" => [_], "can_edit" => false} = kid |> get("/api/calendar?from=2026-10-01&to=2026-10-31") |> json_response(200)
    assert kid |> delete("/api/calendar/events/#{id}") |> json_response(403)
    assert kid |> post("/api/calendar/links/discover", %{"provider" => "icloud"}) |> json_response(403)

    assert %{"ok" => true} = jo |> delete("/api/calendar/events/#{id}") |> json_response(200)
    assert jo |> get("/api/calendar?from=2026-10-01&to=2027-12-31") |> json_response(422)
  end

  describe "linked calendars" do
    setup do
      {:ok, base} = FakeCalDAV.start()
      Application.put_env(:family, :icloud_url, base <> "/")
      on_exit(fn -> Application.delete_env(:family, :icloud_url) end)

      today = Date.utc_today()
      day = fn n -> Date.add(today, n) |> Date.to_iso8601(:basic) end

      # Already in iCloud: a dentist's appointment with an alarm, and swimming
      # every week.
      FakeCalDAV.put_object("/calendars/alex/family/dentist.ics", """
      BEGIN:VCALENDAR\r
      VERSION:2.0\r
      BEGIN:VEVENT\r
      UID:dentist\r
      DTSTART:#{day.(3)}T090000Z\r
      DTEND:#{day.(3)}T093000Z\r
      SUMMARY:Dentist\r
      BEGIN:VALARM\r
      ACTION:DISPLAY\r
      TRIGGER:-PT30M\r
      END:VALARM\r
      END:VEVENT\r
      END:VCALENDAR\r
      """)

      FakeCalDAV.put_object("/calendars/alex/family/swim.ics", """
      BEGIN:VCALENDAR\r
      VERSION:2.0\r
      BEGIN:VEVENT\r
      UID:swim\r
      DTSTART;TZID=Europe/London:#{day.(1)}T170000\r
      DTEND;TZID=Europe/London:#{day.(1)}T180000\r
      RRULE:FREQ=WEEKLY;COUNT=4\r
      SUMMARY:Swimming\r
      END:VEVENT\r
      END:VCALENDAR\r
      """)

      FakeCalDAV.put_object("/calendars/alex/holidays/xmas.ics", """
      BEGIN:VCALENDAR\r
      VERSION:2.0\r
      BEGIN:VEVENT\r
      UID:bank-holiday\r
      DTSTART;VALUE=DATE:#{day.(5)}\r
      SUMMARY:Bank holiday\r
      END:VEVENT\r
      END:VCALENDAR\r
      """)

      %{base: base, from: Date.add(today, -1), to: Date.add(today, 60)}
    end

    defp flush do
      receive do
        _ -> flush()
      after
        0 -> :ok
      end
    end

    defp icloud(extra \\ %{}), do: Map.merge(%{"provider" => "icloud", "username" => "alex", "password" => "app-password"}, extra)

    test "iCloud calendars go both ways", %{admin: admin, jo: jo, mia: mia, from: from, to: to} do
      assert {:error, "Apple didn't accept that" <> _} = Links.discover(admin, icloud(%{"password" => "my-apple-id-password"}))
      assert {:error, :forbidden} = Links.discover(mia, icloud())

      # The reminders list isn't for events, so it isn't offered.
      {:ok, found} = Links.discover(admin, icloud())
      assert [%{name: "Family", color: "#ff2968", writable: true} = family, %{name: "UK Holidays", writable: false} = holidays] = found
      assert family.url =~ ~r{^http://127\.0\.0\.1:\d+/calendars/alex/family/$}

      FamilyWeb.Endpoint.subscribe("user:#{mia.id}")
      {:ok, [fam, hols]} = Links.add(admin, icloud(%{"calendars" => [%{"url" => family.url}, %{"url" => holidays.url}], "share" => "family"}))
      mia_topic = "user:#{mia.id}"
      assert_receive %{topic: ^mia_topic, event: "calendar_changed"}

      # The first family calendar that can be added to is where new events go.
      assert fam.default and fam.writable and not hols.default
      # The password is sealed, never kept or sent as typed.
      refute Repo.get!(Link, fam.id).secret =~ "app-password"
      refute inspect(FamilyWeb.Present.link(fam, admin)) =~ "app-password"

      events = Calendar.list(mia, from, to)
      # All-day events come first.
      assert ["Bank holiday", "Swimming", "Dentist", "Swimming", "Swimming", "Swimming"] = Enum.map(events, & &1.title)
      assert Enum.all?(events, & &1.link_id)
      swims = Enum.filter(events, &(&1.title == "Swimming"))
      assert Enum.all?(swims, & &1.recurring)
      # Every week at five, London time, even when the clocks change.
      assert swims |> Enum.map(&(&1.starts_at |> DateTime.shift_zone!("Europe/London") |> DateTime.to_time())) |> Enum.uniq() == [~T[17:00:00]]

      # A grown-up adds an event: it's saved in iCloud and copied back.
      {:ok, party} =
        Calendar.create(jo, %{
          "title" => "Party, at Nan's",
          "emoji" => "🎉",
          "calendar" => fam.id,
          "who" => [mia.id],
          "starts_at" => "#{Date.add(Date.utc_today(), 7)}T14:00:00Z",
          "ends_at" => "#{Date.add(Date.utc_today(), 7)}T16:00:00Z"
        })

      assert party.link_id == fam.id and party.id
      {href, {data, _}} = Enum.find(FakeCalDAV.objects(), fn {_, {d, _}} -> d =~ "Party" end)
      assert data =~ "SUMMARY:Party\\, at Nan's\r\n"
      assert data =~ "X-KT-WHO:#{mia.id}\r\n"
      assert party.remote_href =~ href

      # Changing it here changes it there, keeping its alarm.
      dentist = Enum.find(events, &(&1.title == "Dentist"))
      {:ok, moved} = Calendar.update(jo, dentist.id, %{"title" => "Dentist (Mia)", "starts_at" => DateTime.to_iso8601(DateTime.add(dentist.starts_at, 3600)), "ends_at" => DateTime.to_iso8601(DateTime.add(dentist.ends_at, 3600))})
      assert moved.title == "Dentist (Mia)"
      {data, _} = FakeCalDAV.object("/calendars/alex/family/dentist.ics")
      assert data =~ "SUMMARY:Dentist (Mia)"
      assert data =~ "TRIGGER:-PT30M"
      assert data =~ "SEQUENCE:1"

      # What repeats there, or comes from a calendar that's only shown, is changed there.
      assert {:error, "This repeats in Family" <> _} = Calendar.update(jo, hd(swims).id, %{"title" => "Swim"})
      bank = Enum.find(events, &(&1.title == "Bank holiday"))
      assert {:error, "This is from UK Holidays" <> _} = Calendar.delete(jo, bank.id)
      assert {:error, "You can't add to that calendar."} = Calendar.create(jo, swim(%{"calendar" => hols.id}))

      # Deleting deletes it there too.
      :ok = Calendar.delete(jo, party.id)
      refute Enum.any?(FakeCalDAV.objects(), fn {_, {d, _}} -> d =~ "Party" end)

      # Something added on a phone shows up at the next copy; nothing
      # changed means nothing is fetched.
      FakeCalDAV.put_object("/calendars/alex/family/phone.ics", String.replace(FakeCalDAV.object("/calendars/alex/family/dentist.ics") |> elem(0), "UID:dentist", "UID:phone") |> String.replace("Dentist (Mia)", "Parents' evening"))
      :ok = Links.sync(fam)
      assert Enum.any?(Calendar.list(mia, from, to), &(&1.title == "Parents' evening"))
      reports = Enum.count(FakeCalDAV.log(), &(&1 == {"REPORT", "/calendars/alex/family/"}))
      :ok = Links.sync(fam)
      assert Enum.count(FakeCalDAV.log(), &(&1 == {"REPORT", "/calendars/alex/family/"})) == reports

      # Copying again when nothing has changed changes nothing here either.
      flush()
      :ok = Links.sync(fam, force: true)
      refute_receive %{topic: ^mia_topic, event: "calendar_changed"}

      # Unlinking leaves iCloud alone and takes the copies away.
      assert {:error, :forbidden} = Links.remove(jo, fam.id)
      :ok = Links.remove(admin, fam.id)
      assert Calendar.list(mia, from, to) |> Enum.map(& &1.title) == ["Bank holiday"]
      assert FakeCalDAV.object("/calendars/alex/family/dentist.ics")
    end

    test "a calendar just for me, a school's feed, and a wrong password", %{admin: admin, jo: jo, mia: mia, base: base, from: from, to: to} do
      {:ok, found} = Links.discover(jo, %{"provider" => "caldav", "url" => base <> "/.well-known/caldav", "username" => "alex", "password" => "app-password"})
      family = Enum.find(found, &(&1.name == "Family"))
      {:ok, [mine]} = Links.add(jo, %{"provider" => "caldav", "url" => base, "username" => "alex", "password" => "app-password", "calendars" => [%{"url" => family.url, "name" => "Jo's"}], "share" => "me"})
      assert mine.name == "Jo's" and mine.share == "me" and not mine.default

      assert Calendar.list(jo, from, to) |> Enum.map(& &1.title) |> Enum.member?("Dentist")
      assert Calendar.list(admin, from, to) == []
      assert Links.visible(admin) == []
      refute Links.may_manage?(admin, mine)

      {:ok, [school]} = Links.add(admin, %{"provider" => "ics", "url" => base <> "/feeds/school.ics"})
      assert {:ok, "https://example.com/basic.ics"} = DAV.address("webcal://example.com/basic.ics")
      assert {:ok, "https://p52-caldav.icloud.com/"} = DAV.address(" p52-caldav.icloud.com ")
      assert school.name == "Oak Primary" and not school.writable
      assert ["INSET day", "Year 2 trip to the zoo"] = Calendar.list(mia, from, to) |> Enum.map(& &1.title)
      assert {:error, "This is from Oak Primary" <> _} = Calendar.update(admin, hd(Calendar.list(admin, from, to)).id, %{"title" => "x"})

      # The password changes in iCloud: the link says so until it's put in again.
      Repo.update!(Ecto.Changeset.change(mine, secret: Family.Calendar.Vault.seal("old-password")))
      assert {:error, "Jo's wouldn't let the app in" <> _} = Links.sync(mine, force: true)
      assert Links.get(mine.id).last_error =~ "password"
      assert {:error, "That password wasn't accepted."} = Links.update(jo, mine.id, %{"password" => "nope"})
      {:ok, fixed} = Links.update(jo, mine.id, %{"password" => "app-password", "name" => "Jo's diary"})
      assert fixed.last_error == nil and fixed.name == "Jo's diary"
      assert :ok = Links.sync(fixed, force: true)

      # A feed saved as Latin-1 still reads properly.
      assert {:ok, %{data: data}} = DAV.fetch(base <> "/feeds/latin1.ics")
      assert String.valid?(data) and data =~ "Summer fête and café"

      # The server only reaches the internet unless told otherwise.
      Application.put_env(:family, :calendar_private_hosts, false)
      on_exit(fn -> Application.put_env(:family, :calendar_private_hosts, true) end)
      assert {:error, "127.0.0.1 is on a private network" <> _} = Links.add(admin, %{"provider" => "ics", "url" => base <> "/feeds/school.ics"})
    end

    test "linked calendars over the API", %{conn: conn} do
      admin = sign_in(conn, "alex@example.com", "a good password")
      %{"calendars" => calendars} = admin |> post("/api/calendar/links/discover", icloud()) |> json_response(200)
      assert [%{"name" => "Family", "writable" => true, "url" => url}, %{"name" => "UK Holidays"}] = calendars

      %{"links" => [%{"id" => id, "username" => "alex", "host" => "127.0.0.1"} = link]} =
        admin |> post("/api/calendar/links", icloud(%{"calendars" => [%{"url" => url}]})) |> json_response(200)

      refute Map.has_key?(link, "secret") or Map.has_key?(link, "password")
      assert %{"links" => [%{"id" => ^id}], "events" => [_ | _]} = admin |> get("/api/calendar?from=#{Date.utc_today()}&to=#{Date.add(Date.utc_today(), 60)}") |> json_response(200)

      jo = sign_in(build_conn() |> put_req_header("x-family", "1"), "jo@example.com", "Jo password")
      assert %{"links" => [%{"id" => ^id, "username" => nil, "can_write" => true, "can_manage" => false}]} = jo |> get("/api/calendar/links") |> json_response(200)
      assert jo |> delete("/api/calendar/links/#{id}") |> json_response(403)

      assert %{"link" => %{"name" => "Home", "color" => "#00aa55"}} = admin |> patch("/api/calendar/links/#{id}", %{"name" => "Home", "color" => "#00aa55"}) |> json_response(200)
      assert %{"link" => %{"last_error" => nil}} = admin |> post("/api/calendar/links/#{id}/sync") |> json_response(200)
      assert %{"error" => "Put in the password."} = admin |> post("/api/calendar/links/discover", icloud(%{"password" => ""})) |> json_response(422)
      assert %{"ok" => true} = admin |> delete("/api/calendar/links/#{id}") |> json_response(200)
    end
  end
end
