const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });
const dateYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function parseTime(iso: string): Date {
  // The server sends UTC without a zone for naive timestamps.
  return new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
}

export function timeOf(iso: string): string {
  return clock.format(parseTime(iso));
}

/** "Today", "Yesterday", "Tuesday", "3 March", "3 March 2025". */
export function dayLabel(iso: string, now = new Date()): string {
  const d = parseTime(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekday.format(d);
  return d.getFullYear() === now.getFullYear() ? date.format(d) : dateYear.format(d);
}

/** Short time for lists: "10:42", "Yesterday", "Tue", "3 Mar". */
export function shortTime(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const d = parseTime(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return clock.format(d);
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekday.format(d).slice(0, 3);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d);
}

export function sameDay(a: string, b: string): boolean {
  return startOfDay(parseTime(a)) === startOfDay(parseTime(b));
}

/** For the middle of a sentence: "just now", "5 minutes ago", "2 hours ago", "yesterday", "on Tuesday", "on 3 March". */
export function ago(iso: string, now = new Date()): string {
  const s = (now.getTime() - parseTime(iso).getTime()) / 1000;
  const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return count(Math.floor(s / 60), 'minute');
  if (s < 86_400 && sameDay(iso, now.toISOString())) return count(Math.floor(s / 3600), 'hour');
  const day = dayLabel(iso, now);
  return day === 'Yesterday' ? 'yesterday' : `on ${day}`;
}
