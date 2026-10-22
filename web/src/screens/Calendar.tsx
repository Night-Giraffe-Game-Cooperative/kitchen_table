import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { go, type CalendarView } from '../lib/router';
import {
  addDays,
  addMonths,
  byPart,
  daysBetween,
  daysLabel,
  dayOf,
  dayTitle,
  firstOccurrence,
  longLabel,
  monthGrid,
  monthLabel,
  occurrences,
  onDay,
  partLabels,
  presetDays,
  presetOf,
  relativeLabel,
  repeatLabel,
  shortLabel,
  startOfMonth,
  startOfWeek,
  taskDue,
  timeLabel,
  today,
  weekdayLetters,
  weekdayNames,
  whenLabel,
  type Day,
  type DaysPreset,
  type Occurrence,
} from '../lib/days';
import type { CalendarEvent, CalendarLink, DayPart, Me, Person, Repeat, Task, TaskKind } from '../lib/types';
import { Avatar, Button, Dialog, EmptyState, Field, IconButton, Input, Notice, Segmented, Select, TextArea, Toggle } from '../components/ui';
import { InfoTip } from '../components/tips';
import { Icon } from '../components/icons';
import { Stars, canChange, canSetFor, errorText, taskPeople, tint, useLive, usePersonOf, useTasks, useToday } from './tasksShared';
import { HomeworkView, TodayHomework, rewardText } from './Homework';
import { RewardsView } from './Rewards';
import { calendarOn } from '../lib/features';
import { LinkedCalendarsDialog, linkPlace } from './LinkedCalendars';
import { confirmFirst } from '../components/confirm';

interface CalendarData {
  events: CalendarEvent[];
  links: CalendarLink[];
  can_see: boolean;
  can_edit: boolean;
  can_link: boolean;
}

type Links = Map<number, CalendarLink>;

type EventEdit = { occurrence?: Occurrence; day?: Day };
type TaskEdit = { task?: Task; personId?: number; kind?: TaskKind };

const eventEmoji = ['📅', '🎂', '🎉', '🏫', '⚽', '🏊', '🩰', '🎵', '🩺', '🦷', '✈️', '🚗', '🍽️', '🛒', '👵', '🐶', '🎃', '🎄'];
const taskEmoji = ['✅', '🛏️', '🦷', '📚', '🎒', '🐱', '🐶', '🌱', '🍽️', '🧺', '🧸', '🗑️', '🧹', '🎹', '🚿', '👟', '💧', '⭐'];
const reminderEmoji = ['👟', '🎒', '🏊', '🩰', '⚽', '🎵', '📚', '🍱', '💷', '📝', '🧥', '☂️', '🩺', '🎭', '🥤', '🔑'];
const homeworkEmoji = ['📚', '✏️', '🔢', '📖', '🔬', '🌍', '🎨', '🎵', '💻', '🗣️', '📝', '🧮'];
const subjects = ['Maths', 'English', 'Reading', 'Spelling', 'Phonics', 'Science', 'Topic', 'History', 'Geography', 'French', 'Spanish', 'Music', 'Art', 'Computing', 'RE', 'PE'];

/** The home family sees the calendar, and other families when the home family switches it on for them. */
export function seesCalendar(me: Me): boolean {
  return calendarOn && me.permissions.calendar;
}

/** Whether someone can change an event from here, or only look at it. */
function changeable(e: CalendarEvent, canEdit: boolean, links: Links): boolean {
  if (!canEdit) return false;
  if (e.link_id === null) return true;
  const link = links.get(e.link_id);
  return !!link && link.can_write && !e.recurring;
}

// ---------- The screen ----------

export function CalendarScreen({ view = 'today' }: { view?: CalendarView }) {
  const { me } = useStore();
  const sees = seesCalendar(me);
  const canEdit = sees && me.permissions.edit_calendar;
  const current: CalendarView = !sees && view === 'month' ? 'today' : view;
  const [eventEdit, setEventEdit] = useState<EventEdit | null>(null);
  const [taskEdit, setTaskEdit] = useState<TaskEdit | null>(null);
  const [linking, setLinking] = useState(false);
  const linkData = useLive<{ links: CalendarLink[]; can_link: boolean }>(sees ? '/api/calendar/links' : null, 'calendar_changed');
  const links: Links = useMemo(() => new Map((linkData.data?.links ?? []).map((l) => [l.id, l])), [linkData.data]);

  const tabs: { value: CalendarView; label: string }[] = [
    { value: 'today', label: 'Today' },
    ...(sees ? [{ value: 'month' as const, label: 'Month' }] : []),
    { value: 'tasks', label: 'Tasks' },
    { value: 'homework', label: 'Homework' },
    { value: 'rewards', label: 'Rewards' },
  ];
  const addKind: TaskKind = current === 'homework' ? 'homework' : 'job';

  return (
    <div className="page cal-page">
      <header className="page-head">
        <h1>{sees ? 'Calendar' : 'Tasks'}</h1>
        <div className="row">
          {canEdit && current !== 'tasks' && (
            <Button icon="plus" size="sm" variant="primary" aria-label="Add an event" onClick={() => setEventEdit({})}>
              Event
            </Button>
          )}
          {current !== 'month' && current !== 'rewards' && (
            <Button
              icon="plus"
              size="sm"
              variant={current !== 'today' || !canEdit ? 'primary' : 'secondary'}
              aria-label={addKind === 'homework' ? 'Add homework' : 'Add a task'}
              onClick={() => setTaskEdit({ kind: addKind })}
            >
              {addKind === 'homework' ? 'Homework' : 'Task'}
            </Button>
          )}
        </div>
      </header>

      <div className="cal-tabs">
        <Segmented label="Show" value={current} options={tabs} onChange={(v) => go({ name: 'calendar', view: v })} />
      </div>

      {current === 'today' && (
        <TodayView
          sees={sees}
          links={links}
          onEvent={(o) => setEventEdit({ occurrence: o })}
          onAddTask={() => setTaskEdit({})}
          onEditTask={(task) => setTaskEdit({ task })}
        />
      )}
      {current === 'month' && (
        <MonthView
          canEdit={canEdit}
          links={links}
          canLink={!!linkData.data?.can_link}
          onEvent={(o) => setEventEdit({ occurrence: o })}
          onAdd={(day) => setEventEdit({ day })}
          onLinks={() => setLinking(true)}
        />
      )}
      {current === 'tasks' && <TasksView onEdit={(task) => setTaskEdit({ task })} onAdd={(personId, kind) => setTaskEdit({ personId, kind })} />}
      {current === 'homework' && <HomeworkView onEdit={(task) => setTaskEdit({ task })} onAdd={(personId) => setTaskEdit({ personId, kind: 'homework' })} />}
      {current === 'rewards' && <RewardsView />}

      {eventEdit && <EventDialog edit={eventEdit} canEdit={canEdit} links={links} onClose={() => setEventEdit(null)} />}
      {taskEdit && <TaskDialog edit={taskEdit} onClose={() => setTaskEdit(null)} />}
      {linking && <LinkedCalendarsDialog onClose={() => setLinking(false)} />}
    </div>
  );
}

