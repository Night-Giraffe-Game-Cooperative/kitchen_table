import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { go } from '../lib/router';
import { addDays, dueLabel, money, shortLabel, today, type Day } from '../lib/days';
import type { HomeworkStatus, Person, Task } from '../lib/types';
import { Avatar, Button, EmptyState, IconButton, Notice } from '../components/ui';
import { canChange, canSetFor, errorText, tint, usePersonOf, useTasks, useToday } from './tasksShared';

export const statusLabels: Record<HomeworkStatus, string> = {
  todo: 'To do',
  started: 'Started',
  done: 'Done',
  handed_in: 'Handed in',
};

const steps: HomeworkStatus[] = ['todo', 'started', 'done', 'handed_in'];

/** Homework still to hand in, soonest due first. */
export function openHomework(tasks: Task[]): Task[] {
  return tasks
    .filter((t) => t.kind === 'homework' && t.status !== 'handed_in')
    .sort((a, b) => (a.due_on ?? '').localeCompare(b.due_on ?? '') || a.id - b.id);
}

/** What a task earns, in a few words: "⭐ 2 · 50p · a sticker". */
export function rewardText(task: Pick<Task, 'stars' | 'pence' | 'sticker'>): string {
  return [task.stars > 0 && `⭐ ${task.stars}`, task.pence > 0 && money(task.pence), task.sticker && 'a sticker'].filter(Boolean).join(' · ');
}

export function HomeworkView({ onEdit, onAdd }: { onEdit: (t: Task) => void; onAdd: (personId?: number) => void }) {
  const { me, people } = useStore();
  const personOf = usePersonOf();
  const now = useToday();
  const live = useTasks(addDays(now, -30), now);
  const homework = (live.data?.tasks ?? []).filter((t) => t.kind === 'homework');

  // A kid sees their own; a grown-up sees the kids they look after, and anyone else's they can see.
  const ids = new Set(homework.flatMap((t) => t.user_ids));
  if (me.role === 'kid') ids.add(me.id);
  else for (const p of people.values()) if (p.active && p.role === 'kid' && p.id !== me.id && canSetFor(me, p)) ids.add(p.id);
  const kids = [...ids]
    .map(personOf)
    .filter((p): p is Person => !!p)
    .sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id) || a.name.localeCompare(b.name));

  return (
    <>
      {live.error && !live.data && <Notice tone="danger">{live.error}</Notice>}
      {live.data && kids.length === 0 && (
        <EmptyState art="📚" title="No homework here">
          <p>Kids keep track of their homework here, from the day it's set to the day it's handed in.</p>
        </EmptyState>
      )}
      <div className="jobs-grid">
        {kids.map((p) => (
          <HomeworkCard
            key={p.id}
            person={p}
            homework={homework.filter((t) => t.user_ids.includes(p.id))}
            now={now}
            live={live}
            onEdit={onEdit}
            onAdd={() => onAdd(p.id)}
          />
        ))}
      </div>
    </>
  );
}

