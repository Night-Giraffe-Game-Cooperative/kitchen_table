import type { CalendarEvent, DayPart, Repeat, Task } from './types';
import { parseTime } from './time';

/** A day on the family calendar, as YYYY-MM-DD in this device's time. Weeks start on Monday. */
export type Day = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function dayOf(d: Date): Day {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): Day {
  return dayOf(new Date());
}

/** Midnight at the start of a day, in this device's time. */
export function toDate(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: Day, n: number): Day {
  const d = toDate(day);
  d.setDate(d.getDate() + n);
  return dayOf(d);
}

function utc(day: Day): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from one day to another. */
export function daysBetween(from: Day, to: Day): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** 1 for Monday to 7 for Sunday, as the server counts. */
export function weekday(day: Day): number {
  const n = toDate(day).getDay();
  return n === 0 ? 7 : n;
}

export function startOfWeek(day: Day): Day {
  return addDays(day, 1 - weekday(day));
}

export function startOfMonth(day: Day): Day {
  return day.slice(0, 8) + '01';
}

/** The first day of the month n months on. */
export function addMonths(day: Day, n: number): Day {
  const d = toDate(startOfMonth(day));
  d.setMonth(d.getMonth() + n);
  return dayOf(d);
}

/** The weeks shown for a month, Monday first, each a row of seven days. */
export function monthGrid(month: Day): Day[][] {
  const first = startOfMonth(month);
  const inMonth = first.slice(0, 7);
  const weeks: Day[][] = [];
  let monday = startOfWeek(first);
  do {
    const start = monday;
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
    monday = addDays(monday, 7);
  } while (monday.slice(0, 7) === inMonth);
  return weeks;
}

// ---------- Words ----------

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', o);
const longDay = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const weekdayName = fmt({ weekday: 'long' });
const monthYear = fmt({ month: 'long', year: 'numeric' });
const clock = fmt({ hour: '2-digit', minute: '2-digit' });

export const weekdayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
export const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const weekdayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Tuesday 20 October". */
export function longLabel(day: Day): string {
  return longDay.format(toDate(day));
}

/** "Tue 20 Oct". */
export function shortLabel(day: Day): string {
  return shortDay.format(toDate(day));
}

/** "October 2026". */
export function monthLabel(day: Day): string {
  return monthYear.format(toDate(day));
}

/** "Today, Tuesday 20 October", or just "Thursday 22 October" further off. */
export function dayTitle(day: Day, now: Day = today()): string {
  const n = daysBetween(now, day);
  const near = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : null;
  return near ? `${near}, ${longLabel(day)}` : longLabel(day);
}

/** "Today", "Tomorrow", "Yesterday", "Thursday" within the week ahead, then "Tue 3 Nov". */
export function relativeLabel(day: Day, now: Day = today()): string {
  const n = daysBetween(now, day);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return weekdayName.format(toDate(day));
  return shortLabel(day);
}

export function clockLabel(d: Date): string {
  return clock.format(d);
}

// ---------- Events ----------

/** One showing of an event: a repeat makes many. */
export interface Occurrence {
  event: CalendarEvent;
  /** When it starts and ends. An all-day one runs from midnight to the midnight after its last day. */
  start: Date;
  end: Date;
  /** The first and last days it touches. */
  first: Day;
  last: Day;
}

/** An event's own first showing, before any repeats. */
export function firstOccurrence(e: CalendarEvent): Occurrence | null {
  if (e.all_day) {
    if (!e.start_date) return null;
    const last = e.end_date && e.end_date > e.start_date ? e.end_date : e.start_date;
    return { event: e, start: toDate(e.start_date), end: toDate(addDays(last, 1)), first: e.start_date, last };
  }
  if (!e.starts_at) return null;
  const start = parseTime(e.starts_at);
  const end = e.ends_at ? parseTime(e.ends_at) : start;
  // An event that ends at midnight doesn't touch the next day.
  const lastMoment = end > start ? new Date(end.getTime() - 1) : start;
  return { event: e, start, end, first: dayOf(start), last: dayOf(lastMoment) };
}

/** The days a repeat starts on, from its first day, between two days (inclusive). */
export function repeatStarts(repeat: Repeat, first: Day, min: Day, max: Day): Day[] {
  const out: Day[] = [];
  if (max < first) return out;
  const from = min > first ? min : first;

  if (repeat === 'daily' || repeat === 'weekly') {
    const step = repeat === 'daily' ? 1 : 7;
    const k = Math.ceil(daysBetween(first, from) / step);
    for (let day = addDays(first, k * step); day <= max; day = addDays(day, step)) out.push(day);
    return out;
  }

  if (repeat === 'monthly' || repeat === 'yearly') {
    // As Google does, a month without the day (the 31st, 29 February) is skipped.
    const [y, m, d] = first.split('-').map(Number);
    const months = repeat === 'monthly' ? 1 : 12;
    const [fy, fm] = from.split('-').map(Number);
    let k = Math.max(0, Math.floor(((fy - y) * 12 + (fm - m)) / months) - 1);
    for (; ; k++) {
      const date = new Date(y, m - 1 + k * months, d);
      const day = dayOf(date);
      if (day > max) break;
      if (date.getDate() === d && day >= from) out.push(day);
    }
  }
  return out;
}

/** Every occurrence that touches the days from..to (inclusive), with repeats worked out. */
export function occurrences(events: CalendarEvent[], from: Day, to: Day): Occurrence[] {
  const out: Occurrence[] = [];
  for (const e of events) {
    const one = firstOccurrence(e);
    if (!one) continue;
    if (e.repeat === 'none') {
      if (one.last >= from && one.first <= to) out.push(one);
      continue;
    }
    const length = daysBetween(one.first, one.last);
    const until = e.repeat_until && e.repeat_until < to ? e.repeat_until : to;
    for (const day of repeatStarts(e.repeat, one.first, addDays(from, -length), until)) {
      out.push(shift(one, daysBetween(one.first, day)));
    }
  }
  return out.sort(byStart);
}

