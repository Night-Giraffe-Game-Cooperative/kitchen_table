import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { money } from '../lib/days';
import { ago } from '../lib/time';
import type { Goal, Person, Rewards } from '../lib/types';
import { Avatar, Button, Dialog, EmptyState, Field, IconButton, Input, Notice } from '../components/ui';
import { InfoTip } from '../components/tips';
import { canSetFor, errorText, tint, useLive, usePersonOf } from './tasksShared';
import { confirmFirst } from '../components/confirm';

interface RewardData {
  rewards: Rewards[];
  stickers: string[];
}

const treatEmoji = ['🎁', '🛝', '🍦', '🎬', '🍕', '🧸', '🎮', '📚', '🏊', '🎨', '🍫', '🎡', '🦄', '⚽'];

export function RewardsView() {
  const { me } = useStore();
  const personOf = usePersonOf();
  const live = useLive<RewardData>('/api/rewards', 'tasks_changed');
  const [paying, setPaying] = useState<{ person: Person; owed: number } | null>(null);
  const [goal, setGoal] = useState<{ person: Person; goal?: Goal } | null>(null);

  // Kids always; grown-ups once they've earned something. You first, then by name.
  const shown = (live.data?.rewards ?? [])
    .map((r) => ({ r, person: personOf(r.user_id) }))
    .filter((x): x is { r: Rewards; person: Person } => !!x.person)
    .filter(({ r, person }) => person.role === 'kid' || r.stars > 0 || r.earned_pence > 0 || r.goals.length > 0)
    .sort((a, b) => Number(b.person.id === me.id) - Number(a.person.id === me.id) || a.person.name.localeCompare(b.person.name));

  return (
    <>
      {live.error && !live.data && <Notice tone="danger">{live.error}</Notice>}
      {live.data && shown.length === 0 && (
        <EmptyState art="🏆" title="No rewards yet">
          <p>Tasks and homework can earn stars, pocket money and stickers. Set a reward when you add a task, and it shows here as it's earned.</p>
        </EmptyState>
      )}
      {shown.length > 0 && (
        <p className="muted with-info">
          How rewards work
          <InfoTip about="how rewards work">
            {me.role === 'kid'
              ? "Stars, stickers and pocket money come from the tasks and homework your guardians set, each time you tick one off or hand homework in on time, once a grown-up has checked it. Tasks you set yourself are just for you, so they don't earn any."
              : "Stars, stickers and pocket money come from the tasks and homework guardians set: each time a task is ticked off, or homework is handed in on time. A kid's tick counts once a grown-up checks it under To check on Today. Pocket money adds up until you mark it paid. The tasks kids set themselves don't earn rewards."}
          </InfoTip>
        </p>
      )}
      <div className="jobs-grid">
        {shown.map(({ r, person }) => (
          <RewardCard
            key={person.id}
            rewards={r}
            person={person}
            stickers={live.data!.stickers}
            onPay={(owed) => setPaying({ person, owed })}
            onGoal={(g) => setGoal({ person, goal: g })}
          />
        ))}
      </div>
      {paying && <PayDialog person={paying.person} owed={paying.owed} onClose={() => setPaying(null)} />}
      {goal && <GoalDialog person={goal.person} goal={goal.goal} onClose={() => setGoal(null)} />}
    </>
  );
}

