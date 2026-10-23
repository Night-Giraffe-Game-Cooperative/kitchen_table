defmodule Family.DaySummary do
  @moduledoc """
  Two notifications a day saying what a day holds: in the morning, today;
  in the evening, tomorrow, while there's still time to pack the PE kit.
  Each has what's on in the calendar, what the kids need to remember and
  homework that's due; the morning one also counts the jobs. Tapping either
  opens Today, which shows the same and more.

  Grown-ups get them for their own household, at seven and at eight in the
  evening, unless they choose other times or switch them off under Me; kids
  get ones about themselves only if they choose a time. A day with nothing
  on sends nothing. Quiet hours hold one back until they end, and one more
  than four hours late (the server was off, say) is skipped rather than
  sent at lunchtime.

  Days and times are the family's own, as everywhere else.
  """

  use GenServer
  import Ecto.Query
  require Logger
  alias Family.{Calendar, Permissions, Push, Repo, Tasks}
  alias Family.Accounts.User
  alias Family.Calendar.Event

  @kinds %{
    morning: %{usual: "07:00", sent: :morning_sent_on, ahead: 0, word: "Today"},
    evening: %{usual: "20:00", sent: :evening_sent_on, ahead: 1, word: "Tomorrow"}
  }
  @late_by 4 * 60
  @tick :timer.minutes(1)
  @line 140

  ## When

  @doc "When someone's morning or evening summary comes, as \"07:00\", or nil if it doesn't."
  def time(%User{} = user, kind) do
    case Map.fetch!(user, kind) do
      "off" -> nil
      <<_::binary-size(5)>> = at -> at
      _ -> if user.role == "kid", do: nil, else: @kinds[kind].usual
    end
  end

  @doc """
  Sends the morning or evening summaries due by `now`, a time in the
  family's own zone, and gives the ids of the people sent one. Each person
  gets each kind once a day at most; someone held back by quiet hours is
  looked at again next time.
  """
  def send_due(kind, %NaiveDateTime{} = now \\ family_now()) when is_map_key(@kinds, kind) do
    %{sent: sent_on, ahead: ahead} = @kinds[kind]
    day = NaiveDateTime.to_date(now)
    minute = now.hour * 60 + now.minute
    erl = NaiveDateTime.to_erl(now)

    waiting =
      Repo.all(
        from u in User,
          where: u.active and (is_nil(field(u, ^kind)) or field(u, ^kind) != "off"),
          where: is_nil(field(u, ^sent_on)) or field(u, ^sent_on) < ^day,
          where: u.id in subquery(Push.with_devices())
      )

    sent =
      for user <- waiting,
          at = minutes(time(user, kind)),
          at != nil and minute >= at,
          not Permissions.quiet_now?(user, erl) or minute >= at + @late_by do
        Repo.update_all(from(u in User, where: u.id == ^user.id), set: [{sent_on, day}])

        with true <- minute < at + @late_by,
             %{} = summary <- summary(user, Date.add(day, ahead), kind) do
          Push.day_summary(user, kind, summary)
          user.id
        else
          _ -> nil
        end
      end

    Enum.reject(sent, &is_nil/1)
  end

  defp minutes(nil), do: nil
  defp minutes(<<h::binary-size(2), ":", m::binary-size(2)>>), do: String.to_integer(h) * 60 + String.to_integer(m)

  defp family_now, do: zone() |> DateTime.now!() |> DateTime.to_naive()

  defp zone, do: Application.get_env(:family, :time_zone, "Europe/London")

  ## What

  @doc """
  The summary for someone of a day, sent the morning of it or the evening
  before: `%{title, body, lines}`, or nil when there's nothing to say.
  """
  def summary(%User{} = user, %Date{} = day, kind \\ :morning) do
    household = household(user)
    names = Repo.all(from u in User, where: u.id in ^household, select: {u.id, u.name}) |> Map.new()
    kid = user.role == "kid"
    about = if kid, do: [user.id], else: household

    events = if kid, do: Enum.filter(events_on(user, day), &(&1.who == [] or user.id in &1.who)), else: events_on(user, day)

    {tasks, done} = if Permissions.can?(user, :tasks), do: Tasks.list(user, day, day), else: {[], []}
    tasks = for t <- tasks, ids = Enum.filter(t.user_ids, &(&1 in about)), ids != [], do: %{t | user_ids: ids}
    ticked = MapSet.new(done, &{&1.task_id, &1.user_id})

    reminders = Enum.filter(tasks, &(&1.kind == "reminder" and due?(&1, day)))
    homework = Enum.filter(tasks, &(&1.kind == "homework" and &1.due_on == day and &1.status != "handed_in"))

    jobs =
      for t <- tasks, t.kind == "job", due?(t, day), id <- t.user_ids, not MapSet.member?(ticked, {t.id, id}), do: {t, id}

    checks = user |> Tasks.to_check() |> Enum.filter(&(&1.user_id in about)) |> length()

    lines =
      [
        events != [] && events |> Enum.map(&event_label(&1, day)) |> joined(),
        reminders != [] && "Remember: " <> (reminders |> Enum.map(&task_label(&1, names, user)) |> joined()),
        homework != [] && "Homework due: " <> (homework |> Enum.map(&task_label(&1, names, user)) |> joined()),
        kind == :morning and jobs != [] && "✅ #{length(jobs)} job#{if length(jobs) == 1, do: "", else: "s"} to tick off",
        checks > 0 && "👀 #{checks} tick#{if checks == 1, do: "", else: "s"} from the kids to check"
      ]
      |> Enum.filter(&is_binary/1)

    if lines != [] do
      %{title: title(day, kind), body: Enum.join(lines, "\n"), lines: lines}
    end
  end

  defp household(%User{bubble_id: nil, id: id}), do: [id]

  defp household(%User{bubble_id: bubble}),
    do: Repo.all(from u in User, where: u.active and u.bubble_id == ^bubble, select: u.id)

  @weekdays ~w(Monday Tuesday Wednesday Thursday Friday Saturday Sunday)
  @months ~w(January February March April May June July August September October November December)

  # "Today, Friday 23 October", or "Tomorrow, …" the evening before.
  defp title(day, kind), do: "#{@kinds[kind].word}, #{Enum.at(@weekdays, Date.day_of_week(day) - 1)} #{day.day} #{Enum.at(@months, day.month - 1)}"

  # "🏊 Swimming 16:00 · 🦷 Dentist 10:30", cut short with "and 2 more".
  defp joined(labels) do
    Enum.reduce_while(Enum.with_index(labels), "", fn {label, i}, acc ->
      next = if acc == "", do: label, else: acc <> " · " <> label
      left = length(labels) - i - 1

      if String.length(next) > @line and acc != "",
        do: {:halt, acc <> " and #{left + 1} more"},
        else: {:cont, next}
    end)
  end

  defp task_label(task, names, viewer) do
    who = task.user_ids |> Enum.reject(&(&1 == viewer.id)) |> Enum.map(&names[&1]) |> Enum.reject(&is_nil/1)
    label = "#{task.emoji} #{task.title}"
    if who == [], do: label, else: "#{label} (#{Enum.join(who, ", ")})"
  end

  defp due?(task, day), do: if(task.on_date, do: task.on_date == day, else: Date.day_of_week(day) in task.days)

  ## The calendar on a day

  @doc false
  def events_on(%User{} = user, %Date{} = day) do
    user
    |> Calendar.list(day, day)
    |> Enum.flat_map(fn e -> List.wrap(on(e, day)) end)
    # All-day things first, then by when they start, as the calendar shows them.
    |> Enum.sort_by(fn {e, starts, _} -> {not e.all_day, NaiveDateTime.to_erl(starts), e.title} end)
    |> Enum.map(fn
      {%Event{all_day: true} = e, _, _} -> e
      {e, starts, ends} -> %{e | starts_at: starts, ends_at: ends}
    end)
  end

  # This event's showing on the day, if it has one: the event with its start
  # and end as times in the family's zone (an all-day one starts at midnight).
  defp on(%Event{all_day: true} = e, day) do
    first = e.start_date
    length = Date.diff(e.end_date || first, first) |> max(0)

    with %Date{} = from <- showing_from(e, first, length, day), do: {e, NaiveDateTime.new!(from, ~T[00:00:00]), nil}
  end

  defp on(%Event{} = e, day) do
    zone = zone()
    starts = e.starts_at |> DateTime.shift_zone!(zone) |> DateTime.to_naive()
    ends = (e.ends_at || e.starts_at) |> DateTime.shift_zone!(zone) |> DateTime.to_naive()
    last_moment = if NaiveDateTime.compare(ends, starts) == :gt, do: NaiveDateTime.add(ends, -1), else: starts
    first = NaiveDateTime.to_date(starts)
    length = Date.diff(NaiveDateTime.to_date(last_moment), first)

    with %Date{} = from <- showing_from(e, first, length, day) do
      shift = Date.diff(from, first)
      # Moved by days, so a nine o'clock swim stays at nine when the clocks change.
      {e, NaiveDateTime.add(starts, shift * 86_400), NaiveDateTime.add(ends, shift * 86_400)}
    end
  end

  # The day the showing that covers `day` starts on, if one does.
  defp showing_from(%Event{repeat: repeat} = e, first, length, day) do
    Enum.find(Enum.map(length..0//-1, &Date.add(day, -&1)), fn start ->
      Date.compare(start, first) != :lt and
        (repeat == "none" or is_nil(e.repeat_until) or Date.compare(start, e.repeat_until) != :gt) and
        repeats_on?(repeat, first, start)
    end)
  end

  defp repeats_on?("none", first, start), do: start == first
  defp repeats_on?("daily", _first, _start), do: true
  defp repeats_on?("weekly", first, start), do: rem(Date.diff(start, first), 7) == 0
  defp repeats_on?("monthly", first, start), do: start.day == first.day
  defp repeats_on?("yearly", first, start), do: start.day == first.day and start.month == first.month
  defp repeats_on?(_, _, _), do: false

  defp event_label(%Event{all_day: true} = e, _day), do: "#{e.emoji} #{e.title}"

  defp event_label(%Event{} = e, day) do
    if NaiveDateTime.to_date(e.starts_at) == day,
      do: "#{e.emoji} #{e.title} #{clock(e.starts_at)}",
      else: "#{e.emoji} #{e.title} until #{clock(e.ends_at)}"
  end

  defp clock(%NaiveDateTime{} = t), do: t |> NaiveDateTime.to_time() |> Time.to_string() |> String.slice(0, 5)

  ## Ticking

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @impl true
  def init(_) do
    if Application.get_env(:family, :summary_ticks, true), do: Process.send_after(self(), :tick, :timer.seconds(20))
    {:ok, nil}
  end

  @impl true
  def handle_info(:tick, state) do
    for kind <- Map.keys(@kinds) do
      try do
        case send_due(kind) do
          [] -> :ok
          ids -> Logger.info("Sent #{length(ids)} #{kind} summar#{if length(ids) == 1, do: "y", else: "ies"}")
        end
      rescue
        e -> Logger.error("Sending #{kind} summaries failed: " <> Exception.message(e))
      end
    end

    Process.send_after(self(), :tick, @tick)
    {:noreply, state}
  end
end
