import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { join } from '../lib/socket';
import { today, type Day } from '../lib/days';
import type { Me, Person, Task, TaskCheck, TaskDone } from '../lib/types';

// What the Tasks section's views share: who may do what, live data and the stars.

export interface TaskData {
  tasks: Task[];
  done: TaskDone[];
  /** Kids' ticks waiting for this grown-up to check. */
  to_check?: TaskCheck[];
}

/** Where a task stands for someone on a day: not done, ticked by a kid and waiting for a grown-up, or done for real. */
export type TickState = 'todo' | 'waiting' | 'done';

/** Whether my tick on a task waits for a grown-up: a kid's, on a task a grown-up set. */
export function needsCheck(me: Me, task: Pick<Task, 'created_by_id'>): boolean {
  return me.role === 'kid' && task.created_by_id !== me.id;
}

/**
 * What tapping a task does now: true ticks it (or, for a grown-up, agrees a
 * kid's waiting tick), false unticks it, and null means it can't change,
 * as a kid can't untick what a grown-up has checked.
 */
export function tapTick(me: Me, task: Task, state: TickState): boolean | null {
  if (state === 'todo') return true;
  if (state === 'waiting') return me.role !== 'kid';
  return needsCheck(me, task) ? null : false;
}

/** The checkbox state for a tick: a waiting tick is half-way. */
export function ariaTick(state: TickState): boolean | 'mixed' {
  return state === 'waiting' ? 'mixed' : state === 'done';
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

/** Who may set or tick off someone's tasks: they themselves, an admin, or a grown-up who looks after them. */
export function canSetFor(me: Me, person: Person | undefined): boolean {
  if (!person) return false;
  if (person.id === me.id || me.permissions.manage_people) return true;
  return person.role === 'kid' && me.role === 'grownup' && me.permissions.manage_kids && me.bubble_id !== null && me.bubble_id === person.bubble_id;
}

export function canChange(me: Me, task: Task, personOf: (id: number) => Person | undefined): boolean {
  if (me.role === 'kid' && task.created_by_id !== me.id) return false;
  return task.user_ids.every((id) => canSetFor(me, personOf(id)));
}

/** A person's colour, for the stripe down their things. */
export function tint(person: Pick<Person, 'colour'> | undefined): CSSProperties {
  const c = person?.colour ?? 'slate';
  return { '--who': `var(--${c})`, '--who-tint': `var(--${c}-tint)` } as CSSProperties;
}

export function usePersonOf() {
  const { me, people } = useStore();
  return useCallback((id: number): Person | undefined => people.get(id) ?? (id === me.id ? me : undefined), [me, people]);
}

/** The day it is, moving on at midnight. */
export function useToday(): Day {
  const [day, setDay] = useState(today);
  useEffect(() => {
    const check = () => setDay(today());
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return day;
}

/** Fetches a path, and again whenever the server says it changed. */
export function useLive<T>(path: string | null, event: string) {
  const { me, connected } = useStore();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);

  useEffect(() => {
    if (!path) return;
    let live = true;
    api.get<T>(path).then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
      },
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [path, n, connected]);

  useEffect(() => {
    const [channel, leave] = join(`user:${me.id}`);
    const ref = channel.on(event, reload);
    return () => {
      channel.off(event, ref);
      leave();
    };
  }, [me.id, event, reload]);

  return { data, setData, error, reload };
}

export function useTasks(from: Day, to: Day) {
  const { me, toast } = useStore();
  const live = useLive<TaskData>(`/api/tasks?from=${from}&to=${to}`, 'tasks_changed');
  const { setData, reload } = live;

  const tick = useCallback(
    async (task: Task, personId: number, day: Day, done: boolean) => {
      const same = (c: Pick<TaskDone, 'task_id' | 'user_id' | 'on'>) => c.task_id === task.id && c.user_id === personId && c.on === day;
      const waits = needsCheck(me, task);
      setData((d) => {
        if (!d) return d;
        const rest = d.done.filter((c) => !same(c));
        const was = d.done.find(same);
        const to_check = d.to_check?.filter((c) => !same(c));
        if (!done) return { ...d, done: rest, to_check };
        const tick: TaskDone = {
          task_id: task.id,
          user_id: personId,
          on: day,
          done_by_id: was?.done_by_id ?? me.id,
          waiting: waits,
          stars: waits ? 0 : task.stars,
          pence: waits ? 0 : task.pence,
          sticker: was?.sticker ?? null,
        };
        return { ...d, done: [...rest, tick], to_check };
      });
      try {
        await api.post(`/api/tasks/${task.id}/done`, { user_id: personId, on: day, done });
      } catch (e) {
        toast(errorText(e), 'danger');
        reload();
      }
    },
    [me, setData, reload, toast],
  );

  /** A grown-up says a kid's waiting tick is done for real, or not yet. */
  const check = useCallback(
    async (item: TaskCheck, ok: boolean) => {
      const same = (c: Pick<TaskDone, 'task_id' | 'user_id' | 'on'>) => c.task_id === item.task_id && c.user_id === item.user_id && c.on === item.on;
      setData(
        (d) =>
          d && {
            ...d,
            to_check: d.to_check?.filter((c) => !same(c)),
            done: ok ? d.done.map((c) => (same(c) ? { ...c, waiting: false, stars: item.stars, pence: item.pence } : c)) : d.done.filter((c) => !same(c)),
            tasks: ok || item.kind !== 'homework' ? d.tasks : d.tasks.map((t) => (t.id === item.task_id ? { ...t, status: 'done' } : t)),
          },
      );
      try {
        await api.post(`/api/tasks/${item.task_id}/check`, { user_id: item.user_id, on: item.on, ok });
      } catch (e) {
        toast(errorText(e), 'danger');
      }
      reload();
    },
    [setData, reload, toast],
  );

  const stateOf = useCallback(
    (taskId: number, personId: number, day: Day): TickState => {
      const c = live.data?.done.find((c) => c.task_id === taskId && c.user_id === personId && c.on === day);
      return !c ? 'todo' : c.waiting ? 'waiting' : 'done';
    },
    [live.data],
  );

  /** Done, or ticked and waiting for a grown-up: either way it's off the list of things to do. */
  const isDone = useCallback((taskId: number, personId: number, day: Day) => stateOf(taskId, personId, day) !== 'todo', [stateOf]);

  return { ...live, tick, check, stateOf, isDone };
}

/** The people who have tasks, you first, then by name. */
export function taskPeople(tasks: Task[], me: Me, personOf: (id: number) => Person | undefined): Person[] {
  const ids = new Set(tasks.flatMap((t) => t.user_ids));
  return [...ids]
    .map(personOf)
    .filter((p): p is Person => !!p)
    .sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id) || a.name.localeCompare(b.name));
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="stars" data-tip="Stars this week">
      <span aria-hidden="true">⭐</span> {n}
      <span className="sr-only"> done this week</span>
    </span>
  );
}
