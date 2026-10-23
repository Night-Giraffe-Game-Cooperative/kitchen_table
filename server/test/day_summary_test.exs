defmodule Family.DaySummaryTest do
  use FamilyWeb.ConnCase, async: false
  alias Family.{Calendar, DaySummary, FakePush, Repo, Tasks}
  alias Family.Accounts.User

  # Friday 23 October 2026, in the family's own time.
  @day ~D[2026-10-23]

  setup do
    {:ok, base} = FakePush.start(self())
    admin = admin_fixture()
    jo = person_fixture(admin, "grownup", "Jo")
    mia = person_fixture(admin, "kid", "Mia")
    ruby = person_fixture(admin, "kid", "Ruby")
    sam = person_fixture(admin, "grownup", "Sam", %{"bubble_name" => "The Smiths"})
    ollie = person_fixture(admin, "kid", "Ollie", %{"bubble_id" => sam.bubble_id})
    %{base: base, admin: admin, jo: jo, mia: mia, ruby: ruby, sam: sam, ollie: ollie}
  end

  defp event(by, attrs) do
    {:ok, e} = Calendar.create(by, Map.merge(%{"emoji" => "📅", "time_zone" => "Europe/London"}, attrs))
    e
  end

  defp task(by, attrs) do
    {:ok, t} = Tasks.create(by, Map.merge(%{"emoji" => "⭐"}, attrs))
    t
  end

  defp switch_on(name, endpoint) do
    password = if name == "Alex", do: "a good password", else: "#{name} password"
    conn = sign_in(build_conn() |> put_req_header("x-family", "1"), "#{String.downcase(name)}@example.com", password)
    browser = FakePush.browser()
    conn |> post("/api/push/subscriptions", %{"subscription" => FakePush.subscription(browser, endpoint)}) |> json_response(200)
    {conn, browser}
  end

  defp at(time), do: NaiveDateTime.new!(@day, Time.from_iso8601!(time <> ":00"))

  test "what's on, what to remember, homework and jobs, for the household", ctx do
    %{admin: admin, jo: jo, mia: mia, ruby: ruby, sam: sam, ollie: ollie} = ctx

    event(jo, %{"title" => "Swimming", "emoji" => "🏊", "starts_at" => "2026-10-16T16:00:00+01:00", "ends_at" => "2026-10-16T17:00:00+01:00", "repeat" => "weekly", "who" => [mia.id]})
    event(jo, %{"title" => "Dentist", "emoji" => "🦷", "starts_at" => "2026-10-23T10:30:00+01:00", "ends_at" => "2026-10-23T11:00:00+01:00", "who" => [ruby.id]})
    event(jo, %{"title" => "Half term", "emoji" => "🍂", "all_day" => true, "start_date" => "2026-10-22", "end_date" => "2026-10-30"})
    event(jo, %{"title" => "Gran's birthday", "emoji" => "🎂", "all_day" => true, "start_date" => "2020-10-23", "repeat" => "yearly"})
    # Not today: last week's one-off, a weekly thing on Thursdays, a repeat that's ended.
    event(jo, %{"title" => "Parents' evening", "starts_at" => "2026-10-16T18:00:00+01:00"})
    event(jo, %{"title" => "Brownies", "starts_at" => "2026-10-15T18:00:00+01:00", "repeat" => "weekly"})
    event(jo, %{"title" => "Piano", "starts_at" => "2026-09-04T15:00:00+01:00", "repeat" => "weekly", "repeat_until" => "2026-10-16"})

    task(jo, %{"kind" => "reminder", "title" => "PE kit", "emoji" => "🎒", "user_ids" => [mia.id, ruby.id], "days" => [5]})
    task(jo, %{"kind" => "reminder", "title" => "Recorder", "emoji" => "🎵", "user_ids" => [mia.id], "on_date" => "2026-10-22"})
    task(jo, %{"kind" => "homework", "title" => "Spellings", "emoji" => "✏️", "user_ids" => [ruby.id], "on_date" => "2026-10-19", "due_on" => "2026-10-23"})
    task(jo, %{"kind" => "job", "title" => "Feed the cat", "user_ids" => [mia.id, ruby.id], "days" => [1, 2, 3, 4, 5, 6, 7]})
    :ok = Tasks.tick(mia, task(jo, %{"kind" => "job", "title" => "Make bed", "user_ids" => [mia.id], "days" => [5]}).id, mia.id, @day, true)
    # Another household's things stay theirs, even for an admin.
    task(sam, %{"kind" => "reminder", "title" => "Football boots", "user_ids" => [ollie.id], "days" => [5]})

    summary = DaySummary.summary(jo, @day)
    assert summary.title == "Today, Friday 23 October"

    assert summary.lines == [
             "🍂 Half term · 🎂 Gran's birthday · 🦷 Dentist 10:30 · 🏊 Swimming 16:00",
             "Remember: 🎒 PE kit (Mia, Ruby)",
             "Homework due: ✏️ Spellings (Ruby)",
             "✅ 2 jobs to tick off"
           ]

    assert DaySummary.summary(admin, @day).lines == summary.lines

    # A kid hears about their own day: their events and the family's, not their sister's dentist.
    assert DaySummary.summary(mia, @day).lines == ["🍂 Half term · 🎂 Gran's birthday · 🏊 Swimming 16:00", "✅ 1 job to tick off"]

    # The Smiths don't see the family calendar, but do see their own reminders.
    assert DaySummary.summary(sam, @day).lines == ["Remember: ⭐ Football boots (Ollie)"]

    # Nothing on, nothing sent.
    assert DaySummary.summary(sam, Date.add(@day, 1)) == nil
  end

  test "a busy day is cut short rather than running on", %{jo: jo} do
    for n <- 1..12, do: event(jo, %{"title" => "Thing number #{n}", "starts_at" => "2026-10-23T#{String.pad_leading("#{n + 8}", 2, "0")}:00:00+01:00"})
    [line] = DaySummary.summary(jo, @day).lines
    assert line =~ ~r/^📅 Thing number 1 09:00 · .* and \d+ more$/
    assert String.length(line) < 170
  end

  test "sent once, at each person's time, after quiet hours, and not hours late", ctx do
    %{base: base, admin: admin, jo: jo, mia: mia} = ctx
    task(jo, %{"kind" => "reminder", "title" => "PE kit", "user_ids" => [mia.id], "days" => [5]})
    task(mia, %{"kind" => "job", "title" => "Read", "user_ids" => [mia.id], "days" => [5]})

    {jo_conn, jo_phone} = switch_on("Jo", base <> "/jo")
    {mia_conn, mia_tablet} = switch_on("Mia", base <> "/mia")
    switch_on("Alex", base <> "/alex")

    # Grown-ups get it at seven; kids only if they choose a time.
    assert %{"me" => %{"morning" => "07:00"}} = jo_conn |> get("/api/me") |> json_response(200)
    assert %{"me" => %{"morning" => nil}} = mia_conn |> get("/api/me") |> json_response(200)

    assert DaySummary.send_due(:morning, at("06:59")) == []
    assert DaySummary.send_due(:morning, at("07:00")) |> Enum.sort() == Enum.sort([jo.id, admin.id])
    assert_receive {:push, "/jo", headers, body}
    assert %{"topic" => "morning"} = headers
    assert %{"kind" => "morning", "title" => "Today, Friday 23 October", "body" => "Remember: ⭐ PE kit (Mia)\n✅ 1 job to tick off", "url" => "/#/calendar"} =
             FakePush.decrypt(body, jo_phone)

    assert_receive {:push, "/alex", _, _}
    refute_receive {:push, "/mia", _, _}, 50
    # Once a day.
    assert DaySummary.send_due(:morning, at("07:05")) == []

    # Mia chooses half past seven; quiet hours until eight hold it back.
    assert %{"me" => %{"morning" => "07:30"}} = mia_conn |> patch("/api/me", %{"morning" => "07:30"}) |> json_response(200)
    assert %{"fields" => %{"morning" => _}} = mia_conn |> patch("/api/me", %{"morning" => "7.30am"}) |> json_response(422)
    {:ok, _} = Family.Accounts.set_permissions(admin, Repo.get!(User, mia.id), %{}, %{"from" => "19:00", "to" => "08:00"})
    assert DaySummary.send_due(:morning, at("07:30")) == []
    assert DaySummary.send_due(:morning, at("08:00")) == [mia.id]
    assert_receive {:push, "/mia", _, body}
    assert %{"body" => "✅ 1 job to tick off"} = FakePush.decrypt(body, mia_tablet)

    # Switched off, it stops; and a server that was off all morning doesn't send it at lunchtime.
    jo_conn |> patch("/api/me", %{"morning" => "off"}) |> json_response(200)
    tomorrow = fn time -> NaiveDateTime.add(at(time), 86_400) end
    assert DaySummary.send_due(:morning, tomorrow.("12:00")) == []
    refute_receive {:push, _, _, _}, 50
    assert %{morning_sent_on: ~D[2026-10-24]} = Repo.get!(User, admin.id)
    assert %{morning_sent_on: ~D[2026-10-23]} = Repo.get!(User, jo.id)
  end

  test "the evening before: tomorrow's things to remember, without the jobs", %{base: base, jo: jo, mia: mia} do
    task(jo, %{"kind" => "reminder", "title" => "PE kit", "emoji" => "🎒", "user_ids" => [mia.id], "days" => [5]})
    task(jo, %{"kind" => "job", "title" => "Feed the cat", "user_ids" => [mia.id], "days" => [5]})
    {jo_conn, jo_phone} = switch_on("Jo", base <> "/jo")
    {mia_conn, _} = switch_on("Mia", base <> "/mia")
    assert %{"me" => %{"evening" => "20:00"}} = jo_conn |> get("/api/me") |> json_response(200)
    assert %{"me" => %{"evening" => nil}} = mia_conn |> get("/api/me") |> json_response(200)

    thursday = fn time -> NaiveDateTime.add(at(time), -86_400) end
    assert DaySummary.send_due(:evening, thursday.("19:59")) == []
    assert DaySummary.send_due(:evening, thursday.("20:00")) == [jo.id]
    assert_receive {:push, "/jo", %{"topic" => "evening"}, body}
    assert %{"kind" => "evening", "title" => "Tomorrow, Friday 23 October", "body" => "Remember: 🎒 PE kit (Mia)", "url" => "/#/calendar"} =
             FakePush.decrypt(body, jo_phone)

    # The morning one comes as well, with the jobs.
    assert DaySummary.send_due(:morning, at("07:00")) == [jo.id]
    assert_receive {:push, "/jo", _, body}
    assert %{"body" => "Remember: 🎒 PE kit (Mia)\n✅ 1 job to tick off"} = FakePush.decrypt(body, jo_phone)

    # Each switches off on its own.
    assert %{"me" => %{"evening" => nil, "morning" => "07:00"}} = jo_conn |> patch("/api/me", %{"evening" => "off"}) |> json_response(200)
    assert DaySummary.send_due(:evening, at("20:00")) == []
  end
end
