import { describe, expect, it } from 'vitest';
import {
  dueLabel,
  money,
  addDays,
  addMonths,
  daysBetween,
  daysLabel,
  monthGrid,
  occurrences,
  onDay,
  presetOf,
  relativeLabel,
  repeatLabel,
  repeatStarts,
  startOfWeek,
  taskDue,
  timeLabel,
  whenLabel,
  weekday,
} from './days';
import type { CalendarEvent, Task } from './types';

function event(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 1,
    title: 'Swimming',
    emoji: '🏊',
    notes: null,
    location: null,
    all_day: false,
    starts_at: null,
    ends_at: null,
    start_date: null,
    end_date: null,
    time_zone: 'Europe/London',
    repeat: 'none',
    repeat_until: null,
    who: [],
    source: 'app',
    link_id: null,
    recurring: false,
    ...over,
  };
}

function task(over: Partial<Task>): Task {
  return {
    id: 1,
    kind: 'job',
    title: 'Feed the cat',
    emoji: '🐱',
    notes: null,
    user_ids: [1],
    days: [],
    on_date: null,
    part: 'any',
    subject: null,
    due_on: null,
    status: null,
    stars: 1,
    pence: 0,
    sticker: false,
    created_by_id: 1,
    ...over,
  };
}

describe('days', () => {
  it('runs in the family time zone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/London');
  });

  it('counts weeks from Monday, as the server does', () => {
    expect(weekday('2026-10-19')).toBe(1);
    expect(weekday('2026-10-25')).toBe(7);
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19');
    expect(startOfWeek('2026-10-19')).toBe('2026-10-19');
  });

  it('adds days across the clocks going back and the year turning', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
  });

  it('lays out a month in whole Monday-first weeks', () => {
    const october = monthGrid('2026-10-20');
    expect(october[0][0]).toBe('2026-09-28');
    expect(october[october.length - 1][6]).toBe('2026-11-01');
    expect(october).toHaveLength(5);
    // February 2027 starts on a Monday and fills exactly four weeks.
    expect(monthGrid('2027-02-10')).toHaveLength(4);
    // March 2026 starts on a Sunday and needs six.
    expect(monthGrid('2026-03-01')).toHaveLength(6);
  });

  it('says days the way people do', () => {
    expect(relativeLabel('2026-10-20', '2026-10-20')).toBe('Today');
    expect(relativeLabel('2026-10-21', '2026-10-20')).toBe('Tomorrow');
    expect(relativeLabel('2026-10-23', '2026-10-20')).toBe('Friday');
    expect(relativeLabel('2026-11-03', '2026-10-20')).toBe('Tue 3 Nov');
  });
});

