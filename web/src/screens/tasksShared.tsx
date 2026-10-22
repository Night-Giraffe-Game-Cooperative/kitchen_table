import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { join } from '../lib/socket';
import { today, type Day } from '../lib/days';
import type { Me, Person, Task, TaskDone } from '../lib/types';

// What the Tasks section's views share: who may do what, live data and the stars.

export interface TaskData {
  tasks: Task[];
  done: TaskDone[];
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
      const same = (c: TaskDone) => c.task_id === task.id && c.user_id === personId && c.on === day;
      setData((d) =>
        d && { ...d, done: done ? [...d.done.filter((c) => !same(c)), { task_id: task.id, user_id: personId, on: day, done_by_id: me.id, stars: task.stars, pence: task.pence, sticker: null }] : d.done.filter((c) => !same(c)) },
      );
      try {
        await api.post(`/api/tasks/${task.id}/done`, { user_id: personId, on: day, done });
      } catch (e) {
        toast(errorText(e), 'danger');
        reload();
      }
    },
    [me.id, setData, reload, toast],
  );

  const isDone = useCallback(
    (taskId: number, personId: number, day: Day) => !!live.data?.done.some((c) => c.task_id === taskId && c.user_id === personId && c.on === day),
    [live.data],
  );

  return { ...live, tick, isDone };
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