function RewardCard({
  rewards: r,
  person,
  stickers,
  onPay,
  onGoal,
}: {
  rewards: Rewards;
  person: Person;
  stickers: string[];
  onPay: (owed: number) => void;
  onGoal: (g?: Goal) => void;
}) {
  const { me, toast } = useStore();
  const personOf = usePersonOf();
  // Grown-ups who look after someone handle their rewards; nobody does their own.
  const canManage = person.id !== me.id && canSetFor(me, person);
  const owed = r.earned_pence - r.paid_pence;
  const counts = new Map<string, number>();
  for (const s of r.stickers) counts.set(s.sticker, (counts.get(s.sticker) ?? 0) + 1);

  async function call(fn: () => Promise<unknown>, done?: string) {
    try {
      await fn();
      if (done) toast(done, 'success');
    } catch (e) {
      toast(errorText(e), 'danger');
    }
  }

  return (
    <section className="jobs-card reward-card sheet" style={tint(person)} aria-label={`${person.name}'s rewards`}>
      <header className="jobs-head">
        <Avatar person={person} size="md" />
        <span className="jobs-who">
          <strong role="heading" aria-level={2}>
            {person.name}
          </strong>
          <span className="muted">{person.id === me.id ? 'Your rewards' : 'Rewards'}</span>
        </span>
      </header>

      <div className="reward-stats">
        <p className="reward-stat">
          <span className="reward-big" aria-hidden="true">
            ⭐
          </span>
          <span>
            <strong>{r.stars}</strong> star{r.stars === 1 ? '' : 's'}
          </span>
        </p>
        {(r.earned_pence > 0 || r.paid_pence > 0) && (
          <p className="reward-stat">
            <span className="reward-big" aria-hidden="true">
              💷
            </span>
            <span>
              <strong>{money(Math.max(owed, 0))}</strong> to come
              <span className="muted"> · {money(r.paid_pence)} paid so far</span>
            </span>
          </p>
        )}
        {canManage && owed > 0 && (
          <Button size="sm" icon="check" onClick={() => onPay(owed)}>
            Mark paid
          </Button>
        )}
      </div>

      {(r.goals.length > 0 || canManage) && (
        <div className="reward-block">
          <h3 className="reward-title">Saving up for</h3>
          {r.goals.length === 0 && <p className="muted">No goals yet. Set a treat to save stars up for.</p>}
          <ul className="goals">
            {r.goals.map((g) => {
              const got = Math.min(g.progress ?? 0, g.stars);
              const reached = got >= g.stars;
              return (
                <li key={g.id} className="goal" data-reached={reached || undefined} data-given={g.given_at ? true : undefined}>
                  <span className="goal-emoji" aria-hidden="true">
                    {g.emoji}
                  </span>
                  <span className="goal-text">
                    <strong>{g.title}</strong>
                    <span
                      className="goal-bar"
                      role="progressbar"
                      aria-label={`${g.title}: stars so far`}
                      aria-valuemin={0}
                      aria-valuemax={g.stars}
                      aria-valuenow={got}
                    >
                      <span style={{ width: `${(got / g.stars) * 100}%` }} />
                    </span>
                    <span className="muted">
                      {g.given_at ? `Given ${ago(g.given_at)}` : reached ? 'Got there! 🎉' : `${got} of ${g.stars} stars`}
                    </span>
                  </span>
                  {canManage && (
                    <span className="goal-actions">
                      {reached && !g.given_at && (
                        <Button size="sm" variant="primary" onClick={() => call(() => api.patch(`/api/goals/${g.id}`, { given: true }), `${person.name} has had their treat.`)}>
                          Mark given
                        </Button>
                      )}
                      <IconButton icon="pen" size="sm" label={`Change ${g.title}`} onClick={() => onGoal(g)} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {canManage && (
            <Button size="sm" icon="plus" onClick={() => onGoal()}>
              Set a goal
            </Button>
          )}
        </div>
      )}

      <div className="reward-block">
        <h3 className="reward-title">
          Sticker book <span className="muted">· {counts.size} of {stickers.length}</span>
        </h3>
        <ul className="sticker-book" aria-label={`${person.name}'s sticker book`}>
          {stickers.map((s) => {
            const n = counts.get(s) ?? 0;
            return (
              <li key={s} className="sticker" data-found={n > 0 || undefined} aria-label={n > 0 ? `${s}${n > 1 ? `, ${n} of them` : ''}` : 'Not found yet'}>
                <span aria-hidden="true">{n > 0 ? s : '?'}</span>
                {n > 1 && (
                  <span className="sticker-count" aria-hidden="true">
                    {n}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {r.payouts.length > 0 && (
        <details className="reward-block payouts">
          <summary>Pocket money paid</summary>
          <ul>
            {r.payouts.slice(0, 10).map((p) => (
              <li key={p.id}>
                <span>
                  <strong>{money(p.pence)}</strong> {ago(p.paid_at)}
                  {p.paid_by_id && personOf(p.paid_by_id) ? ` by ${personOf(p.paid_by_id)!.name}` : ''}
                </span>
                {canManage && (
                  <Button size="sm" variant="ghost" onClick={() => call(() => api.del(`/api/payouts/${p.id}`), 'Taken back.')}>
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function PayDialog({ person, owed, onClose }: { person: Person; owed: number; onClose: () => void }) {
  const { toast } = useStore();
  const [pounds, setPounds] = useState((owed / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const pence = Math.round(Number(pounds) * 100);
    if (!Number.isFinite(pence) || pence <= 0) return setError('How much was paid?');
    setBusy(true);
    try {
      await api.post(`/api/rewards/${person.id}/paid`, { pence });
      toast(`Paid ${person.name} ${money(pence)}.`, 'success');
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={`Pay ${person.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="pay-form" busy={busy}>
            Mark paid
          </Button>
        </>
      }
    >
      <form id="pay-form" className="stack" onSubmit={save}>
        <p className="muted">
          {person.name} has {money(owed)} to come. Mark what you've given them, all of it or some.
        </p>
        <Field label="Amount in pounds">
          {(p) => <Input {...p} type="number" inputMode="decimal" min="0.01" step="0.01" value={pounds} onChange={(e) => setPounds(e.target.value)} />}
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Dialog>
  );
}

function GoalDialog({ person, goal, onClose }: { person: Person; goal?: Goal; onClose: () => void }) {
  const { toast } = useStore();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [emoji, setEmoji] = useState(goal?.emoji ?? '🎁');
  const [stars, setStars] = useState(String(goal?.stars ?? 20));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError('What is the treat?');
    const body = { user_id: person.id, title: title.trim(), emoji, stars: Number(stars) };
    setBusy(true);
    try {
      if (goal) await api.patch(`/api/goals/${goal.id}`, body);
      else await api.post('/api/goals', body);
      toast(goal ? 'Saved.' : `${person.name} is saving up for ${title.trim()}.`, 'success');
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (!goal || !(await confirmFirst(`Delete the goal ${goal.title}?`, 'Delete'))) return;
    try {
      await api.del(`/api/goals/${goal.id}`);
      toast(`Deleted ${goal.title}.`, 'success');
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={goal ? 'Change goal' : `Set a goal for ${person.name}`}
      footer={
        <>
          {goal && (
            <Button variant="danger" icon="trash" onClick={remove} className="foot-start">
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="goal-form" busy={busy}>
            {goal ? 'Save' : 'Set the goal'}
          </Button>
        </>
      }
    >
      <form id="goal-form" className="stack" onSubmit={save}>
        <Field label="The treat">
          {(p) => <Input {...p} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="A trip to the park" autoFocus={!goal} />}
        </Field>
        <fieldset className="fieldset">
          <legend>Picture</legend>
          <div className="emoji-pick">
            {treatEmoji.map((t) => (
              <button key={t} type="button" className="emoji-option" aria-pressed={emoji === t} onClick={() => setEmoji(t)}>
                {t}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="Stars needed" hint="Stars count from when the goal is set.">
          {(p) => <Input {...p} type="number" inputMode="numeric" min="1" max="1000" value={stars} onChange={(e) => setStars(e.target.value)} />}
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Dialog>
  );
}
