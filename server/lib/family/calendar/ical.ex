defmodule Family.Calendar.ICal do
  @moduledoc """
  Reads and writes iCalendar (.ics), the format CalDAV servers and calendar
  feeds speak (RFC 5545).

  Reading turns a calendar into the occurrences that fall in a window of
  days, repeats worked out, each with the times in UTC, so a linked
  calendar's events sit in the database like the app's own one-off events.
  Writing makes a whole calendar object for a new event, or changes an
  existing one in place, keeping whatever else its owner's calendar put in
  it (alarms, guests, colours).
  """

  alias Family.Calendar.RRule

  @max_occurrences 2000

  ## Parsing

  @doc """
  The components in iCalendar text, as `%{name, props, components}`, where
  each property is `{name, params, raw_value}`.
  """
  def parse(text) when is_binary(text) do
    text
    |> String.trim_leading("﻿")
    # Long lines are folded onto the next, starting with a space or tab.
    |> String.replace(~r/\r?\n[ \t]/, "")
    |> String.split(~r/\r?\n|\r/, trim: true)
    |> Enum.reduce([%{name: "ROOT", props: [], components: []}], &line/2)
    |> close_all()
    |> Map.fetch!(:components)
  end

  defp line(text, stack) do
    case content_line(text) do
      {"BEGIN", _, name} ->
        [%{name: String.upcase(String.trim(name)), props: [], components: []} | stack]

      {"END", _, _} when length(stack) > 1 ->
        close(stack)

      {"END", _, _} ->
        stack

      {name, params, value} ->
        [top | rest] = stack
        [%{top | props: [{name, params, value} | top.props]} | rest]

      nil ->
        stack
    end
  end

  defp close([done, parent | rest]) do
    done = %{done | props: Enum.reverse(done.props), components: Enum.reverse(done.components)}
    [%{parent | components: [done | parent.components]} | rest]
  end

  defp close_all([root]), do: %{root | props: Enum.reverse(root.props), components: Enum.reverse(root.components)}
  defp close_all(stack), do: stack |> close() |> close_all()

  # NAME;PARAM=a;PARAM="b:c":value
  defp content_line(text) do
    with {head, value} <- split_at(text, ?:),
         [name | params] <- split_all(head, ?;),
         name = String.upcase(String.trim(name)),
         true <- name != "" do
      params =
        Enum.flat_map(params, fn p ->
          case String.split(p, "=", parts: 2) do
            [k, v] -> [{String.upcase(String.trim(k)), unquote_param(v)}]
            _ -> []
          end
        end)

      {name, params, value}
    else
      _ -> nil
    end
  end

  # Splits at the first separator outside double quotes.
  defp split_at(text, sep), do: split_at(text, sep, 0, false)

  defp split_at(text, sep, i, quoted) when i < byte_size(text) do
    case :binary.at(text, i) do
      ?" -> split_at(text, sep, i + 1, not quoted)
      ^sep when not quoted -> {binary_part(text, 0, i), binary_part(text, i + 1, byte_size(text) - i - 1)}
      _ -> split_at(text, sep, i + 1, quoted)
    end
  end

  defp split_at(_, _, _, _), do: nil

  defp split_all(text, sep) do
    case split_at(text, sep) do
      {first, rest} -> [first | split_all(rest, sep)]
      nil -> [text]
    end
  end

  defp unquote_param(v) do
    v = String.trim(v)
    if String.starts_with?(v, "\"") and String.ends_with?(v, "\"") and byte_size(v) >= 2, do: binary_part(v, 1, byte_size(v) - 2), else: v
  end

  ## Looking things up

  def prop(%{props: props}, name), do: Enum.find(props, &(elem(&1, 0) == name))
  def props(%{props: props}, name), do: Enum.filter(props, &(elem(&1, 0) == name))

  def value(component, name) do
    case prop(component, name) do
      {_, _, v} -> v
      nil -> nil
    end
  end

  def param({_, params, _}, name) do
    case List.keyfind(params, name, 0) do
      {_, v} -> v
      nil -> nil
    end
  end

  @doc "Every VEVENT, whether or not it's wrapped in a VCALENDAR."
  def vevents(components) do
    Enum.flat_map(components, fn
      %{name: "VEVENT"} = e -> [e]
      %{name: "VCALENDAR", components: inner} -> vevents(inner)
      _ -> []
    end)
  end

  @doc "Text with iCalendar's escapes undone."
  def text(nil), do: nil

  def text(value) do
    Regex.replace(~r/\\([\\;,nN])/, value, fn
      _, "n" -> "\n"
      _, "N" -> "\n"
      _, c -> c
    end)
  end

  @doc "Text escaped for iCalendar."
  def escape(nil), do: ""

  def escape(text) do
    text
    |> String.replace("\\", "\\\\")
    |> String.replace(";", "\\;")
    |> String.replace(",", "\\,")
    |> String.replace(~r/\r?\n/, "\\n")
  end

  ## Times

  @doc """
  A DTSTART-like property as `{:date, date}` or `{:time, local, zone}`,
  where `local` is the wall-clock time in `zone`. UTC times have the zone
  "Etc/UTC"; floating times take `default_zone`. Nil if it can't be read.
  """
  def moment(nil, _), do: nil

  def moment({_, params, value} = prop, default_zone) do
    moment_value(String.trim(value), param(prop, "VALUE"), zone_of(params, default_zone))
  end

  defp zone_of(params, default_zone) do
    case List.keyfind(params, "TZID", 0) do
      {_, tzid} -> zone(tzid, default_zone)
      nil -> default_zone
    end
  end

  defp moment_value(value, kind, zone) do
    case Regex.run(~r/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/, value) do
      [_, y, m, d] ->
        with {:ok, date} <- Date.new(int(y), int(m), int(d)), do: {:date, date}, else: (_ -> nil)

      [_, y, m, d | time] when kind != "DATE" ->
        [hh, mm | more] = time
        ss = Enum.at(more, 0, "")
        utc? = Enum.at(more, 1) == "Z"

        with {:ok, local} <- NaiveDateTime.new(int(y), int(m), int(d), int(hh), int(mm), if(ss == "", do: 0, else: int(ss))) do
          {:time, local, if(utc?, do: "Etc/UTC", else: zone)}
        else
          _ -> nil
        end

      [_, y, m, d | _] ->
        with {:ok, date} <- Date.new(int(y), int(m), int(d)), do: {:date, date}, else: (_ -> nil)

      _ ->
        nil
    end
  end

  defp int(s), do: String.to_integer(s)

  @doc "A wall-clock time in a zone, in UTC. Skipped hours move on; repeated hours take the first."
  def to_utc(%NaiveDateTime{} = local, zone) do
    case DateTime.from_naive(local, zone) do
      {:ok, dt} -> dt
      {:gap, _just_before, just_after} -> just_after
      {:ambiguous, first, _second} -> first
      {:error, _} -> DateTime.from_naive!(local, "Etc/UTC")
    end
    |> DateTime.shift_zone!("Etc/UTC")
    |> DateTime.truncate(:second)
  end

  # Outlook and Exchange send Windows' names for zones.
  @windows %{
    "GMT Standard Time" => "Europe/London",
    "Greenwich Standard Time" => "Atlantic/Reykjavik",
    "W. Europe Standard Time" => "Europe/Berlin",
    "Romance Standard Time" => "Europe/Paris",
    "Central Europe Standard Time" => "Europe/Budapest",
    "Central European Standard Time" => "Europe/Warsaw",
    "E. Europe Standard Time" => "Europe/Chisinau",
    "FLE Standard Time" => "Europe/Kiev",
    "GTB Standard Time" => "Europe/Bucharest",
    "Irish Standard Time" => "Europe/Dublin",
    "Eastern Standard Time" => "America/New_York",
    "Central Standard Time" => "America/Chicago",
    "Mountain Standard Time" => "America/Denver",
    "Pacific Standard Time" => "America/Los_Angeles",
    "AUS Eastern Standard Time" => "Australia/Sydney",
    "New Zealand Standard Time" => "Pacific/Auckland",
    "India Standard Time" => "Asia/Kolkata",
    "China Standard Time" => "Asia/Shanghai",
    "Tokyo Standard Time" => "Asia/Tokyo",
    "Singapore Standard Time" => "Asia/Singapore",
    "Arabian Standard Time" => "Asia/Dubai",
    "South Africa Standard Time" => "Africa/Johannesburg",
    "UTC" => "Etc/UTC",
    "GMT" => "Etc/UTC",
    "Z" => "Etc/UTC"
  }

  @doc "An IANA zone for a TZID, which may be a Windows name or have a vendor prefix."
  def zone(tzid, default_zone) do
    tzid = String.trim(tzid)
    tail = Regex.run(~r{([A-Za-z_]+/[A-Za-z0-9_+\-]+(?:/[A-Za-z0-9_+\-]+)?)$}, tzid)

    cond do
      Map.has_key?(@windows, tzid) -> @windows[tzid]
      known?(tzid) -> tzid
      tail && known?(List.last(tail)) -> List.last(tail)
      # "(UTC+00:00) Dublin, Edinburgh, Lisbon, London"
      String.contains?(tzid, "London") -> "Europe/London"
      true -> default_zone
    end
  end

  defp known?(zone), do: match?({:ok, _}, DateTime.now(zone))

  # PT1H30M, P1D, P2W, -PT15M
  defp duration(nil), do: nil

  defp duration(text) do
    case Regex.run(~r/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/, String.trim(text)) do
      [_ | parts] ->
        [sign | rest] = parts ++ List.duplicate("", 6 - length(parts))
        [w, d, h, m, s] = Enum.map(rest, &if(&1 == "", do: 0, else: String.to_integer(&1)))
        total = w * 604_800 + d * 86_400 + h * 3600 + m * 60 + s
        if sign == "-", do: -total, else: total

      _ ->
        nil
    end
  end

  ## Occurrences

  @doc """
  The occurrences of every event in iCalendar text that touch the days
  `from` to `to` (both included), soonest first. Each is a map of the
  fields of an Event row, plus `uid`, `key` (which occurrence of a
  repeating event; "" for one that doesn't repeat) and `recurring`.
  """
  def occurrences(text, %Date{} = from, %Date{} = to, default_zone) when is_binary(text) do
    events = text |> parse() |> vevents()
    {masters, overrides} = Enum.split_with(events, &is_nil(prop(&1, "RECURRENCE-ID")))
    overrides_by_uid = Enum.group_by(overrides, &uid/1)
    master_uids = MapSet.new(masters, &uid/1)

    from_masters =
      Enum.flat_map(masters, fn master ->
        expand(master, Map.get(overrides_by_uid, uid(master), []), from, to, default_zone)
      end)

    # A changed occurrence sent on its own, without the event it belongs to.
    orphans =
      overrides
      |> Enum.reject(&MapSet.member?(master_uids, uid(&1)))
      |> Enum.flat_map(fn o ->
        with false <- cancelled?(o),
             {:ok, key} <- recurrence_key(o, default_zone),
             %{} = occ <- single(o, default_zone) do
          [%{occ | key: key, recurring: true}]
        else
          _ -> []
        end
      end)
      |> Enum.filter(&touches?(&1, from, to))

    (from_masters ++ orphans)
    |> Enum.sort_by(&sort_key/1)
  end

  defp uid(event), do: (value(event, "UID") || "") |> String.trim()

  defp cancelled?(event), do: String.upcase(String.trim(value(event, "STATUS") || "")) == "CANCELLED"

  defp sort_key(%{all_day: true, start_date: d}), do: {Date.to_gregorian_days(d) * 86_400, 0}
  defp sort_key(%{starts_at: t}), do: {DateTime.to_unix(t) + 62_167_219_200, 1}

  defp expand(master, overrides, from, to, zone) do
    rule = RRule.parse(value(master, "RRULE"))
    rdates = dates(master, "RDATE", zone)

    cond do
      cancelled?(master) ->
        []

      is_nil(single(master, zone)) ->
        []

      is_nil(rule) and rdates == [] ->
        occ = single(master, zone)
        if touches?(occ, from, to), do: [occ], else: []

      true ->
        repeat(master, rule, rdates, overrides, from, to, zone)
    end
  end

  # The event as written: one occurrence, its first.
  defp single(event, default_zone) do
    start = moment(prop(event, "DTSTART"), default_zone)
    finish = moment(prop(event, "DTEND"), default_zone)
    length = duration(value(event, "DURATION"))

    base = %{
      uid: uid(event),
      key: "",
      recurring: false,
      title: (text(value(event, "SUMMARY")) || "") |> String.trim() |> fallback("(No title)") |> String.slice(0, 255),
      notes: text(value(event, "DESCRIPTION")) |> blank() |> slice(4000),
      location: text(value(event, "LOCATION")) |> blank() |> slice(255),
      emoji: text(value(event, "X-KT-EMOJI")) |> blank() |> slice(16) || "📅",
      who: who(text(value(event, "X-KT-WHO"))),
      repeat: "none",
      repeat_until: nil
    }

    case start do
      {:date, first} ->
        last =
          case {finish, length} do
            {{:date, d}, _} -> Date.add(d, -1)
            {{:time, t, _}, _} -> Date.add(NaiveDateTime.to_date(t), -1)
            {nil, secs} when is_integer(secs) and secs > 0 -> Date.add(first, div(secs + 86_399, 86_400) - 1)
            _ -> first
          end

        last = if Date.compare(last, first) == :lt, do: first, else: last
        Map.merge(base, %{all_day: true, start_date: first, end_date: last, starts_at: nil, ends_at: nil, time_zone: default_zone})

      {:time, local, z} ->
        starts = to_utc(local, z)

        ends =
          case {finish, length} do
            {{:time, t, z2}, _} -> to_utc(t, z2)
            {{:date, d}, _} -> to_utc(NaiveDateTime.new!(d, ~T[00:00:00]), z)
            {nil, secs} when is_integer(secs) -> DateTime.add(starts, secs)
            _ -> starts
          end

        ends = if DateTime.compare(ends, starts) == :lt, do: starts, else: ends
        Map.merge(base, %{all_day: false, starts_at: starts, ends_at: ends, start_date: nil, end_date: nil, time_zone: z})

      nil ->
        nil
    end
  end

  defp repeat(master, rule, rdates, overrides, from, to, zone) do
    first = single(master, zone)
    {first_day, at, event_zone} = master |> prop("DTSTART") |> moment(zone) |> start_parts()
    span = span(first)

    # Days whose occurrences could reach into the window.
    window_from = Date.add(from, -(span.days + 1))
    window_to = Date.add(to, 1)
    until = rule && until_of(rule.until, event_zone)

    last_day =
      case until do
        {:date, d} -> min_date(d, window_to)
        {:time, utc} -> min_date(utc |> DateTime.shift_zone!(event_zone || "Etc/UTC") |> DateTime.to_date(), window_to)
        nil -> window_to
      end

    rule_days = if rule, do: RRule.days(rule, first_day, last_day, window_from), else: [first_day]
    extra_days = Enum.map(rdates, &elem(&1, 0))

    starts =
      (rule_days ++ extra_days)
      |> Enum.uniq()
      |> Enum.sort(Date)
      |> Enum.take(@max_occurrences)
      |> Enum.map(&occurrence_start(&1, at, event_zone))
      |> Enum.reject(fn s ->
        case {until, s} do
          {{:time, utc}, {:time, t}} -> DateTime.compare(t, utc) == :gt
          _ -> false
        end
      end)

    exdates = dates(master, "EXDATE", zone)
    excluded = MapSet.new(exdates, &elem(&1, 1))
    # A timed event can be left out on a whole day.
    excluded_days = for {day, _, :date} <- exdates, into: MapSet.new(), do: day

    by_key =
      for o <- overrides, {:ok, key} <- [recurrence_key(o, zone)], into: %{}, do: {key, o}

    changed = fn key, o ->
      case not cancelled?(o) && single(o, zone) do
        %{} = occ -> [%{occ | key: key, recurring: true}]
        _ -> []
      end
    end

    from_rule =
      Enum.flat_map(starts, fn s ->
        key = key_of(s)

        cond do
          Map.has_key?(by_key, key) -> changed.(key, by_key[key])
          MapSet.member?(excluded, key) -> []
          match?({:time, _}, s) and MapSet.member?(excluded_days, day_of(s, event_zone)) -> []
          true -> [s |> shift(first, span) |> Map.merge(%{key: key, recurring: true})]
        end
      end)

    # Occurrences moved into the window from a day outside it.
    known = MapSet.new(starts, &key_of/1)
    moved = Enum.flat_map(by_key, fn {key, o} -> if MapSet.member?(known, key), do: [], else: changed.(key, o) end)

    Enum.filter(from_rule ++ moved, &touches?(&1, from, to))
  end

  defp start_parts({:date, d}), do: {d, nil, nil}
  defp start_parts({:time, local, z}), do: {NaiveDateTime.to_date(local), NaiveDateTime.to_time(local), z}

  defp span(%{all_day: true, start_date: a, end_date: b}), do: %{days: Date.diff(b, a), secs: nil}
  defp span(%{starts_at: a, ends_at: b}), do: %{days: div(DateTime.diff(b, a), 86_400) + 1, secs: DateTime.diff(b, a)}

  defp occurrence_start(day, nil, _), do: {:date, day}
  defp occurrence_start(day, at, zone), do: {:time, to_utc(NaiveDateTime.new!(day, at), zone)}

  defp shift({:date, day}, occ, span), do: %{occ | start_date: day, end_date: Date.add(day, span.days)}
  defp shift({:time, t}, occ, span), do: %{occ | starts_at: t, ends_at: DateTime.add(t, span.secs)}

  defp key_of({:date, d}), do: Date.to_iso8601(d, :basic)
  defp key_of({:time, t}), do: Calendar.strftime(t, "%Y%m%dT%H%M%SZ")

  defp day_of({:date, d}, _), do: d
  defp day_of({:time, t}, zone), do: t |> DateTime.shift_zone!(zone) |> DateTime.to_date()

  # Every date in every EXDATE or RDATE, as {local day, key, kind}.
  defp dates(event, name, zone) do
    event
    |> props(name)
    |> Enum.flat_map(fn {n, params, value} ->
      value
      |> String.split(",", trim: true)
      |> Enum.flat_map(fn v ->
        case moment({n, params, v}, zone) do
          {:date, d} -> [{d, key_of({:date, d}), :date}]
          {:time, local, z} -> [{NaiveDateTime.to_date(local), key_of({:time, to_utc(local, z)}), :time}]
          nil -> []
        end
      end)
    end)
  end

  defp recurrence_key(event, zone) do
    case moment(prop(event, "RECURRENCE-ID"), zone) do
      {:date, d} -> {:ok, key_of({:date, d})}
      {:time, local, z} -> {:ok, key_of({:time, to_utc(local, z)})}
      nil -> :error
    end
  end

  defp until_of(nil, _), do: nil

  defp until_of(text, zone) do
    case moment_value(String.trim(text), nil, zone || "Etc/UTC") do
      {:date, d} -> {:date, d}
      {:time, local, z} -> {:time, to_utc(local, z)}
      nil -> nil
    end
  end

  defp min_date(a, b), do: if(Date.compare(a, b) == :gt, do: b, else: a)

  defp touches?(%{all_day: true, start_date: a, end_date: b}, from, to),
    do: Date.compare(a, to) != :gt and Date.compare(b, from) != :lt

  defp touches?(%{starts_at: a, ends_at: b}, from, to),
    do: Date.compare(DateTime.to_date(a), Date.add(to, 1)) != :gt and Date.compare(DateTime.to_date(b), Date.add(from, -1)) != :lt

  defp who(nil), do: []

  defp who(text) do
    text
    |> String.split(",", trim: true)
    |> Enum.flat_map(fn s ->
      case Integer.parse(String.trim(s)) do
        {n, ""} -> [n]
        _ -> []
      end
    end)
  end

  defp blank(nil), do: nil
  defp blank(s), do: if(String.trim(s) == "", do: nil, else: String.trim(s))

  defp slice(nil, _), do: nil
  defp slice(s, n), do: String.slice(s, 0, n)

  defp fallback("", other), do: other
  defp fallback(s, _), do: s

  ## Writing

  @doc """
  A whole calendar object for an event made in the app. A timed event that
  repeats is written in its own time zone, so it stays at the same time of
  day when the clocks change; anything else is written in UTC.
  """
  def build(event, uid, now \\ DateTime.utc_now()) do
    repeats? = event.repeat not in [nil, "none"]
    zone = event.time_zone || "Europe/London"
    zoned? = repeats? and not event.all_day and zone != "Etc/UTC"

    props =
      [{"UID", [], uid}, {"DTSTAMP", [], stamp(now)}, {"CREATED", [], stamp(now)}, {"LAST-MODIFIED", [], stamp(now)}] ++
        event_props(event, zoned?) ++
        if(repeats?, do: [{"RRULE", [], rrule(event, zone)}], else: [])

    vevent = %{name: "VEVENT", props: props, components: []}
    timezones = if zoned?, do: [vtimezone(zone, (event.starts_at || now).year)], else: []

    to_text([
      %{
        name: "VCALENDAR",
        props: [{"VERSION", [], "2.0"}, {"PRODID", [], "-//Kitchen Table//Family calendar//EN"}, {"CALSCALE", [], "GREGORIAN"}],
        components: timezones ++ [vevent]
      }
    ])
  end

  @doc """
  An existing calendar object with its event changed to match `event`.
  Everything else in it stays. Only for events that don't repeat.
  """
  def patch(text, event, now \\ DateTime.utc_now()) do
    ours = ~w(DTSTART DTEND DURATION SUMMARY DESCRIPTION LOCATION X-KT-EMOJI X-KT-WHO DTSTAMP LAST-MODIFIED SEQUENCE)

    components = parse(text)

    case Enum.split_with(vevents(components), &is_nil(prop(&1, "RECURRENCE-ID"))) do
      {[master], []} ->
        if prop(master, "RRULE") || prop(master, "RDATE") do
          {:error, :repeats}
        else
          sequence = (int_or(value(master, "SEQUENCE"), 0) + 1) |> Integer.to_string()
          kept = Enum.reject(master.props, &(elem(&1, 0) in ours))

          changed = %{
            master
            | props: kept ++ [{"DTSTAMP", [], stamp(now)}, {"LAST-MODIFIED", [], stamp(now)}, {"SEQUENCE", [], sequence}] ++ event_props(event, false)
          }

          {:ok, components |> replace_vevent(master, changed) |> to_text()}
        end

      _ ->
        {:error, :repeats}
    end
  end

  defp replace_vevent(components, old, new) do
    Enum.map(components, fn
      ^old -> new
      %{components: inner} = c -> %{c | components: replace_vevent(inner, old, new)}
    end)
  end

  defp int_or(nil, default), do: default

  defp int_or(text, default) do
    case Integer.parse(String.trim(text)) do
      {n, _} -> n
      :error -> default
    end
  end

  defp event_props(event, zoned?) do
    zone = event.time_zone || "Europe/London"

    timing =
      cond do
        event.all_day ->
          [
            {"DTSTART", [{"VALUE", "DATE"}], Date.to_iso8601(event.start_date, :basic)},
            {"DTEND", [{"VALUE", "DATE"}], Date.to_iso8601(Date.add(event.end_date || event.start_date, 1), :basic)}
          ]

        zoned? ->
          [
            {"DTSTART", [{"TZID", zone}], local_stamp(event.starts_at, zone)},
            {"DTEND", [{"TZID", zone}], local_stamp(event.ends_at || event.starts_at, zone)}
          ]

        true ->
          [{"DTSTART", [], stamp(event.starts_at)}, {"DTEND", [], stamp(event.ends_at || event.starts_at)}]
      end

    optional = fn name, v -> if v in [nil, ""], do: [], else: [{name, [], escape(v)}] end

    timing ++
      [{"SUMMARY", [], escape(event.title)}] ++
      optional.("DESCRIPTION", event.notes) ++
      optional.("LOCATION", event.location) ++
      optional.("X-KT-EMOJI", event.emoji) ++
      optional.("X-KT-WHO", Enum.join(event.who || [], ","))
  end

  defp rrule(event, zone) do
    base = "FREQ=" <> String.upcase(event.repeat)

    case event.repeat_until do
      nil ->
        base

      %Date{} = until when event.all_day ->
        base <> ";UNTIL=" <> Date.to_iso8601(until, :basic)

      %Date{} = until ->
        # The end of that day where the event is, in UTC, as RFC 5545 asks.
        last = to_utc(NaiveDateTime.new!(until, ~T[23:59:59]), zone)
        base <> ";UNTIL=" <> stamp(last)
    end
  end

  defp stamp(%DateTime{} = t), do: t |> DateTime.shift_zone!("Etc/UTC") |> Calendar.strftime("%Y%m%dT%H%M%SZ")
  defp local_stamp(%DateTime{} = t, zone), do: t |> DateTime.shift_zone!(zone) |> Calendar.strftime("%Y%m%dT%H%M%S")

  @doc """
  A VTIMEZONE for a zone, from this year's rules: when the clocks change,
  as "the last Sunday in March" and so on.
  """
  def vtimezone(zone, year) do
    changes = transitions(zone, year)

    parts =
      case changes do
        [] ->
          at = DateTime.shift_zone!(DateTime.new!(Date.new!(year, 1, 1), ~T[12:00:00], "Etc/UTC"), zone)
          offset = at.utc_offset + at.std_offset
          [tz_part("STANDARD", offset, offset, at.zone_abbr, "19700101T000000", nil)]

        changes ->
          Enum.map(changes, fn {before, after_, local} ->
            day = NaiveDateTime.to_date(local)
            nth = if day.day + 7 > Date.days_in_month(day), do: -1, else: div(day.day - 1, 7) + 1
            weekday = Enum.at(~w(MO TU WE TH FR SA SU), Date.day_of_week(day) - 1)

            tz_part(
              if(after_.std_offset != 0, do: "DAYLIGHT", else: "STANDARD"),
              before.utc_offset + before.std_offset,
              after_.utc_offset + after_.std_offset,
              after_.zone_abbr,
              Calendar.strftime(local, "%Y%m%dT%H%M%S"),
              "FREQ=YEARLY;BYMONTH=#{day.month};BYDAY=#{nth}#{weekday}"
            )
          end)
      end

    %{name: "VTIMEZONE", props: [{"TZID", [], zone}], components: parts}
  end

  defp tz_part(name, from, to, abbr, start, rule) do
    props =
      [{"TZOFFSETFROM", [], offset(from)}, {"TZOFFSETTO", [], offset(to)}, {"TZNAME", [], abbr}, {"DTSTART", [], start}] ++
        if(rule, do: [{"RRULE", [], rule}], else: [])

    %{name: name, props: props, components: []}
  end

  defp offset(secs) do
    sign = if secs < 0, do: "-", else: "+"
    secs = abs(secs)
    sign <> pad(div(secs, 3600)) <> pad(rem(div(secs, 60), 60))
  end

  defp pad(n), do: n |> Integer.to_string() |> String.pad_leading(2, "0")

  # The moments the clocks change in a year: {zone before, zone after, wall-clock time before}.
  defp transitions(zone, year) do
    at = fn utc -> DateTime.shift_zone!(utc, zone) end
    total = fn dt -> dt.utc_offset + dt.std_offset end
    noon = fn day -> at.(DateTime.new!(day, ~T[12:00:00], "Etc/UTC")) end

    Date.range(Date.new!(year, 1, 2), Date.new!(year, 12, 31))
    |> Enum.flat_map(fn day ->
      before = noon.(Date.add(day, -1))
      after_ = noon.(day)

      if total.(before) != total.(after_) or before.std_offset != after_.std_offset do
        start = DateTime.new!(Date.add(day, -1), ~T[12:00:00], "Etc/UTC")

        hour =
          Enum.find(1..24, 24, fn h -> total.(at.(DateTime.add(start, h * 3600))) != total.(before) end)

        moment = DateTime.add(start, hour * 3600)
        local = moment |> DateTime.add(total.(before)) |> DateTime.to_naive()
        [{before, at.(moment), local}]
      else
        []
      end
    end)
  end

  @doc "iCalendar text for components, with long lines folded."
  def to_text(components), do: components |> Enum.map(&component_text/1) |> IO.iodata_to_binary()

  defp component_text(%{name: name, props: props, components: inner}) do
    [
      "BEGIN:",
      name,
      "\r\n",
      Enum.map(props, &prop_text/1),
      Enum.map(inner, &component_text/1),
      "END:",
      name,
      "\r\n"
    ]
  end

  defp prop_text({name, params, value}) do
    params = Enum.map(params, fn {k, v} -> [";", k, "=", quote_param(v)] end)
    [fold(IO.iodata_to_binary([name, params, ":", value])), "\r\n"]
  end

  defp quote_param(v), do: if(String.contains?(v, [":", ";", ","]), do: ["\"", String.replace(v, "\"", ""), "\""], else: v)

  # Lines are at most 75 bytes; a character is never split.
  defp fold(line) when byte_size(line) <= 75, do: line

  defp fold(line) do
    line
    |> String.codepoints()
    |> Enum.reduce({[], "", 75}, fn c, {lines, current, limit} ->
      if byte_size(current) + byte_size(c) > limit, do: {[current | lines], c, 74}, else: {lines, current <> c, limit}
    end)
    |> then(fn {lines, current, _} -> Enum.reverse([current | lines]) end)
    |> Enum.join("\r\n ")
  end
end