function shift(o: Occurrence, days: number): Occurrence {
  if (days === 0) return o;
  const start = new Date(o.start);
  // Moving by calendar days keeps the clock time through the clocks changing.
  start.setDate(start.getDate() + days);
  const end = new Date(start.getTime() + (o.end.getTime() - o.start.getTime()));
  return { ...o, start, end, first: addDays(o.first, days), last: addDays(o.last, days) };
}

function byStart(a: Occurrence, b: Occurrence): number {
  return a.start.getTime() - b.start.getTime() || Number(b.event.all_day) - Number(a.event.all_day) || a.event.title.localeCompare(b.event.title);
}

/** What's on a day: all-day things first, then by time. */
export function onDay(list: Occurrence[], day: Day): Occurrence[] {
  return list
    .filter((o) => o.first <= day && o.last >= day)
    .sort((a, b) => Number(b.event.all_day) - Number(a.event.all_day) || byStart(a, b));
}

/** "09:30 to 10:30", "All day", "From 18:00", "Until 11:00", for one day of an occurrence. */
export function timeLabel(o: Occurrence, day: Day): string {
  if (o.event.all_day) return o.first === o.last ? 'All day' : `All day, until ${shortLabel(o.last)}`;
  const starts = o.first === day;
  const ends = o.last === day;
  if (starts && ends) return o.end > o.start ? `${clockLabel(o.start)} to ${clockLabel(o.end)}` : clockLabel(o.start);
  if (starts) return `From ${clockLabel(o.start)}`;
  if (ends) return `Until ${clockLabel(o.end)}`;
  return 'All day';
}

/** The whole of an occurrence: "Tuesday 20 October, 09:00 to 10:00", "Tue 20 Oct to Fri 23 Oct". */
export function whenLabel(o: Occurrence): string {
  if (o.event.all_day) return o.first === o.last ? `${longLabel(o.first)}, all day` : `${shortLabel(o.first)} to ${shortLabel(o.last)}`;
  if (o.first === o.last) return `${longLabel(o.first)}, ${timeLabel(o, o.first)}`;
  return `${shortLabel(o.first)} ${clockLabel(o.start)} to ${shortLabel(o.last)} ${clockLabel(o.end)}`;
}

export function repeatLabel(repeat: Repeat, first: Day): string {
  const d = toDate(first);
  switch (repeat) {
    case 'none':
      return "Doesn't repeat";
    case 'daily':
      return 'Every day';
    case 'weekly':
      return `Every ${weekdayName.format(d)}`;
    case 'monthly':
      return `Every month on the ${ordinal(d.getDate())}`;
    case 'yearly':
      return `Every year on ${fmt({ day: 'numeric', month: 'long' }).format(d)}`;
  }
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

// ---------- Tasks ----------

/** Whether a task comes round on a day: a one-off on its date, a regular one on its weekdays. */
export function taskDue(task: Task, day: Day): boolean {
  if (task.kind === 'homework') return false;
  return task.on_date ? task.on_date === day : task.days.includes(weekday(day));
}

/** When homework is due, from today's point of view: "Due today", "Due Friday", "2 days late". */
export function dueLabel(due: Day, now: Day): string {
  const n = daysBetween(now, due);
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  if (n === -1) return 'Was due yesterday';
  if (n < 0) return `${-n} days late`;
  if (n < 7) return `Due ${weekdayNames[weekday(due) - 1]}`;
  return `Due ${shortLabel(due)}`;
}

/** Pocket money as people say it: 50p, £1, £2.50. */
export function money(pence: number): string {
  if (Math.abs(pence) < 100) return `${pence}p`;
  const pounds = pence / 100;
  return `£${Number.isInteger(pounds) ? pounds : pounds.toFixed(2)}`;
}

export type DaysPreset = 'every' | 'weekdays' | 'weekends' | 'some' | 'once';

export function presetOf(task: Pick<Task, 'days' | 'on_date'>): DaysPreset {
  if (task.on_date) return 'once';
  const key = [...task.days].sort().join('');
  if (key === '1234567') return 'every';
  if (key === '12345') return 'weekdays';
  if (key === '67') return 'weekends';
  return 'some';
}

export const presetDays: Record<'every' | 'weekdays' | 'weekends', number[]> = {
  every: [1, 2, 3, 4, 5, 6, 7],
  weekdays: [1, 2, 3, 4, 5],
  weekends: [6, 7],
};

/** "Every day", "Weekdays", "Mon, Wed and Fri", "Just on Tue 21 Oct". */
export function daysLabel(task: Pick<Task, 'days' | 'on_date'>): string {
  switch (presetOf(task)) {
    case 'once':
      return `Just on ${shortLabel(task.on_date!)}`;
    case 'every':
      return 'Every day';
    case 'weekdays':
      return 'Weekdays';
    case 'weekends':
      return 'Weekends';
    case 'some': {
      const names = [...task.days].sort().map((n) => weekdayShort[n - 1]);
      return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? 'No days');
    }
  }
}

export const partLabels: Record<DayPart, string> = {
  any: 'Any time',
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

const partOrder: DayPart[] = ['morning', 'afternoon', 'evening', 'any'];

/** Tasks in the order a day goes: morning, afternoon, evening, then any time. */
export function byPart<T extends Pick<Task, 'part' | 'id'>>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => partOrder.indexOf(a.part) - partOrder.indexOf(b.part) || a.id - b.id);
}