function HomeworkCard({
  person,
  homework,
  now,
  live,
  onEdit,
  onAdd,
}: {
  person: Person;
  homework: Task[];
  now: Day;
  live: ReturnType<typeof useTasks>;
  onEdit: (t: Task) => void;
  onAdd: () => void;
}) {
  const { me } = useStore();
  const open = openHomework(homework);
  const handedIn = homework.filter((t) => t.status === 'handed_in').sort((a, b) => (b.due_on ?? '').localeCompare(a.due_on ?? ''));
  const canAdd = canSetFor(me, person);

  return (
    <section className="jobs-card hw-card sheet" style={tint(person)} aria-label={`${person.name}'s homework`}>
      <header className="jobs-head">
        <Avatar person={person} size="md" />
        <span className="jobs-who">
          <strong>{person.name}</strong>
          <span className="muted">{open.length ? `${open.length} to hand in` : 'All handed in'}</span>
        </span>
        {canAdd && <IconButton icon="plus" label={`Add homework for ${person.name}`} onClick={onAdd} />}
      </header>
      {open.length === 0 && <p className="muted hw-none">Nothing to do. Add homework here when it's set.</p>}
      <ul className="hw-list">
        {open.map((t) => (
          <HomeworkRow key={t.id} task={t} person={person} now={now} live={live} onEdit={onEdit} />
        ))}
      </ul>
      {handedIn.length > 0 && (
        <details className="hw-done">
          <summary>Handed in lately ({handedIn.length})</summary>
          <ul className="hw-list">
            {handedIn.map((t) => (
              <HomeworkRow key={t.id} task={t} person={person} now={now} live={live} onEdit={onEdit} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** One piece of homework: what it is, when it's due, and the steps to move it along. */
export function HomeworkRow({
  task: t,
  person,
  now,
  live,
  onEdit,
  showName,
}: {
  task: Task;
  person: Person;
  now: Day;
  live: ReturnType<typeof useTasks>;
  onEdit?: (t: Task) => void;
  showName?: boolean;
}) {
  const { me, toast } = useStore();
  const personOf = usePersonOf();
  const canMove = canSetFor(me, person);
  const changeable = !!onEdit && canChange(me, t, personOf);
  const status = t.status ?? 'todo';
  const late = status !== 'handed_in' && !!t.due_on && t.due_on < now;
  const soon = status !== 'handed_in' && !!t.due_on && t.due_on <= addDays(now, 1);
  const reward = rewardText(t);

  async function move(next: HomeworkStatus) {
    if (next === status) return;
    live.setData((d) => d && { ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, status: next } : x)) });
    try {
      const on = today();
      await api.post(`/api/tasks/${t.id}/status`, { status: next, on });
      if (next === 'handed_in') toast(reward && t.due_on && on <= t.due_on ? `Handed in on time. That earns ${reward}!` : 'Handed in.', 'success');
    } catch (e) {
      toast(errorText(e), 'danger');
      live.reload();
    }
  }

  const when =
    status === 'handed_in' ? `Was due ${shortLabel(t.due_on!)}` : t.due_on ? dueLabel(t.due_on, now) : '';

  return (
    <li className="hw" data-late={late || undefined} data-soon={soon || undefined} data-status={status}>
      <button type="button" className="hw-main" disabled={!changeable} onClick={() => onEdit?.(t)} aria-label={changeable ? `Change ${t.title}` : undefined}>
        <span className="job-emoji" aria-hidden="true">
          {t.emoji}
        </span>
        <span className="job-text">
          <strong>
            {t.subject && <span className="hw-subject">{t.subject}</span>}
            {t.title}
          </strong>
          {t.notes && <span className="hw-notes">{t.notes}</span>}
          <span className="muted">
            {showName ? `${person.name} · ` : ''}
            <span className="hw-when">{when}</span>
            {reward && status !== 'handed_in' ? ` · on time earns ${reward}` : ''}
          </span>
        </span>
      </button>
      <div className="hw-steps" role="radiogroup" aria-label={`${t.title}: how far along`}>
        {steps.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            className="hw-step"
            aria-checked={status === s}
            disabled={!canMove}
            onClick={() => move(s)}
          >
            {statusLabels[s]}
          </button>
        ))}
      </div>
    </li>
  );
}

/** The homework on someone's Today: anything set by now and not yet handed in. */
export function TodayHomework({ tasks, day, live }: { tasks: Task[]; day: Day; live: ReturnType<typeof useTasks> }) {
  const { me } = useStore();
  const personOf = usePersonOf();
  const due = openHomework(tasks).filter((t) => !t.on_date || t.on_date <= day);
  if (due.length === 0) return null;
  return (
    <section className="cal-section" aria-labelledby="today-homework">
      <div className="cal-section-head">
        <h2 className="section-label" id="today-homework">
          Homework
        </h2>
        <Button size="sm" variant="ghost" onClick={() => go({ name: 'calendar', view: 'homework' })}>
          All homework
        </Button>
      </div>
      <ul className="hw-list">
        {due.map((t) => {
          const person = personOf(t.user_ids[0]);
          return person ? <HomeworkRow key={t.id} task={t} person={person} now={day} live={live} showName={me.id !== person.id} /> : null;
        })}
      </ul>
    </section>
  );
}
