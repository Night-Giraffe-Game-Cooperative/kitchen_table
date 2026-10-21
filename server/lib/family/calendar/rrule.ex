defmodule Family.Calendar.RRule do
  @moduledoc """
  The days a repeating calendar event falls on, from an iCalendar RRULE such
  as `FREQ=WEEKLY;BYDAY=TU,TH` or `FREQ=MONTHLY;BYDAY=-1FR` (RFC 5545).

  It covers what calendars people use actually send: every day, week, month
  or year, every so many of them, on chosen weekdays (the second Monday, the
  last Friday), chosen days of the month or chosen months, a count, an end,
  and BYSETPOS for things like "the last weekday of the month". Hours and
  minutes aren't repeated within a day; the event's own time is used.
  """

  @weekdays %{"MO" => 1, "TU" => 2, "WE" => 3, "TH" => 4, "FR" => 5, "SA" => 6, "SU" => 7}
  @max_periods 20_000

  @type rule :: %{
          freq: :daily | :weekly | :monthly | :yearly,
          interval: pos_integer(),
          count: pos_integer() | nil,
          until: String.t() | nil,
          by_day: [{integer() | nil, 1..7}],
          by_month_day: [integer()],
          by_month: [1..12],
          by_set_pos: [integer()],
          week_start: 1..7
        }

  @doc "Reads an RRULE value. Returns nil for a rule it can't follow."
  def parse(text) when is_binary(text) do
    parts =
      text
      |> String.trim()
      |> String.split(";", trim: true)
      |> Map.new(fn part ->
        case String.split(part, "=", parts: 2) do
          [k, v] -> {String.upcase(k), v}
          [k] -> {String.upcase(k), ""}
        end
      end)

    with freq when not is_nil(freq) <- freq(parts["FREQ"]) do
      %{
        freq: freq,
        interval: max(int(parts["INTERVAL"]) || 1, 1),
        count: int(parts["COUNT"]),
        until: parts["UNTIL"],
        by_day: list(parts["BYDAY"], &by_day/1),
        by_month_day: list(parts["BYMONTHDAY"], &int/1),
        by_month: list(parts["BYMONTH"], &int/1) |> Enum.filter(&(&1 in 1..12)),
        by_set_pos: list(parts["BYSETPOS"], &int/1),
        # Which day weeks start on, which matters for every other week.
        week_start: Map.get(@weekdays, String.upcase(parts["WKST"] || ""), 1)
      }
    end
  end

  def parse(_), do: nil

  defp freq("DAILY"), do: :daily
  defp freq("WEEKLY"), do: :weekly
  defp freq("MONTHLY"), do: :monthly
  defp freq("YEARLY"), do: :yearly
  defp freq(_), do: nil

  defp int(nil), do: nil

  defp int(text) do
    case Integer.parse(String.trim(text)) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp list(nil, _), do: []
  defp list(text, fun), do: text |> String.split(",", trim: true) |> Enum.map(fun) |> Enum.reject(&is_nil/1)

  # "MO", "2MO", "-1FR"
  defp by_day(text) do
    case Regex.run(~r/^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/, String.upcase(String.trim(text))) do
      [_, "", day] -> {nil, @weekdays[day]}
      [_, n, day] -> {int(String.trim_leading(n, "+")), @weekdays[day]}
      _ -> nil
    end
  end

  @doc """
  The days the rule falls on, in order, from `first` (the event's own first
  day, which always counts) to no later than `last`. Given `from`, days
  before it may be left out, so an event that has repeated every day for
  years doesn't walk through all of them; a COUNT still counts from `first`.
  """
  def days(%{} = rule, %Date{} = first, %Date{} = last, from \\ nil) do
    skip_to = if rule.count || is_nil(from) || Date.compare(from, first) != :gt, do: nil, else: from

    rule
    |> period_starts(first, skip_to)
    |> Stream.take(@max_periods)
    |> Stream.take_while(&(Date.compare(&1, last) != :gt))
    |> Stream.flat_map(&candidates(rule, &1, first))
    |> Stream.reject(&(Date.compare(&1, first) == :lt))
    |> Stream.take_while(&(Date.compare(&1, last) != :gt))
    |> Stream.dedup()
    |> Enum.to_list()
    |> then(fn
      [^first | _] = days -> days
      days when is_nil(skip_to) -> [first | days]
      days -> days
    end)
    |> then(fn days -> if rule.count, do: Enum.take(days, rule.count), else: days end)
  end

  # The first day of each period the rule repeats over, from the period
  # holding `first`, or the last one starting before `skip_to`.
  defp period_starts(%{freq: :daily, interval: n}, first, skip_to) do
    start = if skip_to, do: Date.add(first, div(Date.diff(skip_to, first), n) * n), else: first
    Stream.iterate(start, &Date.add(&1, n))
  end

  defp period_starts(%{freq: :weekly, interval: n} = rule, first, skip_to) do
    week = Date.add(first, -day_in_week(rule, first))
    start = if skip_to, do: Date.add(week, div(Date.diff(skip_to, week), 7 * n) * 7 * n), else: week
    Stream.iterate(start, &Date.add(&1, 7 * n))
  end

  defp period_starts(%{freq: :monthly, interval: n}, first, skip_to) do
    month = Date.new!(first.year, first.month, 1)
    months = if skip_to, do: div((skip_to.year - first.year) * 12 + skip_to.month - first.month, n) * n, else: 0
    Stream.iterate(Date.shift(month, month: months), &Date.shift(&1, month: n))
  end

  defp period_starts(%{freq: :yearly, interval: n}, first, skip_to) do
    years = if skip_to, do: div(skip_to.year - first.year, n) * n, else: 0
    Stream.iterate(Date.new!(first.year + years, 1, 1), &Date.shift(&1, year: n))
  end

  # The days in one period, before COUNT and the window.
  defp candidates(%{freq: :daily} = rule, day, _first) do
    if in_month?(rule, day) and month_day_ok?(rule, day) and weekday_ok?(rule, day), do: [day], else: []
  end

  defp candidates(%{freq: :weekly} = rule, week, first) do
    weekdays = if rule.by_day == [], do: [Date.day_of_week(first)], else: rule.by_day |> Enum.map(&elem(&1, 1)) |> Enum.uniq()

    weekdays
    |> Enum.map(&rem(&1 - rule.week_start + 7, 7))
    |> Enum.sort()
    |> Enum.map(&Date.add(week, &1))
    |> Enum.filter(&in_month?(rule, &1))
  end

  defp candidates(%{freq: :monthly} = rule, month_start, first) do
    if rule.by_month == [] or month_start.month in rule.by_month,
      do: month_days(rule, month_start.year, month_start.month, first),
      else: []
  end

  defp candidates(%{freq: :yearly} = rule, year_start, first) do
    months = if rule.by_month == [], do: [first.month], else: Enum.sort(rule.by_month)
    days = Enum.flat_map(months, &month_days(%{rule | by_set_pos: []}, year_start.year, &1, first))
    set_pos(days, rule.by_set_pos)
  end

  # How many days into its week a day is (0 on the day weeks start).
  defp day_in_week(rule, day), do: rem(Date.day_of_week(day) - rule.week_start + 7, 7)

  defp month_days(rule, year, month, first) do
    size = Calendar.ISO.days_in_month(year, month)

    days =
      cond do
        rule.by_month_day != [] ->
          rule.by_month_day
          |> Enum.map(&if(&1 < 0, do: size + 1 + &1, else: &1))
          |> Enum.filter(&(&1 in 1..size))
          |> Enum.map(&Date.new!(year, month, &1))
          |> Enum.filter(&weekday_ok?(rule, &1))

        rule.by_day != [] ->
          Enum.flat_map(rule.by_day, fn {nth, weekday} -> nth_weekdays(year, month, size, nth, weekday) end)

        first.day <= size ->
          [Date.new!(year, month, first.day)]

        # A month without the day (the 31st in April) is skipped.
        true ->
          []
      end

    days |> Enum.uniq() |> Enum.sort(Date) |> set_pos(rule.by_set_pos)
  end

  # Every Tuesday in the month, or the 2nd, or the last (-1).
  defp nth_weekdays(year, month, size, nth, weekday) do
    all = for d <- 1..size, date = Date.new!(year, month, d), Date.day_of_week(date) == weekday, do: date

    case nth do
      nil -> all
      n when n > 0 -> List.wrap(Enum.at(all, n - 1))
      n when n < 0 -> List.wrap(Enum.at(all, n))
      _ -> []
    end
  end

  defp set_pos(days, []), do: days

  defp set_pos(days, positions) do
    positions
    |> Enum.map(fn
      n when n > 0 -> Enum.at(days, n - 1)
      n when n < 0 -> Enum.at(days, n)
      _ -> nil
    end)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
    |> Enum.sort(Date)
  end

  defp in_month?(%{by_month: []}, _), do: true
  defp in_month?(%{by_month: months}, day), do: day.month in months

  defp month_day_ok?(%{by_month_day: []}, _), do: true

  defp month_day_ok?(%{by_month_day: days}, day) do
    size = Date.days_in_month(day)
    Enum.any?(days, &(&1 == day.day or (&1 < 0 and size + 1 + &1 == day.day)))
  end

  defp weekday_ok?(%{by_day: []}, _), do: true
  defp weekday_ok?(%{by_day: days}, day), do: Enum.any?(days, fn {_, wd} -> wd == Date.day_of_week(day) end)
end