describe('repeats', () => {
  it('steps by days and weeks from the first day', () => {
    expect(repeatStarts('weekly', '2026-10-06', '2026-10-15', '2026-10-31')).toEqual(['2026-10-20', '2026-10-27']);
    expect(repeatStarts('daily', '2026-10-20', '2026-10-01', '2026-10-22')).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    expect(repeatStarts('weekly', '2026-11-01', '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('skips months without the day, as Google does', () => {
    expect(repeatStarts('monthly', '2026-01-31', '2026-01-01', '2026-06-30')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
    expect(repeatStarts('yearly', '2024-02-29', '2025-01-01', '2028-12-31')).toEqual(['2028-02-29']);
    expect(repeatStarts('yearly', '2019-10-21', '2026-10-01', '2026-10-31')).toEqual(['2026-10-21']);
  });

  it('keeps the clock time when the clocks change', () => {
    // Saturday swimming at 9 in the summer stays at 9 once the clocks go back on 25 October.
    const swim = event({ starts_at: '2026-10-17T08:00:00Z', ends_at: '2026-10-17T09:00:00Z', repeat: 'weekly' });
    const [a, b] = occurrences([swim], '2026-10-17', '2026-10-31');
    expect([a.first, a.start.getHours()]).toEqual(['2026-10-17', 9]);
    expect(b.first).toBe('2026-10-24');
    const later = occurrences([swim], '2026-10-31', '2026-10-31')[0];
    expect([later.first, later.start.getHours(), later.start.toISOString()]).toEqual(['2026-10-31', 9, '2026-10-31T09:00:00.000Z']);
    expect(later.end.getHours()).toBe(10);
  });

  it('stops on the last day it repeats', () => {
    const club = event({ start_date: '2026-10-05', end_date: '2026-10-05', all_day: true, repeat: 'weekly', repeat_until: '2026-10-19' });
    expect(occurrences([club], '2026-10-01', '2026-11-30').map((o) => o.first)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
  });

  it('finds a long repeat that started before the days shown', () => {
    const camp = event({ all_day: true, start_date: '2026-09-29', end_date: '2026-10-02', repeat: 'monthly' });
    const shown = occurrences([camp], '2026-10-01', '2026-10-31');
    expect(shown.map((o) => [o.first, o.last])).toEqual([
      ['2026-09-29', '2026-10-02'],
      ['2026-10-29', '2026-11-01'],
    ]);
  });
});

describe('a day of events', () => {
  const party = event({ id: 2, title: 'Party', all_day: true, start_date: '2026-10-24', end_date: '2026-10-25' });
  const late = event({ id: 3, title: 'Sleepover', starts_at: '2026-10-23T17:00:00Z', ends_at: '2026-10-24T09:00:00Z' });
  const film = event({ id: 4, title: 'Film', starts_at: '2026-10-24T14:00:00Z', ends_at: '2026-10-24T16:00:00Z' });
  const midnight = event({ id: 5, title: 'Bake', starts_at: '2026-10-23T21:00:00Z', ends_at: '2026-10-23T23:00:00Z' });

  it('puts all-day things first, then goes by time', () => {
    const all = occurrences([film, late, party, midnight], '2026-10-24', '2026-10-24');
    expect(onDay(all, '2026-10-24').map((o) => o.event.title)).toEqual(['Party', 'Sleepover', 'Film']);
  });

  it("doesn't spill an event ending at midnight into the next day", () => {
    expect(occurrences([midnight], '2026-10-24', '2026-10-24')).toEqual([]);
  });

  it('says when, for each day an event touches', () => {
    const [o] = occurrences([late], '2026-10-23', '2026-10-24');
    expect(timeLabel(o, '2026-10-23')).toBe('From 18:00');
    expect(timeLabel(o, '2026-10-24')).toBe('Until 10:00');
    const [f] = occurrences([film], '2026-10-24', '2026-10-24');
    expect(timeLabel(f, '2026-10-24')).toBe('15:00 to 17:00');
    const [p] = occurrences([party], '2026-10-24', '2026-10-24');
    expect(timeLabel(p, '2026-10-24')).toBe('All day, until Sun 25 Oct');
  });

  it('says the whole of when', () => {
    const [o] = occurrences([late], '2026-10-23', '2026-10-24');
    expect(whenLabel(o)).toBe('Fri 23 Oct 18:00 to Sat 24 Oct 10:00');
    const [f] = occurrences([film], '2026-10-24', '2026-10-24');
    expect(whenLabel(f)).toBe('Saturday 24 October, 15:00 to 17:00');
    const [p] = occurrences([party], '2026-10-24', '2026-10-24');
    expect(whenLabel(p)).toBe('Sat 24 Oct to Sun 25 Oct');
  });

  it('describes repeats', () => {
    expect(repeatLabel('weekly', '2026-10-20')).toBe('Every Tuesday');
    expect(repeatLabel('monthly', '2026-10-22')).toBe('Every month on the 22nd');
    expect(repeatLabel('monthly', '2026-10-11')).toBe('Every month on the 11th');
    expect(repeatLabel('yearly', '2026-10-20')).toBe('Every year on 20 October');
  });
});

describe('tasks', () => {
  it('comes round on its days, or once', () => {
    expect(taskDue(task({ days: [1, 3, 5] }), '2026-10-21')).toBe(true);
    expect(taskDue(task({ days: [1, 3, 5] }), '2026-10-20')).toBe(false);
    expect(taskDue(task({ on_date: '2026-10-20', days: [3] }), '2026-10-20')).toBe(true);
    expect(taskDue(task({ on_date: '2026-10-20', days: [3] }), '2026-10-21')).toBe(false);
    // Homework isn't a daily job; it has a due day instead.
    expect(taskDue(task({ kind: 'homework', on_date: '2026-10-20', due_on: '2026-10-22' }), '2026-10-20')).toBe(false);
  });

  it('names its days', () => {
    expect(daysLabel(task({ days: [7, 6] }))).toBe('Weekends');
    expect(daysLabel(task({ days: [1, 2, 3, 4, 5, 6, 7] }))).toBe('Every day');
    expect(daysLabel(task({ days: [5, 1, 3] }))).toBe('Mon, Wed and Fri');
    expect(daysLabel(task({ days: [2] }))).toBe('Tue');
    expect(daysLabel(task({ on_date: '2026-10-21' }))).toBe('Just on Wed 21 Oct');
    expect(presetOf({ days: [1, 2, 3, 4, 5], on_date: null })).toBe('weekdays');
  });

  it('says when homework is due', () => {
    expect(dueLabel('2026-10-21', '2026-10-21')).toBe('Due today');
    expect(dueLabel('2026-10-22', '2026-10-21')).toBe('Due tomorrow');
    expect(dueLabel('2026-10-23', '2026-10-21')).toBe('Due Friday');
    expect(dueLabel('2026-11-02', '2026-10-21')).toBe('Due Mon 2 Nov');
    expect(dueLabel('2026-10-20', '2026-10-21')).toBe('Was due yesterday');
    expect(dueLabel('2026-10-18', '2026-10-21')).toBe('3 days late');
  });

  it('writes pocket money the way people say it', () => {
    expect([money(50), money(5), money(100), money(250), money(1205)]).toEqual(['50p', '5p', '£1', '£2.50', '£12.05']);
  });
});