// ---------- Today ----------

/**
 * Reminders of what the kids need today, to tick once packed, and what they
 * need tomorrow. A kid sees the reminders they set themselves.
 */
function KidsNeed({ tasks, day, live, onEdit }: { tasks: Task[]; day: Day; live: ReturnType<typeof useTasks>; onEdit: (t: Task) => void }) {
  const { me } = useStore();
  const personOf = usePersonOf();
  // A kid sees only their own reminders, so they aren't named.
  const mine = me.role === 'kid';
  const named = (t: Task, who: Person) => (mine ? t.title : `${who.name}: ${t.title}`);
  const reminders = tasks.filter((t) => t.kind === 'reminder');
  const pairs = (on: Day) =>
    reminders
      .filter((t) => taskDue(t, on))
      .flatMap((t) => t.user_ids.map((id) => ({ task: t, kid: personOf(id) })))
      .filter((x): x is { task: Task; kid: Person } => !!x.kid)
      .sort((a, b) => a.kid.name.localeCompare(b.kid.name) || a.task.id - b.task.id);
  const todays = pairs(day);
  const tomorrows = pairs(addDays(day, 1));
  if (todays.length === 0 && tomorrows.length === 0) return null;

  return (
    <section className="cal-section" aria-labelledby="kids-need">
      <h2 className="section-label" id="kids-need">
        {mine ? 'Things to remember' : 'What the kids need'}
      </h2>
      {todays.length > 0 && (
        <ul className="jobs-list need-list">
          {todays.map(({ task: t, kid }) => {
            const packed = live.isDone(t.id, kid.id, day);
            const changeable = canChange(me, t, personOf);
            return (
              <li key={`${t.id}-${kid.id}`} className="need" style={tint(kid)}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={packed}
                  className="job"
                  disabled={!canSetFor(me, kid)}
                  onClick={() => live.tick(t, kid.id, day, !packed)}
                >
                  <span className="job-emoji" aria-hidden="true">
                    {t.emoji}
                  </span>
                  <span className="job-text">
                    <strong>{named(t, kid)}</strong>
                    <span className="muted">{packed ? 'Sorted' : (t.notes ?? 'Today')}</span>
                  </span>
                  <span className="job-box" aria-hidden="true">
                    <Icon name="check" size={26} />
                  </span>
                </button>
                {changeable && <IconButton icon="pen" size="sm" label={mine ? `Change ${t.title}` : `Change ${t.title} for ${kid.name}`} onClick={() => onEdit(t)} />}
              </li>
            );
          })}
        </ul>
      )}
      {tomorrows.length > 0 && (
        <p className="need-tomorrow">
          <strong>Tomorrow:</strong> {tomorrows.map(({ task: t, kid: who }) => `${t.emoji} ${t.title}${mine ? '' : ` for ${who.name}`}`).join(', ')}
        </p>
      )}
    </section>
  );
}

