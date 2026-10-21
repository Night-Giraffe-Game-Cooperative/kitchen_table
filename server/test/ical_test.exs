defmodule Family.ICalTest do
  use ExUnit.Case, async: true
  alias Family.Calendar.{Event, ICal, RRule}

  @london "Europe/London"

  defp cal(events), do: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" <> events <> "END:VCALENDAR\r\n"

  defp occ(text, from, to), do: ICal.occurrences(cal(text), from, to, @london)

  test "one-off events, timed and all day, with escapes and folded lines" do
    [timed, whole] =
      occ(
        """
        BEGIN:VEVENT
        UID:a@example.com
        DTSTART:20261021T080000Z
        DTEND:20261021T093000Z
        SUMMARY:Dentist\\, then school
        DESCRIPTION:Bring the card\\nand a coat
        LOCATION;LANGUAGE=en:High St
         reet
        END:VEVENT
        BEGIN:VEVENT
        UID:b@example.com
        DTSTART;VALUE=DATE:20261024
        DTEND;VALUE=DATE:20261027
        SUMMARY:Half term
        END:VEVENT
        """,
        ~D[2026-10-01],
        ~D[2026-10-31]
      )

    assert timed.title == "Dentist, then school"
    assert timed.notes == "Bring the card\nand a coat"
    assert timed.location == "High Street"
    assert timed.starts_at == ~U[2026-10-21 08:00:00Z]
    assert timed.ends_at == ~U[2026-10-21 09:30:00Z]
    assert {timed.key, timed.recurring, timed.all_day} == {"", false, false}

    # The end day in iCalendar is the day after; ours is the last day.
    assert {whole.all_day, whole.start_date, whole.end_date} == {true, ~D[2026-10-24], ~D[2026-10-26]}
    assert occ("BEGIN:VEVENT\nUID:c\nDTSTART:20261121T080000Z\nEND:VEVENT\n", ~D[2026-10-01], ~D[2026-10-31]) == []
  end

  test "a weekly swim at 9 stays at 9 when the clocks change" do
    swims =
      occ(
        """
        BEGIN:VEVENT
        UID:swim
        DTSTART;TZID=Europe/London:20261007T090000
        DTEND;TZID=Europe/London:20261007T100000
        RRULE:FREQ=WEEKLY;BYDAY=WE
        SUMMARY:Swim
        END:VEVENT
        """,
        ~D[2026-10-01],
        ~D[2026-11-05]
      )

    assert Enum.map(swims, & &1.starts_at) == [
             ~U[2026-10-07 08:00:00Z],
             ~U[2026-10-14 08:00:00Z],
             ~U[2026-10-21 08:00:00Z],
             ~U[2026-10-28 09:00:00Z],
             ~U[2026-11-04 09:00:00Z]
           ]

    assert Enum.all?(swims, &(&1.recurring and DateTime.diff(&1.ends_at, &1.starts_at) == 3600))
    assert hd(swims).key == "20261007T080000Z"
  end

  test "Windows zone names and vendor prefixes" do
    assert ICal.zone("GMT Standard Time", "Etc/UTC") == @london
    assert ICal.zone("/mozilla.org/20050126_1/Europe/Paris", @london) == "Europe/Paris"
    assert ICal.zone("(UTC+00:00) Dublin, Edinburgh, Lisbon, London", "Etc/UTC") == @london
    assert ICal.zone("Somewhere odd", @london) == @london

    [e] =
      occ(
        "BEGIN:VEVENT\nUID:w\nDTSTART;TZID=\"W. Europe Standard Time\":20260701T100000\nDURATION:PT45M\nSUMMARY:Call\nEND:VEVENT\n",
        ~D[2026-07-01],
        ~D[2026-07-01]
      )

    assert {e.starts_at, e.ends_at} == {~U[2026-07-01 08:00:00Z], ~U[2026-07-01 08:45:00Z]}
  end

  test "left-out days, a moved day and a cancelled day" do
    clubs =
      occ(
        """
        BEGIN:VEVENT
        UID:club
        DTSTART;TZID=Europe/London:20260907T153000
        DTEND;TZID=Europe/London:20260907T163000
        RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6
        EXDATE;TZID=Europe/London:20260914T153000
        SUMMARY:Art club
        END:VEVENT
        BEGIN:VEVENT
        UID:club
        RECURRENCE-ID;TZID=Europe/London:20260921T153000
        DTSTART;TZID=Europe/London:20260922T160000
        DTEND;TZID=Europe/London:20260922T170000
        SUMMARY:Art club (Tuesday this week)
        END:VEVENT
        BEGIN:VEVENT
        UID:club
        RECURRENCE-ID:20260928T143000Z
        DTSTART:20260928T143000Z
        STATUS:CANCELLED
        SUMMARY:Art club
        END:VEVENT
        """,
        ~D[2026-09-01],
        ~D[2026-12-31]
      )

    assert Enum.map(clubs, &{DateTime.to_date(&1.starts_at), &1.title}) == [
             {~D[2026-09-07], "Art club"},
             {~D[2026-09-22], "Art club (Tuesday this week)"},
             {~D[2026-10-05], "Art club"},
             {~D[2026-10-12], "Art club"}
           ]

    moved = Enum.at(clubs, 1)
    assert moved.key == "20260921T143000Z"
    assert moved.starts_at == ~U[2026-09-22 15:00:00Z]
  end

  test "repeat rules: last Friday, last weekday, every other day, yearly birthdays" do
    days = fn rule, first, last -> RRule.days(RRule.parse(rule), first, last) end

    assert days.("FREQ=MONTHLY;BYDAY=-1FR;COUNT=3", ~D[2026-10-30], ~D[2027-12-31]) ==
             [~D[2026-10-30], ~D[2026-11-27], ~D[2026-12-25]]

    assert days.("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", ~D[2026-10-30], ~D[2027-01-31]) ==
             [~D[2026-10-30], ~D[2026-11-30], ~D[2026-12-31], ~D[2027-01-29]]

    assert days.("FREQ=DAILY;INTERVAL=2", ~D[2026-10-01], ~D[2026-10-08]) ==
             [~D[2026-10-01], ~D[2026-10-03], ~D[2026-10-05], ~D[2026-10-07]]

    assert days.("FREQ=MONTHLY;BYMONTHDAY=31", ~D[2026-08-31], ~D[2026-12-31]) ==
             [~D[2026-08-31], ~D[2026-10-31], ~D[2026-12-31]]

    assert days.("FREQ=YEARLY", ~D[2016-02-29], ~D[2025-01-01]) == [~D[2016-02-29], ~D[2020-02-29], ~D[2024-02-29]]
    assert days.("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH", ~D[2026-10-06], ~D[2026-10-23]) ==
             [~D[2026-10-06], ~D[2026-10-08], ~D[2026-10-20], ~D[2026-10-22]]

    # Which day weeks start on changes every other week (RFC 5545's own example).
    assert days.("FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO", ~D[1997-08-05], ~D[1997-12-31]) ==
             [~D[1997-08-05], ~D[1997-08-10], ~D[1997-08-19], ~D[1997-08-24]]

    assert days.("FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU", ~D[1997-08-05], ~D[1997-12-31]) ==
             [~D[1997-08-05], ~D[1997-08-17], ~D[1997-08-19], ~D[1997-08-31]]

    assert RRule.parse("FREQ=SECONDLY") == nil

    # Something that has repeated every day for decades is only walked
    # from near the days asked for.
    [birthday | _] =
      occ(
        "BEGIN:VEVENT\nUID:b\nDTSTART;VALUE=DATE:19800312\nRRULE:FREQ=YEARLY\nSUMMARY:Lucy's birthday\nEND:VEVENT\n",
        ~D[2027-01-01],
        ~D[2027-12-31]
      )

    assert {birthday.start_date, birthday.key} == {~D[2027-03-12], "20270312"}

    daily = occ("BEGIN:VEVENT\nUID:d\nDTSTART:19700101T070000Z\nRRULE:FREQ=DAILY\nSUMMARY:Walk\nEND:VEVENT\n", ~D[2026-10-20], ~D[2026-10-21])
    assert Enum.map(daily, &DateTime.to_date(&1.starts_at)) |> Enum.uniq() |> Enum.member?(~D[2026-10-21])
  end

  test "an end to the repeats" do
    timed =
      occ(
        "BEGIN:VEVENT\nUID:u\nDTSTART;TZID=Europe/London:20261019T090000\nRRULE:FREQ=DAILY;UNTIL=20261021T080000Z\nSUMMARY:Camp\nEND:VEVENT\n",
        ~D[2026-10-01],
        ~D[2026-10-31]
      )

    assert length(timed) == 3

    whole =
      occ(
        "BEGIN:VEVENT\nUID:v\nDTSTART;VALUE=DATE:20261019\nRRULE:FREQ=DAILY;UNTIL=20261020T235959Z\nSUMMARY:Camp\nEND:VEVENT\n",
        ~D[2026-10-01],
        ~D[2026-10-31]
      )

    assert Enum.map(whole, & &1.start_date) == [~D[2026-10-19], ~D[2026-10-20]]
  end

  test "events made here are written so other calendars read them back the same" do
    event = %Event{
      title: "Swim; then tea, at Nan's",
      notes: "Towels\nGoggles",
      location: "Leisure centre",
      emoji: "🏊",
      who: [3, 4],
      all_day: false,
      starts_at: ~U[2026-10-21 08:00:00Z],
      ends_at: ~U[2026-10-21 09:00:00Z],
      time_zone: @london,
      repeat: "weekly",
      repeat_until: ~D[2026-11-04]
    }

    text = ICal.build(event, "kt-1@kitchentable", ~U[2026-10-21 12:00:00Z])
    assert text =~ "DTSTART;TZID=Europe/London:20261021T090000\r\n"
    assert text =~ "RRULE:FREQ=WEEKLY;UNTIL=20261104T235959Z\r\n"
    assert text =~ "BEGIN:VTIMEZONE\r\nTZID:Europe/London\r\n"
    assert text =~ "BEGIN:DAYLIGHT\r\nTZOFFSETFROM:+0000\r\nTZOFFSETTO:+0100\r\nTZNAME:BST\r\nDTSTART:20260329T010000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\n"
    assert text =~ "BEGIN:STANDARD\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0000\r\nTZNAME:GMT\r\nDTSTART:20261025T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\n"
    assert text |> String.split("\r\n") |> Enum.all?(&(byte_size(&1) <= 75))

    back = ICal.occurrences(text, ~D[2026-10-01], ~D[2026-12-31], "Etc/UTC")
    assert Enum.map(back, & &1.starts_at) == [~U[2026-10-21 08:00:00Z], ~U[2026-10-28 09:00:00Z], ~U[2026-11-04 09:00:00Z]]
    first = hd(back)
    assert {first.title, first.notes, first.location, first.emoji, first.who} == {event.title, event.notes, event.location, "🏊", [3, 4]}

    day = %Event{event | all_day: true, start_date: ~D[2026-12-24], end_date: ~D[2026-12-26], repeat: "none", repeat_until: nil}
    text = ICal.build(day, "kt-2@kitchentable")
    assert text =~ "DTSTART;VALUE=DATE:20261224\r\nDTEND;VALUE=DATE:20261227\r\n"
    refute text =~ "VTIMEZONE"
    [back] = ICal.occurrences(text, ~D[2026-12-01], ~D[2026-12-31], @london)
    assert {back.start_date, back.end_date} == {~D[2026-12-24], ~D[2026-12-26]}

    long = %Event{day | title: String.duplicate("🎄 Christmas ", 12)}
    assert ICal.build(long, "kt-3") |> String.split("\r\n") |> Enum.all?(&(byte_size(&1) <= 75))
    [back] = ICal.occurrences(ICal.build(long, "kt-3"), ~D[2026-12-01], ~D[2026-12-31], @london)
    assert back.title == String.trim(long.title)
  end

  test "changing an event keeps what other calendars put in it" do
    original =
      cal("""
      BEGIN:VEVENT\r
      UID:abc\r
      DTSTAMP:20261001T000000Z\r
      SEQUENCE:2\r
      DTSTART;TZID=Europe/London:20261021T090000\r
      DURATION:PT1H\r
      SUMMARY:Old name\r
      ATTENDEE;CN="Lucy";PARTSTAT=ACCEPTED:mailto:lucy@example.com\r
      BEGIN:VALARM\r
      ACTION:DISPLAY\r
      TRIGGER:-PT15M\r
      END:VALARM\r
      END:VEVENT\r
      """)

    event = %Event{title: "New name", all_day: false, starts_at: ~U[2026-10-22 09:00:00Z], ends_at: ~U[2026-10-22 10:30:00Z], emoji: "📅", who: []}
    assert {:ok, text} = ICal.patch(original, event, ~U[2026-10-21 12:00:00Z])
    assert text =~ "SEQUENCE:3\r\n"
    assert text =~ "ATTENDEE;CN=Lucy;PARTSTAT=ACCEPTED:mailto:lucy@example.com\r\n"
    assert text =~ "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\n"
    refute text =~ "DURATION"
    refute text =~ "Old name"

    [back] = ICal.occurrences(text, ~D[2026-10-01], ~D[2026-10-31], @london)
    assert {back.title, back.starts_at, back.ends_at} == {"New name", ~U[2026-10-22 09:00:00Z], ~U[2026-10-22 10:30:00Z]}

    repeating = String.replace(original, "SUMMARY:Old name", "RRULE:FREQ=DAILY\r\nSUMMARY:Old name")
    assert ICal.patch(repeating, event) == {:error, :repeats}
  end
end