function TodayView({
  sees,
  links,
  onEvent,
  onAddTask,
  onEditTask,
}: {
  sees: boolean;
  links: Links;
  onEvent: (o: Occurrence) => void;
  onAddTask: () => void;
  onEditTask: (t: Task) => void;
}) {
  const { me } = useStore();
  const personOf = usePersonOf();
  const day = useToday();
  const week = startOfWeek(day);
  const ahead = addDays(day, 7);
  const cal = useLive<CalendarData>(sees ? `/api/calendar?from=${day}&to=${ahead}` : null, 'calendar_changed');
  const tasks = useTasks(week, addDays(week, 6));
  const occ = useMemo(() => occurrences(cal.data?.events ?? [], day, ahead), [cal.data, day, ahead]);

  const allTasks = tasks.data?.tasks ?? [];
  const dueToday = allTasks.filter((t) => t.kind === 'job' && taskDue(t, day));
  const people = taskPeople(dueToday, me, personOf);
  const todays = onDay(occ, day);
  const comingUp = Array.from({ length: 7 }, (_, i) => addDays(day, i + 1))
    .map((d) => ({ day: d, items: onDay(occ, d).filter((o) => o.first === d || d === addDays(day, 1)) }))
    .filter((g) => g.items.length > 0);

  const left = people.reduce((n, p) => n + dueToday.filter((t) => t.user_ids.includes(p.id) && !tasks.isDone(t.id, p.id, day)).length, 0);
  const [weekdayName, ...rest] = longLabel(day).split(' ');
  const summary = [
    sees && (todays.length ? `${todays.length} thing${todays.length === 1 ? '' : 's'} on` : 'Nothing on'),
    dueToday.length > 0 && (left ? `${left} task${left === 1 ? '' : 's'} to do` : 'every task done'),
  ].filter(Boolean);

  return (
    <>
      <section className="today-card sheet" aria-label="Today">
        <p className="today-weekday">{weekdayName}</p>
        <p className="today-date">{rest.join(' ')}</p>
        {summary.length > 0 && <p className="today-summary muted">{summary.join(' · ')}</p>}
      </section>

      {tasks.error && !tasks.data && <Notice tone="danger">{tasks.error}</Notice>}

      <section className="cal-section" aria-labelledby="today-tasks">
        <div className="with-info">
          <h2 className="section-label" id="today-tasks">
            Today's tasks
          </h2>
          <InfoTip about="today's tasks">
            Tap a task to tick it off. Everyone ticks off their own, and a guardian can tick off a child's. Anyone can add tasks for themselves;
            {me.role === 'kid' ? " the ones you set yourself don't earn rewards." : " the ones kids set themselves don't earn rewards."}
          </InfoTip>
        </div>
        {tasks.data && people.length === 0 && (
          <div className="cal-empty sheet">
            <p>No tasks today. Set some up, like feeding the cat or reading, and tick them off as they're done.</p>
            <Button icon="plus" size="sm" onClick={onAddTask}>
              Add a task
            </Button>
          </div>
        )}
        <div className="jobs-grid">
          {people.map((p) => (
            <PersonToday key={p.id} person={p} tasks={dueToday.filter((t) => t.user_ids.includes(p.id))} day={day} live={tasks} />
          ))}
        </div>
      </section>

      <TodayHomework tasks={allTasks} day={day} live={tasks} />

      <KidsNeed tasks={allTasks} day={day} live={tasks} onEdit={onEditTask} />

      {sees && (
        <>
          <section className="cal-section" aria-labelledby="today-on">
            <h2 className="section-label" id="today-on">
              What's on today
            </h2>
            {cal.error && !cal.data && <Notice tone="danger">{cal.error}</Notice>}
            {cal.data && todays.length === 0 && <p className="muted">Nothing on the calendar today.</p>}
            <EventList items={todays} day={day} links={links} onEvent={onEvent} />
          </section>

          <section className="cal-section" aria-labelledby="coming-up">
            <h2 className="section-label" id="coming-up">
              Coming up
            </h2>
            {cal.data && comingUp.length === 0 && <p className="muted">Nothing in the week ahead.</p>}
            {comingUp.map((g) => (
              <div key={g.day} className="cal-day-group">
                <h3 className="cal-day-label">{relativeLabel(g.day, day)}</h3>
                <EventList items={g.items} day={g.day} links={links} onEvent={onEvent} />
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}

function PersonToday({ person, tasks, day, live }: { person: Person; tasks: Task[]; day: Day; live: ReturnType<typeof useTasks> }) {
  const { me } = useStore();
  const canTick = canSetFor(me, person);
  const done = tasks.filter((t) => live.isDone(t.id, person.id, day)).length;
  const stars = (live.data?.done ?? []).filter((c) => c.user_id === person.id && c.on <= day).reduce((n, c) => n + c.stars, 0);
  const allDone = done === tasks.length;

  return (
    <section className="jobs-card sheet" style={tint(person)} data-done={allDone || undefined} aria-label={`${person.name}'s tasks`}>
      <header className="jobs-head">
        <Avatar person={person} size="md" />
        <span className="jobs-who">
          <strong>{person.name}</strong>
          <span className="muted">{allDone ? 'All done!' : `${done} of ${tasks.length} done`}</span>
        </span>
        <Stars n={stars} />
      </header>
      <ul className="jobs-list">
        {byPart(tasks).map((t) => {
          const isDone = live.isDone(t.id, person.id, day);
          const sticker = live.data?.done.find((c) => c.task_id === t.id && c.user_id === person.id && c.on === day)?.sticker;
          const reward = rewardText(t);
          const about = [t.part !== 'any' && partLabels[t.part], sticker ? `Got ${sticker}` : reward].filter(Boolean).join(' · ');
          return (
            <li key={t.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={isDone}
                className="job"
                disabled={!canTick}
                title={canTick ? undefined : `Only ${person.name} or their guardian can tick this.`}
                onClick={() => live.tick(t, person.id, day, !isDone)}
              >
                <span className="job-emoji" aria-hidden="true">
                  {t.emoji}
                </span>
                <span className="job-text">
                  <strong>{t.title}</strong>
                  {about && <span className="muted">{about}</span>}
                </span>
                <span className="job-box" aria-hidden="true">
                  <Icon name="check" size={26} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {allDone && (
        <p className="jobs-cheer" role="status">
          🎉 Well done, {person.name}!
        </p>
      )}
    </section>
  );
}

/** A linked event's calendar colour, as a CSS variable. */
function linkTint(e: CalendarEvent, links: Links): CSSProperties | undefined {
  const link = e.link_id !== null ? links.get(e.link_id) : undefined;
  return link ? ({ '--cal': link.color } as CSSProperties) : undefined;
}

function EventList({ items, day, links, onEvent }: { items: Occurrence[]; day: Day; links: Links; onEvent: (o: Occurrence) => void }) {
  const personOf = usePersonOf();
  if (items.length === 0) return null;
  return (
    <ul className="cal-events">
      {items.map((o) => {
        const e = o.event;
        const who = e.who.map(personOf).filter((p): p is Person => !!p);
        return (
          <li key={`${e.id}:${o.first}`}>
            <button
              type="button"
              className="cal-event sheet"
              style={{ ...tint(who[0]), ...linkTint(e, links) }}
              data-who={who.length > 0 || undefined}
              data-linked={e.link_id !== null || undefined}
              onClick={() => onEvent(o)}
            >
              <span className="cal-event-emoji" aria-hidden="true">
                {e.emoji}
              </span>
              <span className="cal-event-text">
                <strong>{e.title}</strong>
                <span className="muted">
                  {timeLabel(o, day)}
                  {e.location ? ` · ${e.location}` : ''}
                </span>
              </span>
              {who.length > 0 && (
                <span className="cal-event-who" aria-label={`For ${who.map((p) => p.name).join(', ')}`}>
                  {who.slice(0, 4).map((p) => (
                    <Avatar key={p.id} person={p} size="xs" />
                  ))}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Month ----------

function MonthView({
  canEdit,
  links,
  canLink,
  onEvent,
  onAdd,
  onLinks,
}: {
  canEdit: boolean;
  links: Links;
  canLink: boolean;
  onEvent: (o: Occurrence) => void;
  onAdd: (day: Day) => void;
  onLinks: () => void;
}) {
  const now = useToday();
  const [month, setMonth] = useState(() => startOfMonth(now));
  const [picked, setPicked] = useState(now);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const from = weeks[0][0];
  const to = weeks[weeks.length - 1][6];
  const cal = useLive<CalendarData>(`/api/calendar?from=${from}&to=${to}`, 'calendar_changed');
  const occ = useMemo(() => occurrences(cal.data?.events ?? [], from, to), [cal.data, from, to]);
  const thisMonth = startOfMonth(now);
  const pickedItems = onDay(occ, picked);

  function move(n: number) {
    const next = addMonths(month, n);
    setMonth(next);
    setPicked(next === thisMonth ? now : next);
  }

  return (
    <>
      <section className="month sheet" aria-label={monthLabel(month)}>
        <header className="month-head">
          <IconButton icon="back" label="Previous month" onClick={() => move(-1)} />
          <h2 aria-live="polite">{monthLabel(month)}</h2>
          <IconButton icon="forward" label="Next month" onClick={() => move(1)} />
          {month !== thisMonth && (
            <Button
              size="sm"
              onClick={() => {
                setMonth(thisMonth);
                setPicked(now);
              }}
            >
              Today
            </Button>
          )}
        </header>
        <div className="month-grid">
          {weekdayLetters.map((l, i) => (
            <span key={i} className="month-weekday" title={weekdayNames[i]} aria-hidden="true">
              {l}
            </span>
          ))}
          {weeks.flat().map((d) => {
            const items = onDay(occ, d);
            return (
              <button
                key={d}
                type="button"
                className="month-day"
                data-other={d.slice(0, 7) !== month.slice(0, 7) || undefined}
                data-today={d === now || undefined}
                aria-pressed={d === picked}
                onClick={() => setPicked(d)}
                onDoubleClick={() => canEdit && onAdd(d)}
              >
                <span className="sr-only">
                  {longLabel(d)}
                  {items.length ? `, ${items.length} thing${items.length === 1 ? '' : 's'} on` : ''}
                </span>
                <span className="month-num" aria-hidden="true">
                  {Number(d.slice(8))}
                </span>
                <span className="month-items" aria-hidden="true">
                  {items.slice(0, 3).map((o) => (
                    <span
                      key={`${o.event.id}:${o.first}`}
                      className="month-item"
                      data-all-day={o.event.all_day || undefined}
                      data-linked={o.event.link_id !== null || undefined}
                      style={linkTint(o.event, links)}
                    >
                      <span>{o.event.emoji}</span>
                      <span className="month-item-title">{o.event.title}</span>
                    </span>
                  ))}
                  {items.length > 3 && <span className="month-more">+{items.length - 3}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {cal.error && !cal.data && <Notice tone="danger">{cal.error}</Notice>}

      <section className="cal-section" aria-labelledby="picked-day">
        <div className="cal-section-head">
          <h2 className="cal-day-title" id="picked-day">
            {dayTitle(picked, now)}
          </h2>
          {canEdit && (
            <Button icon="plus" size="sm" onClick={() => onAdd(picked)}>
              Add
            </Button>
          )}
        </div>
        {pickedItems.length === 0 && <p className="muted">Nothing on.</p>}
        <EventList items={pickedItems} day={picked} links={links} onEvent={onEvent} />
      </section>

      {(links.size > 0 || canLink) && (
        <div className="links-line">
          <Icon name="calendar" size={22} className="links-mark" />
          {links.size > 0 ? (
            <ul className="links-chips" aria-label="Linked calendars">
              {[...links.values()].map((l) => (
                <li key={l.id} className="links-chip" data-error={l.last_error ? true : undefined}>
                  <span className="link-dot" style={{ background: l.color }} aria-hidden="true" />
                  {l.name}
                  {l.last_error && <span className="sr-only"> (needs looking at)</span>}
                </li>
              ))}
            </ul>
          ) : (
            <span className="muted">Link iCloud or another calendar you use, so everything's in one place and on your phones too.</span>
          )}
          <Button size="sm" onClick={onLinks}>
            {links.size > 0 ? 'Linked calendars' : 'Link a calendar'}
          </Button>
        </div>
      )}
    </>
  );
}

// ---------- Tasks ----------

function TasksView({ onEdit, onAdd }: { onEdit: (t: Task) => void; onAdd: (personId?: number, kind?: TaskKind) => void }) {
  const { me } = useStore();
  const personOf = usePersonOf();
  const now = useToday();
  const [week, setWeek] = useState(() => startOfWeek(now));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const tasks = useTasks(week, days[6]);
  const list = tasks.data?.tasks ?? [];
  // A one-off shows in the week it's on. Reminders are listed after the charts.
  const shown = list.filter((t) => t.kind === 'job' && (!t.on_date || (t.on_date >= week && t.on_date <= days[6])));
  const reminders = list.filter((t) => t.kind === 'reminder' && (!t.on_date || t.on_date >= now));
  const people = taskPeople(shown, me, personOf);
  const thisWeek = startOfWeek(now);
  const weekName = week === thisWeek ? 'This week' : week === addDays(thisWeek, -7) ? 'Last week' : week === addDays(thisWeek, 7) ? 'Next week' : `Week of ${shortLabel(week)}`;

  return (
    <>
      <header className="week-head">
        <IconButton icon="back" label="Previous week" onClick={() => setWeek(addDays(week, -7))} />
        <span className="week-name">
          <strong aria-live="polite">{weekName}</strong>
          <span className="muted">
            {shortLabel(week)} to {shortLabel(days[6])}
          </span>
        </span>
        <IconButton icon="forward" label="Next week" onClick={() => setWeek(addDays(week, 7))} />
        {week !== thisWeek && (
          <Button size="sm" onClick={() => setWeek(thisWeek)}>
            This week
          </Button>
        )}
      </header>

      {tasks.error && !tasks.data && <Notice tone="danger">{tasks.error}</Notice>}

      {tasks.data && people.length === 0 && (
        <EmptyState art="⭐" title="No tasks yet">
          <p>Set up little tasks like making the bed, reading or feeding the cat. Everyone ticks theirs off and collects stars.</p>
          <Button icon="plus" variant="primary" onClick={() => onAdd()}>
            Add a task
          </Button>
        </EmptyState>
      )}

      {people.map((p) => (
        <WeekChart
          key={p.id}
          person={p}
          tasks={shown.filter((t) => t.user_ids.includes(p.id))}
          days={days}
          now={now}
          live={tasks}
          onEdit={onEdit}
          onAdd={() => onAdd(p.id)}
        />
      ))}

      {tasks.data && <ReminderList reminders={reminders} onEdit={onEdit} onAdd={() => onAdd(undefined, 'reminder')} />}
    </>
  );
}

/** Reminders of what the kids need, and when: the ones grown-ups set and the ones kids set themselves. A kid sees only their own. */
function ReminderList({ reminders, onEdit, onAdd }: { reminders: Task[]; onEdit: (t: Task) => void; onAdd: () => void }) {
  const { me } = useStore();
  const personOf = usePersonOf();
  const kid = me.role === 'kid';
  return (
    <section className="cal-section" aria-labelledby="reminders">
      <div className="cal-section-head">
        <span className="with-info">
          <h2 className="section-label" id="reminders">
            {kid ? 'My reminders' : 'Reminders for guardians'}
          </h2>
          <InfoTip about="reminders">
            {kid
              ? 'Your reminders show on your Today when they come round, and the day before under Tomorrow. Your guardians see them too.'
              : "Reminders show on Today for the guardians at home, and the day before under Tomorrow. Kids see the reminders they set themselves, but not the ones you set."}
          </InfoTip>
        </span>
        <Button size="sm" icon="plus" onClick={onAdd}>
          Reminder
        </Button>
      </div>
      {reminders.length === 0 && (
        <p className="muted">
          {kid
            ? 'Things you need on certain days, like your swimming bag on Thursdays. They show on your Today and the day before.'
            : 'Things the kids need on certain days, like PE kit on Tuesdays. They show on your Today and the day before.'}
        </p>
      )}
      <ul className="cal-events">
        {reminders.map((t) => {
          const changeable = canChange(me, t, personOf);
          const kids = t.user_ids.map((id) => personOf(id)?.name).filter(Boolean);
          const setter = t.created_by_id === null ? undefined : personOf(t.created_by_id);
          const byKid = !kid && setter?.role === 'kid' ? ` · set by ${setter.name}` : '';
          return (
            <li key={t.id}>
              <button type="button" className="cal-event sheet" disabled={!changeable} onClick={() => onEdit(t)}>
                {changeable && <span className="sr-only">Change </span>}
                <span className="cal-event-emoji" aria-hidden="true">
                  {t.emoji}
                </span>
                <span className="cal-event-text">
                  <strong>{t.title}</strong>
                  <span className="muted">
                    {kid ? daysLabel(t) : `${kids.join(' and ')} · ${daysLabel(t)}${byKid}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function WeekChart({
  person,
  tasks,
  days,
  now,
  live,
  onEdit,
  onAdd,
}: {
  person: Person;
  tasks: Task[];
  days: Day[];
  now: Day;
  live: ReturnType<typeof useTasks>;
  onEdit: (t: Task) => void;
  onAdd: () => void;
}) {
  const { me } = useStore();
  const personOf = usePersonOf();
  const canTick = canSetFor(me, person);
  const stars = (live.data?.done ?? []).filter((c) => c.user_id === person.id).reduce((n, c) => n + c.stars, 0);

  return (
    <section className="chart sheet" style={tint(person)} aria-label={`${person.name}'s week`}>
      <header className="jobs-head">
        <Avatar person={person} size="md" />
        <span className="jobs-who">
          <strong>{person.name}</strong>
          <span className="muted">
            {tasks.length} task{tasks.length === 1 ? '' : 's'}
          </span>
        </span>
        <Stars n={stars} />
        {canTick && <IconButton icon="plus" label={`Add a task for ${person.name}`} onClick={onAdd} />}
      </header>
      <table className="chart-table">
        <thead>
          <tr>
            <th scope="col" className="chart-task-head">
              <span className="sr-only">Task</span>
            </th>
            {days.map((d, i) => (
              <th key={d} scope="col" data-today={d === now || undefined}>
                <abbr title={weekdayNames[i]}>{weekdayLetters[i]}</abbr>
                <small>{Number(d.slice(8))}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {byPart(tasks).map((t) => {
            const changeable = canChange(me, t, personOf);
            return (
              <tr key={t.id}>
                <th scope="row" className="chart-task">
                  <button type="button" className="chart-task-btn" disabled={!changeable} onClick={() => onEdit(t)}>
                    {changeable && <span className="sr-only">Change </span>}
                    <span className="chart-emoji" aria-hidden="true">
                      {t.emoji}
                    </span>
                    <span className="chart-task-text">
                      <strong>{t.title}</strong>
                      <span className="muted">
                        {daysLabel(t)}
                        {t.part !== 'any' ? ` · ${partLabels[t.part]}` : ''}
                      </span>
                    </span>
                  </button>
                </th>
                {days.map((d, i) => {
                  if (!taskDue(t, d)) {
                    return (
                      <td key={d} data-today={d === now || undefined}>
                        <span className="chart-off" aria-label={`Not on ${weekdayNames[i]}`} />
                      </td>
                    );
                  }
                  const done = live.isDone(t.id, person.id, d);
                  const sticker = done && live.data?.done.find((c) => c.task_id === t.id && c.user_id === person.id && c.on === d)?.sticker;
                  const future = d > now;
                  return (
                    <td key={d} data-today={d === now || undefined}>
                      <button
                        type="button"
                        role="checkbox"
                        className="chart-cell"
                        aria-checked={done}
                        aria-label={`${t.title}, ${weekdayNames[i]}`}
                        disabled={!canTick || (future && !done)}
                        onClick={() => live.tick(t, person.id, d, !done)}
                      >
                        {done ? sticker || '⭐' : ''}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---------- Adding and changing events ----------

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function at(day: Day, time: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0);
}

interface EventForm {
  title: string;
  emoji: string;
  allDay: boolean;
  startDay: Day;
  startTime: string;
  endDay: Day;
  endTime: string;
  repeat: Repeat;
  until: Day | '';
  who: number[];
  location: string;
  notes: string;
}

function formFor(edit: EventEdit): EventForm {
  const e = edit.occurrence?.event;
  if (!e) {
    const day = edit.day ?? today();
    // Today, the next whole hour; another day, nine o'clock.
    const start = day === today() ? new Date(Math.min(at(day, '23:00').getTime(), new Date().setMinutes(60, 0, 0))) : at(day, '09:00');
    const end = new Date(start.getTime() + 3_600_000);
    return {
      title: '',
      emoji: '📅',
      allDay: false,
      startDay: day,
      startTime: hhmm(start),
      endDay: dayOf(end),
      endTime: hhmm(end),
      repeat: 'none',
      until: '',
      who: [],
      location: '',
      notes: '',
    };
  }
  const base = firstOccurrence(e);
  const start = base?.start ?? new Date();
  const end = base?.end ?? start;
  return {
    title: e.title,
    emoji: e.emoji,
    allDay: e.all_day,
    startDay: e.all_day ? (e.start_date ?? today()) : dayOf(start),
    startTime: e.all_day ? '09:00' : hhmm(start),
    endDay: e.all_day ? (e.end_date ?? e.start_date ?? today()) : dayOf(end),
    endTime: e.all_day ? '10:00' : hhmm(end),
    repeat: e.repeat,
    until: e.repeat_until ?? '',
    who: e.who,
    location: e.location ?? '',
    notes: e.notes ?? '',
  };
}

function EventDialog({ edit, canEdit, links, onClose }: { edit: EventEdit; canEdit: boolean; links: Links; onClose: () => void }) {
  const o = edit.occurrence;
  if (o && !changeable(o.event, canEdit, links)) return <EventDetails occurrence={o} links={links} canEdit={canEdit} onClose={onClose} />;
  return <EventEditor edit={edit} links={links} onClose={onClose} />;
}

function EventDetails({ occurrence: o, links, canEdit, onClose }: { occurrence: Occurrence; links: Links; canEdit: boolean; onClose: () => void }) {
  const personOf = usePersonOf();
  const e = o.event;
  const who = e.who.map(personOf).filter((p): p is Person => !!p);
  const link = e.link_id !== null ? links.get(e.link_id) : undefined;
  // Why a grown-up who can change the calendar can't change this.
  const why =
    canEdit && link
      ? !link.writable
        ? `This comes from ${link.name}, which is only shown here. Change it in ${linkPlace(link)}.`
        : e.recurring
          ? `This repeats in ${link.name}, so change it in ${linkPlace(link)}.`
          : !link.can_write
            ? `Only whoever linked ${link.name} can change its events.`
            : null
      : null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <>
          <span aria-hidden="true">{e.emoji}</span> {e.title}
        </>
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {why && <Notice tone="info">{why}</Notice>}
      <dl className="event-facts">
        <dt>When</dt>
        <dd>{whenLabel(o)}</dd>
        {(e.repeat !== 'none' || e.recurring) && (
          <>
            <dt>Repeats</dt>
            <dd>{e.recurring ? `Yes, in ${link?.name ?? 'its own calendar'}` : repeatLabel(e.repeat, e.all_day ? e.start_date! : o.first)}</dd>
          </>
        )}
        {link && (
          <>
            <dt>Calendar</dt>
            <dd className="row">
              <span className="link-dot" style={{ background: link.color }} aria-hidden="true" />
              {link.name}
              {link.share === 'me' ? ' (only you see it)' : ''}
            </dd>
          </>
        )}
        {e.location && (
          <>
            <dt>Where</dt>
            <dd>{e.location}</dd>
          </>
        )}
        {who.length > 0 && (
          <>
            <dt>Who</dt>
            <dd className="row row-wrap">
              {who.map((p) => (
                <span key={p.id} className="row">
                  <Avatar person={p} size="xs" /> {p.name}
                </span>
              ))}
            </dd>
          </>
        )}
        {e.notes && (
          <>
            <dt>Notes</dt>
            <dd className="event-notes">{e.notes}</dd>
          </>
        )}
      </dl>
    </Dialog>
  );
}

function EventEditor({ edit, links, onClose }: { edit: EventEdit; links: Links; onClose: () => void }) {
  const { me, people, bubbles, toast } = useStore();
  const existing = edit.occurrence?.event;
  const [form, setForm] = useState(() => formFor(edit));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  // Calendars a new event can go in: the one kept here, and linked ones
  // that can be added to. It starts in the family's usual one.
  const writable = [...links.values()].filter((l) => l.writable && l.can_write);
  const [calendar, setCalendar] = useState<number | 'here'>(() => writable.find((l) => l.default)?.id ?? 'here');
  const existingLink = existing?.link_id != null ? links.get(existing.link_id) : undefined;
  const target = existing ? existingLink : calendar === 'here' ? undefined : links.get(calendar);

  // Everyone who sees the calendar can be on an event: the home family, and
  // families it's switched on for.
  const home = [...people.values()]
    .filter((p) => {
      const bubble = p.bubble_id === null ? undefined : bubbles.get(p.bubble_id);
      return p.active && !!bubble && (bubble.home || bubble.features?.calendar === true);
    })
    .sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id) || a.name.localeCompare(b.name));
  const repeats = existing && existing.repeat !== 'none';

  // Moving the start keeps the length, as Google Calendar does.
  function moveStart(day: Day, time: string) {
    setForm((f) => {
      if (f.allDay) return { ...f, startDay: day, endDay: addDays(f.endDay, daysBetween(f.startDay, day)) };
      const length = Math.max(0, at(f.endDay, f.endTime).getTime() - at(f.startDay, f.startTime).getTime());
      const end = new Date(at(day, time).getTime() + length);
      return { ...f, startDay: day, startTime: time, endDay: dayOf(end), endTime: hhmm(end) };
    });
  }

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const f = form;
    if (!f.title.trim()) return setError('Give it a name.');
    const start = f.allDay ? at(f.startDay, '00:00') : at(f.startDay, f.startTime);
    const end = f.allDay ? at(f.endDay, '00:00') : at(f.endDay, f.endTime);
    if (end < start) return setError(f.allDay ? 'The last day comes before the first.' : 'It needs to end after it starts.');
    if (f.repeat !== 'none' && f.until && f.until < f.startDay) return setError('It needs to repeat until after it starts.');

    const body = {
      title: f.title.trim(),
      emoji: f.emoji,
      location: f.location.trim(),
      notes: f.notes.trim(),
      who: f.who,
      all_day: f.allDay,
      ...(existingLink ? {} : { repeat: f.repeat, repeat_until: f.repeat === 'none' ? '' : f.until }),
      ...(existing ? {} : { calendar: calendar }),
      ...(f.allDay
        ? { start_date: f.startDay, end_date: f.endDay, starts_at: null, ends_at: null }
        : {
            starts_at: start.toISOString(),
            ends_at: end.toISOString(),
            start_date: null,
            end_date: null,
            time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London',
          }),
    };

    setBusy(true);
    try {
      if (existing) await api.patch(`/api/calendar/events/${existing.id}`, body);
      else await api.post('/api/calendar/events', body);
      toast(existing ? 'Saved.' : `Added ${f.title.trim()}${target ? ` to ${target.name}` : ''}.`, 'success');
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    const question = repeats ? `Delete ${existing.title} every time it happens?` : `Delete ${existing.title}?`;
    if (!(await confirmFirst(question, 'Delete', existingLink ? `It's deleted from ${existingLink.name} too.` : undefined))) return;
    setBusy(true);
    try {
      await api.del(`/api/calendar/events/${existing.id}`);
      toast(`Deleted ${existing.title}.`, 'success');
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={existing ? 'Change event' : 'Add an event'}
      footer={
        <>
          {existing && (
            <Button variant="danger" icon="trash" onClick={remove} disabled={busy} className="foot-start">
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="event-form" busy={busy}>
            {existing ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form id="event-form" className="stack" onSubmit={save}>
        {existingLink && (
          <p className="event-in muted">
            <span className="link-dot" style={{ background: existingLink.color }} aria-hidden="true" /> In {existingLink.name}. Changes are saved there too.
          </p>
        )}
        {!existing && writable.length > 0 && (
          <Field label="Calendar">
            {(p) => (
              <Select {...p} value={String(calendar)} onChange={(e) => setCalendar(e.target.value === 'here' ? 'here' : Number(e.target.value))}>
                <option value="here">Family calendar (kept here)</option>
                {writable.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({linkPlace(l)}
                    {l.share === 'me' ? ', just you' : ''})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {repeats && edit.occurrence && edit.occurrence.first !== form.startDay && (
          <Notice tone="info">This repeats, so changes are for every time. It started on {shortLabel(form.startDay)}.</Notice>
        )}
        <Field label="What's happening">
          {(p) => <Input {...p} value={form.title} maxLength={120} onChange={(e) => set('title', e.target.value)} placeholder="Swimming lesson" autoFocus={!existing} />}
        </Field>
        <fieldset className="fieldset">
          <legend>Picture</legend>
          <div className="emoji-pick">
            {(eventEmoji.includes(form.emoji) ? eventEmoji : [form.emoji, ...eventEmoji]).map((e) => (
              <button key={e} type="button" className="emoji-option" aria-pressed={form.emoji === e} onClick={() => set('emoji', e)}>
                {e}
              </button>
            ))}
          </div>
        </fieldset>

        <Toggle label="All day" checked={form.allDay} onChange={(v) => set('allDay', v)} />

        <div className="when-grid">
          <Field label={form.allDay ? 'First day' : 'Starts'}>
            {(p) => <Input {...p} type="date" value={form.startDay} required onChange={(e) => e.target.value && moveStart(e.target.value, form.startTime)} />}
          </Field>
          {!form.allDay && (
            <Field label="At">
              {(p) => <Input {...p} type="time" value={form.startTime} required onChange={(e) => e.target.value && moveStart(form.startDay, e.target.value)} />}
            </Field>
          )}
          <Field label={form.allDay ? 'Last day' : 'Ends'}>
            {(p) => <Input {...p} type="date" value={form.endDay} min={form.startDay} required onChange={(e) => e.target.value && set('endDay', e.target.value)} />}
          </Field>
          {!form.allDay && (
            <Field label="At">
              {(p) => <Input {...p} type="time" value={form.endTime} required onChange={(e) => e.target.value && set('endTime', e.target.value)} />}
            </Field>
          )}
        </div>

        {!existingLink && (
          <div className="when-grid">
            <Field label="Repeats">
              {(p) => (
                <Select {...p} value={form.repeat} onChange={(e) => set('repeat', e.target.value as Repeat)}>
                  {(['none', 'daily', 'weekly', 'monthly', 'yearly'] as Repeat[]).map((r) => (
                    <option key={r} value={r}>
                      {repeatLabel(r, form.startDay)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {form.repeat !== 'none' && target && (
              <p className="field-hint when-note">Once it's in {target.name}, change repeating events there.</p>
            )}
            {form.repeat !== 'none' && (
              <Field label="Until" hint="Leave empty to keep going.">
                {(p) => <Input {...p} type="date" value={form.until} min={form.startDay} onChange={(e) => set('until', e.target.value)} />}
              </Field>
            )}
          </div>
        )}

        {home.length > 0 && (
          <fieldset className="fieldset">
            <legend>Who's it for</legend>
            <ul className="people-pick">
              {home.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="person-chip"
                    aria-pressed={form.who.includes(p.id)}
                    onClick={() => set('who', form.who.includes(p.id) ? form.who.filter((id) => id !== p.id) : [...form.who, p.id])}
                  >
                    <Avatar person={p} size="sm" />
                    <span>{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        <Field label="Where">{(p) => <Input {...p} value={form.location} maxLength={200} onChange={(e) => set('location', e.target.value)} placeholder="Leisure centre" />}</Field>
        <Field label="Notes">{(p) => <TextArea {...p} value={form.notes} rows={3} maxLength={2000} onChange={(e) => set('notes', e.target.value)} />}</Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Dialog>
  );
}

// ---------- Adding and changing tasks ----------

const kindText: Record<TaskKind, { add: string; change: string; title: string; placeholder: string; who: string; emoji: string[] }> = {
  job: { add: 'Add a task', change: 'Change task', title: 'The task', placeholder: 'Feed the cat', who: 'Who does it', emoji: taskEmoji },
  homework: { add: 'Add homework', change: 'Change homework', title: 'What to do', placeholder: 'Times tables, page 12', who: 'Whose homework', emoji: homeworkEmoji },
  reminder: { add: 'Add a reminder', change: 'Change reminder', title: 'What they need', placeholder: 'PE kit', who: "Who it's for", emoji: reminderEmoji },
};

function TaskDialog({ edit, onClose }: { edit: TaskEdit; onClose: () => void }) {
  const { me, people, toast } = useStore();
  const personOf = usePersonOf();
  const existing = edit.task;
  const [kind, setKind] = useState<TaskKind>(existing?.kind ?? edit.kind ?? 'job');
  const text = me.role === 'kid' && kind === 'reminder' ? { ...kindText.reminder, title: 'What you need', placeholder: 'Swimming bag' } : kindText[kind];
  const [title, setTitle] = useState(existing?.title ?? '');
  const [emoji, setEmoji] = useState(existing?.emoji ?? text.emoji[0]);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  // Jobs start with you (or the person picked); homework and reminders are about kids.
  const [who, setWho] = useState<number[]>(
    existing?.user_ids ?? (edit.personId ? [edit.personId] : kind === 'job' || me.role === 'kid' ? [me.id] : []),
  );
  const [preset, setPreset] = useState<DaysPreset>(existing && existing.kind !== 'homework' ? presetOf(existing) : 'every');
  // Picking some days starts from none chosen.
  const [days, setDays] = useState<number[]>(existing && presetOf(existing) === 'some' ? existing.days : []);
  // A one-off's day, or the day homework was set.
  const [onDate, setOnDate] = useState<Day>(existing?.on_date ?? today());
  const [dueOn, setDueOn] = useState<Day>(existing?.due_on ?? addDays(today(), 7));
  const [subject, setSubject] = useState(existing?.subject ?? '');
  const [part, setPart] = useState<DayPart>(existing?.part ?? 'any');
  const [stars, setStars] = useState(existing?.stars ?? 1);
  const [pounds, setPounds] = useState(existing?.pence ? (existing.pence / 100).toFixed(2) : '');
  const [sticker, setSticker] = useState(existing?.sticker ?? false);
  // Rewards come from grown-ups, so the tasks a kid sets themselves earn none.
  const setter = !existing ? me : existing.created_by_id === null ? undefined : personOf(existing.created_by_id);
  const rewardless = me.role === 'kid' || setter?.role === 'kid';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Jobs: you, then the kids you look after (an admin, anyone), then everyone else you can set for.
  // Homework and reminders: kids only (or just you, if you're a kid).
  const forKids = kind !== 'job';
  const choices = [me, ...[...people.values()].filter((p) => p.id !== me.id && p.active)]
    .filter((p) => (canSetFor(me, p) && (!forKids || p.role === 'kid')) || who.includes(p.id))
    .sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id) || Number(b.role === 'kid') - Number(a.role === 'kid') || a.name.localeCompare(b.name));

  function changeKind(k: TaskKind) {
    setKind(k);
    setEmoji(kindText[k].emoji[0]);
    if (k !== 'job') {
      const kids = who.filter((id) => personOf(id)?.role === 'kid');
      setWho(k === 'homework' ? kids.slice(0, 1) : kids);
    }
  }

  function pick(id: number) {
    if (kind === 'homework') setWho([id]);
    else setWho(who.includes(id) ? who.filter((x) => x !== id) : [...who, id]);
  }

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!title.trim()) return setError(kind === 'reminder' ? 'Say what they need.' : 'Give it a name.');
    if (who.length === 0) return setError(kind === 'job' ? 'Choose who does it.' : "Choose who it's for.");
    if (kind !== 'homework' && preset === 'some' && days.length === 0) return setError('Choose at least one day.');
    if (kind === 'homework' && dueOn < onDate) return setError("It can't be due before it's set.");
    const pence = me.role === 'kid' ? 0 : Math.round(Number(pounds || 0) * 100);
    if (!Number.isFinite(pence) || pence < 0) return setError('Pocket money needs to be an amount, like 0.50.');
    const body = {
      kind,
      title: title.trim(),
      emoji,
      notes: notes.trim(),
      user_ids: who,
      ...(kind === 'homework'
        ? { subject: subject.trim(), on_date: onDate, due_on: dueOn }
        : {
            part: kind === 'job' ? part : 'any',
            days: preset === 'once' ? [] : preset === 'some' ? days : presetDays[preset],
            on_date: preset === 'once' ? onDate : '',
          }),
      ...(kind === 'reminder' || rewardless ? {} : { stars, pence, sticker }),
    };
    setBusy(true);
    try {
      if (existing) await api.patch(`/api/tasks/${existing.id}`, body);
      else await api.post('/api/tasks', body);
      toast(existing ? 'Saved.' : `Added ${title.trim()}.`, 'success');
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const what = kind === 'job' ? 'Its stars go too.' : kind === 'homework' ? 'Any reward it earned goes too.' : undefined;
    if (!existing || !(await confirmFirst(`Delete ${existing.title}?`, 'Delete', what))) return;
    setBusy(true);
    try {
      await api.del(`/api/tasks/${existing.id}`);
      toast(`Deleted ${existing.title}.`, 'success');
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  const presets: { value: DaysPreset; label: string }[] = [
    { value: 'every', label: 'Every day' },
    { value: 'weekdays', label: 'Weekdays' },
    { value: 'weekends', label: 'Weekends' },
    { value: 'some', label: 'Some days' },
    { value: 'once', label: 'Just once' },
  ];
  const kinds: { value: TaskKind; label: string }[] = [
    { value: 'job', label: 'Task' },
    { value: 'homework', label: 'Homework' },
    { value: 'reminder', label: 'Reminder' },
  ];
  const starOptions = [0, 1, 2, 3, ...(stars > 3 ? [stars] : [])];

  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? text.change : text.add}
      footer={
        <>
          {existing && (
            <Button variant="danger" icon="trash" onClick={remove} disabled={busy} className="foot-start">
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="task-form" busy={busy}>
            {existing ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form id="task-form" className="stack" onSubmit={save}>
        {!existing && <Segmented label="What kind" value={kind} options={kinds} onChange={changeKind} />}
        {kind === 'reminder' && (
          <p className="muted">
            {me.role === 'kid'
              ? 'A reminder of something you need, like your swimming bag on Thursdays. It shows on your Today and the day before, and your guardians see it too.'
              : 'A reminder for guardians of something a kid needs, like PE kit on Tuesdays. It shows on your Today and the day before.'}
          </p>
        )}

        {kind === 'homework' && (
          <Field label="Subject">
            {(p) => (
              <>
                <Input {...p} value={subject} maxLength={40} list="subjects" onChange={(e) => setSubject(e.target.value)} placeholder="Maths" />
                <datalist id="subjects">
                  {subjects.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        )}
        <Field label={text.title}>
          {(p) => <Input {...p} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={text.placeholder} autoFocus={!existing} />}
        </Field>
        <fieldset className="fieldset">
          <legend>Picture</legend>
          <div className="emoji-pick">
            {(text.emoji.includes(emoji) ? text.emoji : [emoji, ...text.emoji]).map((e) => (
              <button key={e} type="button" className="emoji-option" aria-pressed={emoji === e} onClick={() => setEmoji(e)}>
                {e}
              </button>
            ))}
          </div>
        </fieldset>

        {(choices.length > 1 || (forKids && who.length === 0)) && (
          <fieldset className="fieldset">
            <legend>{text.who}</legend>
            {choices.length === 0 && <p className="muted">There are no kids here you're a guardian to.</p>}
            <ul className="people-pick">
              {choices.map((p) => (
                <li key={p.id}>
                  <button type="button" className="person-chip" aria-pressed={who.includes(p.id)} disabled={!canSetFor(me, personOf(p.id))} onClick={() => pick(p.id)}>
                    <Avatar person={p} size="sm" />
                    <span>{p.id === me.id ? `${p.name} (you)` : p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        {kind === 'homework' ? (
          <div className="row row-wrap">
            <Field label="Set on">{(p) => <Input {...p} type="date" value={onDate} required onChange={(e) => e.target.value && setOnDate(e.target.value)} />}</Field>
            <Field label="Due">{(p) => <Input {...p} type="date" value={dueOn} min={onDate} required onChange={(e) => e.target.value && setDueOn(e.target.value)} />}</Field>
          </div>
        ) : (
          <fieldset className="fieldset">
            <legend>When</legend>
            <div className="stack-sm">
              <Segmented label="Which days" value={preset} options={presets} onChange={setPreset} />
              {preset === 'some' && (
                <div className="day-pick" role="group" aria-label="Days">
                  {weekdayLetters.map((l, i) => (
                    <button
                      key={i}
                      type="button"
                      className="day-option"
                      aria-pressed={days.includes(i + 1)}
                      aria-label={weekdayNames[i]}
                      data-tip={weekdayNames[i]}
                      onClick={() => setDays(days.includes(i + 1) ? days.filter((d) => d !== i + 1) : [...days, i + 1].sort())}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
              {preset === 'once' && (
                <Field label="On">{(p) => <Input {...p} type="date" value={onDate} required onChange={(e) => e.target.value && setOnDate(e.target.value)} />}</Field>
              )}
            </div>
          </fieldset>
        )}

        {kind === 'job' && (
          <fieldset className="fieldset">
            <legend>Time of day</legend>
            <Segmented
              label="Time of day"
              value={part}
              onChange={setPart}
              options={(['any', 'morning', 'afternoon', 'evening'] as DayPart[]).map((v) => ({ value: v, label: partLabels[v] }))}
            />
          </fieldset>
        )}

        {kind !== 'job' && (
          <Field label={kind === 'reminder' ? 'Anything to remember' : 'Notes'}>
            {(p) => (
              <TextArea
                {...p}
                rows={2}
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={kind === 'reminder' ? 'Trainers, shorts and a T-shirt' : 'In the blue book'}
              />
            )}
          </Field>
        )}

        {kind !== 'reminder' && rewardless && (
          <p className="muted">
            {me.role === 'kid'
              ? "Tasks you set yourself are just for you, so they don't earn stars, stickers or pocket money. Those come with the tasks your guardians set."
              : `${setter?.name ?? 'A child'} set this one, so it doesn't earn rewards. Set a task of your own for them to give a reward.`}
          </p>
        )}
        {kind !== 'reminder' && !rewardless && (
          <fieldset className="fieldset">
            <legend>{kind === 'homework' ? 'Handed in on time, it earns' : "Each time it's done, it earns"}</legend>
            <div className="stack-sm">
              <Segmented
                label="Stars"
                value={String(stars)}
                onChange={(v) => setStars(Number(v))}
                options={starOptions.map((n) => ({ value: String(n), label: n === 0 ? 'No stars' : `⭐ ${n}` }))}
              />
              <Toggle label="A surprise sticker" hint="One picked at random for their sticker book." checked={sticker} onChange={setSticker} />
              <Field label="Pocket money (£)" hint="Leave empty for none. It adds up until you mark it paid.">
                {(p) => <Input {...p} type="number" inputMode="decimal" min="0" step="0.05" value={pounds} onChange={(e) => setPounds(e.target.value)} placeholder="0.50" />}
              </Field>
            </div>
          </fieldset>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Dialog>
  );
}
