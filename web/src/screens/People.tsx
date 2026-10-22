import { useEffect, useState, type FormEvent } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { go } from '../lib/router';
import { ago } from '../lib/time';
import { bubbleFeatures, permissionText, roleDefaults, switchedOffBy } from '../lib/permissions';
import { friendshipBetween, isGrownUp, isGuardianOf, mayTalk, waitingOnMe, whyNot } from '../lib/contacts';
import type { Bubble, BubbleFeature, Colour, Friendship, Permission, Person, Role } from '../lib/types';
import { Avatar, Button, Dialog, EmptyState, Field, IconButton, Input, Notice, RoleBadge, Segmented, Select, Toggle } from '../components/ui';
import { InfoTip } from '../components/tips';
import { Icon } from '../components/icons';
import { confirmFirst } from '../components/confirm';

export const avatars = ['🙂', '😎', '🦒', '🐶', '🐻', '🦄', '🐱', '🦊', '🐼', '🐸', '🦁', '🐯', '🐧', '🦉', '🐙', '🦖', '🌻', '🌈', '⭐', '🚀', '⚽', '🎸', '👑', '🧁'];

const bubbleEmoji = ['🏡', '🏠', '🌳', '🌻', '🌈', '⭐', '🦊', '🐝', '🍎', '⛵'];

export const colourNames: Record<Colour, string> = {
  sky: 'Sky',
  meadow: 'Meadow',
  sunflower: 'Sunflower',
  apricot: 'Apricot',
  rose: 'Rose',
  lilac: 'Lilac',
  sea: 'Sea',
  slate: 'Slate',
};

const roleText: Record<Role, { label: string; hint: string }> = {
  admin: { label: 'Admin', hint: 'Can add people and change anything.' },
  grownup: { label: 'Grown-up', hint: 'Can do everything except add people. Guardian to the kids in their own family.' },
  kid: { label: 'Kid', hint: "Can chat, share and play. Their guardians change what's allowed." },
};

export function People({ personId }: { personId?: number }) {
  const { people, bubbles, me } = useStore();
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<Bubble | null>(null);
  const isAdmin = me.permissions.manage_people;
  const list = [...people.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const person = personId ? people.get(personId) : undefined;
  // With friends or cousins in, the list is grouped by family, home first.
  const groups =
    bubbles.size > 1
      ? [...bubbles.values()]
          .sort((a, b) => Number(b.home) - Number(a.home) || a.name.localeCompare(b.name))
          .map((b) => ({ bubble: b as Bubble | null, people: list.filter((p) => p.bubble_id === b.id) }))
          .filter((g) => g.people.length)
      : [{ bubble: null, people: list }];

  return (
    <div className="split" data-open={personId ? 'yes' : 'no'}>
      <section className="split-list" aria-label="Family">
        <header className="page-head">
          <h1>Family</h1>
          {isAdmin && (
            <Button icon="plus" variant="primary" size="sm" onClick={() => setAdding(true)}>
              Add someone
            </Button>
          )}
        </header>
        <WaitingForYou />
        {groups.map(({ bubble, people: members }) => (
          <div key={bubble?.id ?? 'all'} className="bubble-group">
            {bubble && (
              <div className="bubble-head">
                <span className="bubble-emoji" aria-hidden="true">
                  {bubble.emoji}
                </span>
                <h2 className="section-label">{bubble.name}</h2>
                {isAdmin && <IconButton icon="pen" size="sm" label={`Change ${bubble.name}`} onClick={() => setChanging(bubble)} />}
              </div>
            )}
            {bubble && <RelativesNote bubble={bubble} />}
            <PersonList people={members} selected={personId} />
          </div>
        ))}
        {isAdmin && (
          <div className="admin-links">
            <a className="outbox-link" href="#/outbox">
              <Icon name="mail" size={18} /> Emails sent by the app
            </a>
            <a className="outbox-link" href="/api/export/family" download>
              <Icon name="download" size={18} /> Download everything: chats, photos, calendar and tasks
            </a>
          </div>
        )}
      </section>
      <section className="split-detail">
        {person ? (
          <PersonDetail key={person.id} person={person} />
        ) : (
          <EmptyState art="👨‍👩‍👧‍👦" title="Your family">
            <p>{isAdmin ? 'Choose someone to change what they can do, or add someone new.' : 'Choose someone to send them a message.'}</p>
          </EmptyState>
        )}
      </section>
      {isAdmin && <AddPerson open={adding} onClose={() => setAdding(false)} />}
      {changing && <BubbleSettings bubble={changing} onClose={() => setChanging(null)} />}
    </div>
  );
}

function PersonList({ people, selected }: { people: Person[]; selected?: number }) {
  const { me, online } = useStore();
  return (
    <ul className="room-list">
      {people.map((p) => (
        <li key={p.id}>
          <a className="room-item" href={`#/people/${p.id}`} aria-current={selected === p.id ? 'page' : undefined} data-off={!p.active || undefined}>
            <Avatar person={p} online={online.has(p.id)} />
            <span className="room-text">
              <span className="room-name">
                {p.name}
                {p.id === me.id && <span className="muted"> (you)</span>}
              </span>
              <span className="room-last">
                {!p.active
                  ? 'Switched off'
                  : p.must_change_password
                    ? 'Invited, not signed in yet'
                    : online.has(p.id)
                      ? 'Here now'
                      : p.last_seen_at
                        ? `Last here ${ago(p.last_seen_at)}`
                        : 'Not here yet'}
              </span>
            </span>
            <RoleBadge role={p.role} />
          </a>
        </li>
      ))}
    </ul>
  );
}

// Admins rename a family, and choose what families other than their own can use.
function BubbleSettings({ bubble, onClose }: { bubble: Bubble; onClose: () => void }) {
  const { refreshPeople, people, bubbles } = useStore();
  const [name, setName] = useState(bubble.name);
  const [relatives, setRelatives] = useState<Set<number>>(() => new Set(bubble.relative_ids ?? []));
  // Grown-ups from other homes, by home, who could be family to this one's kids.
  const others = [...people.values()]
    .filter((p) => p.active && isGrownUp(p) && p.bubble_id !== bubble.id)
    .sort((a, b) => Number(bubbles.get(b.bubble_id ?? -1)?.home ?? 0) - Number(bubbles.get(a.bubble_id ?? -1)?.home ?? 0) || a.name.localeCompare(b.name));
  const [emoji, setEmoji] = useState(bubble.emoji);
  const [features, setFeatures] = useState<Record<BubbleFeature, boolean>>(bubble.features);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/bubbles/${bubble.id}`, { name, emoji, relative_ids: [...relatives], ...(bubble.home ? {} : { features }) });
      await refreshPeople();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Change ${bubble.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="bubble-settings" busy={busy} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form id="bubble-settings" className="stack" onSubmit={save}>
        <Field label="Name">{(p) => <Input {...p} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} required />}</Field>
        <BubbleEmojiPicker value={emoji} onChange={setEmoji} />
        {others.length > 0 && (
          <fieldset className="fieldset">
            <legend>Family to the kids in {bubble.name}</legend>
            <p className="muted">
              Grandparents, aunts and uncles from other homes. They can chat with the kids here, and the kids with them. Other grown-ups can only chat with the grown-ups.
            </p>
            <ul className="people-pick">
              {others.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="person-chip"
                    aria-pressed={relatives.has(p.id)}
                    onClick={() => {
                      const next = new Set(relatives);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      setRelatives(next);
                    }}
                  >
                    <Avatar person={p} size="sm" />
                    <span>{p.name}</span>
                    <span className="chip-note">{bubbles.get(p.bubble_id ?? -1)?.emoji}</span>
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        {!bubble.home && (
          <fieldset className="fieldset">
            <legend>What they can use</legend>
            <p className="muted">Chatting is always on. Anything switched off here is off for everyone in {bubble.name}, whatever their own settings say.</p>
            <div className="toggles">
              {bubbleFeatures.map((f) => (
                <Toggle key={f.key} label={f.label} hint={f.hint} checked={features[f.key]} onChange={(v) => setFeatures({ ...features, [f.key]: v })} />
              ))}
            </div>
          </fieldset>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Dialog>
  );
}

function BubbleEmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  return (
    <fieldset className="fieldset">
      <legend>Picture</legend>
      <div className="emoji-pick">
        {bubbleEmoji.map((e) => (
          <button key={e} type="button" className="emoji-option" aria-pressed={value === e} onClick={() => onChange(e)}>
            {e}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function PersonDetail({ person }: { person: Person }) {
  const { me, online, bubbles, friendships, toast, refreshPeople } = useStore();
  const isAdmin = me.permissions.manage_people;
  // Grown-ups are guardians to the kids in their own family.
  const looksAfterKids = person.role === 'kid' && me.permissions.manage_kids && person.bubble_id === me.bubble_id;
  const facts = { bubbles, friendships };
  const canTalk = mayTalk(me, person, facts);
  const asked = person.role === 'kid' && me.role === 'kid' ? friendshipBetween(me.id, person.id, friendships) : undefined;
  const bubble = bubbles.size > 1 && person.bubble_id ? bubbles.get(person.bubble_id) : undefined;
  const canManage = person.id !== me.id && person.role !== 'admin' && (isAdmin || looksAfterKids);
  const [otp, setOtp] = useState<string | null>(null);

  async function message() {
    try {
      const res = await api.post<{ room_id: number }>(`/api/rooms/direct/${person.id}`);
      go({ name: 'chats', roomId: res.room_id });
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  async function reset() {
    if (!(await confirmFirst(`Give ${person.name} a new one-time password?`, 'Give new password', 'Their old password stops working.'))) return;
    try {
      const res = await api.post<{ one_time_password: string }>(`/api/people/${person.id}/reset`);
      setOtp(res.one_time_password);
      refreshPeople();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <div className="page person">
      <header className="room-head">
        <a className="icon-btn btn-ghost back" href="#/people" aria-label="Back to family">
          <Icon name="back" />
        </a>
        <div className="room-title">
          <h1>{person.name}</h1>
        </div>
      </header>

      <div className="person-hero sheet">
        <Avatar person={person} size="xl" online={online.has(person.id)} />
        <div>
          <p className="person-name">{person.name}</p>
          <p className="muted">
            <RoleBadge role={person.role} /> {online.has(person.id) ? 'Here now' : person.last_seen_at ? `Last here ${ago(person.last_seen_at)}` : 'Not here yet'}
          </p>
          {bubble && (
            <p className="muted">
              {bubble.emoji} {bubble.name}
            </p>
          )}
          {person.email && <p className="muted">{person.email}</p>}
        </div>
        {person.id !== me.id && person.active && me.permissions.direct_messages && canTalk && (
          <Button variant="primary" icon="chat" onClick={message}>
            Message
          </Button>
        )}
        {person.id !== me.id && person.active && me.role === 'kid' && person.role === 'kid' && !canTalk && !asked && (
          <Button variant="primary" icon="plus" onClick={() => askForFriend(me, person, false, { bubbles, refreshPeople, toast })}>
            Ask to chat
          </Button>
        )}
      </div>

      {person.id !== me.id && person.active && !canTalk && (
        <p className="muted">{asked ? `You've asked to chat with ${person.name}. A guardian from each family needs to say yes.` : whyNot([me, person], facts)}</p>
      )}

      {otp && <OtpCard name={person.name} otp={otp} onDone={() => setOtp(null)} />}

      {person.must_change_password && person.active && !otp && (isAdmin || looksAfterKids) && (
        <Notice tone="info">
          {person.name} hasn't chosen a password yet. Their one-time password{' '}
          {person.otp_expires_at ? `works until ${new Date(person.otp_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` : 'is waiting'}.
        </Notice>
      )}

      {person.role === 'kid' && (person.id === me.id || isAdmin || isGuardianOf(me, person)) && <ChatsWith kid={person} />}
      {isAdmin && person.id !== me.id && <AdminDetails person={person} onReset={reset} />}
      {canManage && <PermissionsPanel person={person} />}
      {person.id === me.id && (
        <p className="muted">
          This is you. Change your name, picture and password on the <a href="#/me">Me</a> page.
        </p>
      )}
    </div>
  );
}

function OtpCard({ name, otp, onDone }: { name: string; otp: string; onDone?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="otp sheet" role="status">
      <p>
        <strong>{name}'s one-time password</strong>
      </p>
      <p className="otp-code">{otp}</p>
      <p className="muted">
        It's been emailed to them. If the email doesn't arrive, tell them this one-time password and to sign in at {window.location.host}. It works for 7 days, and they'll choose their own
        password when they sign in.
      </p>
      <div className="row">
        <Button
          size="sm"
          icon={copied ? 'check' : 'copy'}
          onClick={() => {
            navigator.clipboard?.writeText(otp).then(() => setCopied(true), () => {});
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {onDone && (
          <Button size="sm" variant="ghost" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}

function AdminDetails({ person, onReset }: { person: Person; onReset: () => void }) {
  const { toast, refreshPeople, bubbles, me } = useStore();
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? '');
  const [role, setRole] = useState<Role>(person.role);
  const [bubbleId, setBubbleId] = useState(person.bubble_id);
  const [busy, setBusy] = useState(false);
  const changed = name !== person.name || email !== (person.email ?? '') || role !== person.role || bubbleId !== person.bubble_id;
  const atHome = bubbles.get(bubbleId ?? -1)?.home ?? true;

  useEffect(() => {
    setName(person.name);
    setEmail(person.email ?? '');
    setRole(person.role);
    setBubbleId(person.bubble_id);
  }, [person.name, person.email, person.role, person.bubble_id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/api/people/${person.id}`, { name, email, role, ...(bubbleId !== person.bubble_id ? { bubble_id: bubbleId } : {}) });
      await refreshPeople();
      toast('Saved.', 'success');
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function setActive(active: boolean) {
    if (!active && !(await confirmFirst(`Switch ${person.name} off?`, 'Switch off', "They'll be signed out and can't sign in until you switch them back on."))) return;
    try {
      await api.patch(`/api/people/${person.id}`, { active });
      await refreshPeople();
    } catch (err) {
      toast((err as Error).message, 'danger');
    }
  }

  return (
    <section className="panel sheet">
      <h2>Details</h2>
      <form className="stack" onSubmit={save}>
        <Field label="Name">{(p) => <Input {...p} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />}</Field>
        <Field label="Email">{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <RolePicker value={role} onChange={setRole} atHome={atHome} />
        {bubbles.size > 1 && (
          <Field label="Family" hint="Grown-ups are guardians to the kids in their own family, and read the chats those kids are in.">
            {(p) => (
              <Select
                {...p}
                value={bubbleId ?? ''}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setBubbleId(id);
                  if (role === 'admin' && !bubbles.get(id)?.home) setRole('grownup');
                }}
              >
                {[...bubbles.values()].map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.emoji} {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="row">
          <Button type="submit" variant="primary" busy={busy} disabled={!changed}>
            Save
          </Button>
        </div>
      </form>
      <hr className="rule" />
      <div className="row row-wrap">
        <Button icon="key" onClick={onReset} disabled={!person.active}>
          New one-time password
        </Button>
        {person.active ? (
          <Button variant="ghost" icon="lock" onClick={() => setActive(false)}>
            Switch off
          </Button>
        ) : (
          <Button icon="refresh" onClick={() => setActive(true)}>
            Switch back on
          </Button>
        )}
        {person.id !== me.id && (
          <Button variant="ghost" icon="trash" onClick={() => setDeleting(true)}>
            Delete account
          </Button>
        )}
      </div>
      {deleting && <DeletePerson person={person} onClose={() => setDeleting(false)} />}
    </section>
  );
}

function DeletePerson({ person, onClose }: { person: Person; onClose: () => void }) {
  const { toast, refreshPeople, refreshRooms } = useStore();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/people/${person.id}`, { confirm: typed });
      go({ name: 'people' });
      await Promise.all([refreshPeople(), refreshRooms()]);
      toast(`${person.name}'s account has gone.`, 'success');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete ${person.name}'s account?`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" type="submit" form="delete-person" busy={busy} disabled={typed.trim() !== person.name}>
            Delete for good
          </Button>
        </>
      }
    >
      <form id="delete-person" className="stack" onSubmit={remove}>
        <p>
          Their messages, photos and doodles, ticks and rewards, and the calendars they linked go for good, and they're signed out everywhere.
          Events they added and games they played stay, without their name. To keep them out for a while instead, switch them off.
        </p>
        <Field label={`Type ${person.name} to be sure`}>
          {(p) => <Input {...p} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" required />}
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Dialog>
  );
}

// Admins only ever come from the home family.
function RolePicker({ value, onChange, atHome }: { value: Role; onChange: (r: Role) => void; atHome: boolean }) {
  const roles: Role[] = atHome ? ['admin', 'grownup', 'kid'] : ['grownup', 'kid'];
  return (
    <div className="field">
      <span className="field-label">They are</span>
      <Segmented label="Role" value={value} onChange={onChange} options={roles.map((r) => ({ value: r, label: roleText[r].label }))} />
      <p className="field-hint">
        {roleText[value].hint}
        {!atHome && ' Admins come from your own family.'}
      </p>
    </div>
  );
}

function PermissionsPanel({ person }: { person: Person }) {
  const { toast, refreshPeople, bubbles } = useStore();
  const defaults = roleDefaults(person.role);
  const bubble = person.bubble_id ? bubbles.get(person.bubble_id) : undefined;
  // Their own settings, kept apart from anything their family has switched off.
  const [values, setValues] = useState<Record<Permission, boolean>>(() => ({ ...defaults, ...(person.overrides ?? {}) }));
  const [quiet, setQuiet] = useState(!!person.quiet_hours);
  const [from, setFrom] = useState(person.quiet_hours?.from ?? '19:30');
  const [to, setTo] = useState(person.quiet_hours?.to ?? '07:00');
  const [busy, setBusy] = useState(false);

  async function save(next: Record<Permission, boolean>, quietOn: boolean, f: string, t: string) {
    setBusy(true);
    const overrides: Partial<Record<Permission, boolean>> = {};
    for (const { key } of permissionText) if (next[key] !== defaults[key]) overrides[key] = next[key];
    try {
      await api.put(`/api/people/${person.id}/permissions`, { overrides, quiet_hours: quietOn ? { from: f, to: t } : null });
      await refreshPeople();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  const shown = permissionText.filter((p) => person.role !== 'kid' || p.key !== 'manage_kids');

  return (
    <section className="panel sheet" aria-busy={busy}>
      <h2>What {person.name} can do</h2>
      <p className="muted">Changes save straight away. {person.role === 'kid' ? 'Kids' : 'Grown-ups'} start with sensible settings.</p>
      <div className="toggles">
        {shown.map((p) =>
          switchedOffBy(bubble, p.key) ? (
            <Toggle key={p.key} label={p.label} hint={`Switched off for everyone in ${bubble!.name}.`} checked={false} disabled onChange={() => {}} />
          ) : (
            <Toggle
              key={p.key}
              label={p.label}
              hint={values[p.key] !== defaults[p.key] ? `${p.hint} (changed from the usual)` : p.hint}
              checked={values[p.key]}
              onChange={(v) => {
                const next = { ...values, [p.key]: v };
                setValues(next);
                save(next, quiet, from, to);
              }}
            />
          ),
        )}
      </div>
      <hr className="rule" />
      <Toggle
        label="Quiet hours"
        hint="No sending messages during these times, like bedtime or school. They can still read."
        checked={quiet}
        onChange={(v) => {
          setQuiet(v);
          save(values, v, from, to);
        }}
      />
      {quiet && (
        <div className="row row-wrap quiet-times">
          <Field label="From">
            {(p) => <Input {...p} type="time" value={from} onChange={(e) => setFrom(e.target.value)} onBlur={() => save(values, true, from, to)} />}
          </Field>
          <Field label="Until">
            {(p) => <Input {...p} type="time" value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => save(values, true, from, to)} />}
          </Field>
        </div>
      )}
    </section>
  );
}

function AddPerson({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refreshPeople, colours, bubbles } = useStore();
  const home = [...bubbles.values()].find((b) => b.home);
  // Which family they're in: one that's here, or 'new' for a new one.
  const [family, setFamily] = useState<number | 'new' | null>(null);
  const [familyName, setFamilyName] = useState('');
  const [familyEmoji, setFamilyEmoji] = useState('🏠');
  const chosen = family ?? home?.id ?? null;
  const atHome = chosen !== 'new' && (chosen == null || !!bubbles.get(chosen)?.home);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('kid');
  const [avatar, setAvatar] = useState('🙂');
  const [colour, setColour] = useState<Colour>('meadow');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; otp: string } | null>(null);

  function close() {
    setFamily(null);
    setFamilyName('');
    setFamilyEmoji('🏠');
    setName('');
    setEmail('');
    setRole('kid');
    setAvatar('🙂');
    setColour('meadow');
    setError(null);
    setDone(null);
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const where = chosen === 'new' ? { bubble_name: familyName, bubble_emoji: familyEmoji } : chosen ? { bubble_id: chosen } : {};
      const res = await api.post<{ person: Person; one_time_password: string }>('/api/people', { name, email, role, avatar, colour, ...where });
      await refreshPeople();
      setDone({ name: res.person.name, otp: res.one_time_password });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={done ? `${done.name} is in the family` : 'Add someone'}
      footer={
        done ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit" form="add-person" busy={busy}>
              Add and send the invitation
            </Button>
          </>
        )
      }
    >
      {done ? (
        <OtpCard name={done.name} otp={done.otp} />
      ) : (
        <form id="add-person" className="stack" onSubmit={submit}>
          <p className="muted">They'll get an email with a one-time password, and choose their own password when they first sign in.</p>
          <Field label="Name">{(p) => <Input {...p} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />}</Field>
          <Field label="Email" hint="Kids can use a grown-up's email with a + in it, like mum+mia@example.com.">
            {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoCapitalize="none" />}
          </Field>
          <RolePicker value={role} onChange={setRole} atHome={atHome} />
          <Field label="Family" hint="Friends, cousins and grandparents come in a family of their own. A grown-up from it goes first, as guardian to its kids.">
            {(p) => (
              <Select
                {...p}
                value={chosen ?? ''}
                onChange={(e) => {
                  const next = e.target.value === 'new' ? 'new' : Number(e.target.value);
                  setFamily(next);
                  if (role === 'admin' && (next === 'new' || !bubbles.get(next)?.home)) setRole('grownup');
                }}
              >
                {[...bubbles.values()].map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.emoji} {b.name}
                  </option>
                ))}
                <option value="new">A new family…</option>
              </Select>
            )}
          </Field>
          {chosen === 'new' && (
            <>
              <Field label="The family's name">
                {(p) => <Input {...p} value={familyName} maxLength={50} onChange={(e) => setFamilyName(e.target.value)} placeholder="The Smiths" required />}
              </Field>
              <BubbleEmojiPicker value={familyEmoji} onChange={setFamilyEmoji} />
              {role === 'kid' && <Notice tone="info">Add a grown-up from this family first, as guardian to the kids.</Notice>}
            </>
          )}
          <fieldset className="fieldset">
            <legend>Picture</legend>
            <div className="emoji-pick">
              {avatars.map((a) => (
                <button key={a} type="button" className="emoji-option" aria-pressed={avatar === a} onClick={() => setAvatar(a)}>
                  {a}
                </button>
              ))}
            </div>
          </fieldset>
          <ColourPicker value={colour} colours={colours as Colour[]} onChange={setColour} />
          {error && <Notice tone="danger">{error}</Notice>}
        </form>
      )}
    </Dialog>
  );
}

export function ColourPicker({ value, colours, onChange }: { value: Colour; colours: Colour[]; onChange: (c: Colour) => void }) {
  return (
    <fieldset className="fieldset">
      <legend>Colour</legend>
      <div className="colour-pick">
        {colours.map((c) => (
          <button
            key={c}
            type="button"
            className={`colour-option tint-${c}`}
            aria-pressed={value === c}
            aria-label={colourNames[c]}
            data-tip={colourNames[c]}
            onClick={() => onChange(c)}
          >
            <span className={`colour-dot ink-${c}`} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}


interface AskDeps {
  bubbles: Map<number, Bubble>;
  refreshPeople: () => Promise<void>;
  toast: (t: string, tone?: 'success' | 'danger') => void;
}

async function askForFriend(kid: Person, friend: Person, guardian: boolean, { bubbles, refreshPeople, toast }: AskDeps) {
  try {
    await api.post('/api/friends', { kid_id: kid.id, friend_id: friend.id });
    await refreshPeople();
    // A guardian asking says yes for their own side at the same time.
    const theirs = bubbles.get(friend.bubble_id ?? -1)?.name ?? `${friend.name}'s family`;
    toast(guardian ? `Asked. ${kid.name} and ${friend.name} can chat once ${theirs} says yes too.` : `Asked. You and ${friend.name} can chat once a guardian from each family says yes.`, 'success');
  } catch (e) {
    toast((e as Error).message, 'danger');
  }
}

/** Kids' friends from other families waiting on this guardian's yes. */
function WaitingForYou() {
  const { me, people, friendships } = useStore();
  const waiting = waitingOnMe(me, friendships, people);
  if (!waiting.length) return null;
  return (
    <section className="waiting sheet" aria-labelledby="waiting-head">
      <div className="with-info">
        <h2 id="waiting-head">Waiting for your yes</h2>
        <InfoTip about="waiting for your yes">
          A child wants to chat with a child from another family. They can chat once a guardian from each family says yes. Either family can stop it
          later, and what was said stays readable.
        </InfoTip>
      </div>
      <ul className="friend-list">
        {waiting.map((f) => (
          <FriendAsk key={f.id} friendship={f} />
        ))}
      </ul>
    </section>
  );
}

function FriendAsk({ friendship: f }: { friendship: Friendship }) {
  const { me, people, bubbles, refreshPeople, toast } = useStore();
  const [busy, setBusy] = useState(false);
  // My side is the kid I'm a guardian of.
  const mine = f.kid_ids.findIndex((id) => {
    const kid = people.get(id);
    return !!kid && isGuardianOf(me, kid);
  });
  const kid = people.get(f.kid_ids[mine]);
  const friend = people.get(f.kid_ids[1 - mine]);
  if (!kid || !friend) return null;
  const theirs = bubbles.get(friend.bubble_id ?? -1);
  const asker = f.asked_by_id === me.id ? 'You' : f.asked_by_id ? people.get(f.asked_by_id)?.name : undefined;
  const otherSaid = f.ok_by[1 - mine] != null;

  async function answer(yes: boolean) {
    setBusy(true);
    try {
      if (yes) await api.post(`/api/friends/${f.id}/yes`);
      else await api.del(`/api/friends/${f.id}`);
      await refreshPeople();
      toast(yes ? (otherSaid ? `${kid!.name} and ${friend!.name} can chat now.` : `Thanks. ${theirs?.name ?? 'Their family'} needs to say yes too.`) : 'Said no.', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
      setBusy(false);
    }
  }

  return (
    <li className="friend-row">
      <Avatar person={friend} />
      <span className="friend-text">
        <strong>
          Can {kid.name} chat with {friend.name}
          {theirs ? ` from ${theirs.name}` : ''}?
        </strong>
        <span className="muted">
          {asker ? `${asker} asked. ` : ''}
          {otherSaid ? `${theirs?.name ?? 'Their family'} said yes.` : `${theirs?.name ?? 'Their family'} needs to say yes too.`}
        </span>
      </span>
      <span className="row">
        <Button size="sm" variant="primary" busy={busy} onClick={() => answer(true)}>
          Say yes
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => answer(false)}>
          Say no
        </Button>
      </span>
    </li>
  );
}

/** Under a household's name: the grown-ups from other homes who are family to its kids. */
function RelativesNote({ bubble }: { bubble: Bubble }) {
  const { people } = useStore();
  const names = (bubble.relative_ids ?? []).map((id) => people.get(id)?.name).filter(Boolean);
  if (!names.length) return null;
  return <p className="muted bubble-note">Family to the kids here: {names.join(', ')}</p>;
}

/** Who a kid can chat with: their family, and friends from other families once both guardians say yes. */
function ChatsWith({ kid }: { kid: Person }) {
  const { me, people, bubbles, friendships, refreshPeople, toast } = useStore();
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState(false);
  const isAdmin = me.permissions.manage_people;
  const isGuardian = isGuardianOf(me, kid);
  const canAsk = isGuardian || kid.id === me.id;
  const home = bubbles.get(kid.bubble_id ?? -1);
  const relatives = new Set(home?.relative_ids ?? []);
  const everyone = [...people.values()].filter((p) => p.active && p.id !== kid.id);
  const family = everyone.filter((p) => p.bubble_id === kid.bubble_id || relatives.has(p.id));
  const theirs = friendships.filter((f) => f.kid_ids.includes(kid.id));
  const you = kid.id === me.id;

  async function remove(f: Friendship, friend: Person) {
    const ask = f.approved
      ? await confirmFirst(`Stop ${kid.name} and ${friend.name} chatting?`, 'Stop', 'Their chats close. A guardian from each family can say yes again later.')
      : true;
    if (!ask) return;
    try {
      await api.del(`/api/friends/${f.id}`);
      await refreshPeople();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <section className="panel sheet">
      <h2>Who {you ? 'you' : kid.name} can chat with</h2>
      <h3 className="section-label">Family</h3>
      <ul className="people-pick">
        {family.map((p) => (
          <li key={p.id} className="person-chip person-chip-static">
            <Avatar person={p} size="sm" />
            <span>{p.name}</span>
            {p.bubble_id !== kid.bubble_id && <span className="chip-note">{bubbles.get(p.bubble_id ?? -1)?.emoji}</span>}
          </li>
        ))}
      </ul>
      <p className="muted">
        The grown-ups and kids at {home?.name ?? 'home'}
        {relatives.size ? ', and grown-ups from other homes an admin has made family' : ''}.
      </p>
      {isAdmin && home && (
        <div className="row">
          <Button size="sm" icon="pen" onClick={() => setChanging(true)}>
            Choose family from other homes
          </Button>
        </div>
      )}

      <h3 className="section-label">Friends from other families</h3>
      {theirs.length === 0 && <p className="muted">None yet. A guardian from each family says yes before kids from different families can chat.</p>}
      {theirs.length > 0 && (
        <ul className="friend-list">
          {theirs.map((f) => {
            const friend = people.get(f.kid_ids.find((id) => id !== kid.id) ?? -1);
            if (!friend) return null;
            const waitingFor = f.kid_ids.filter((_, i) => f.ok_by[i] == null).map((id) => bubbles.get(people.get(id)?.bubble_id ?? -1)?.name ?? 'their family');
            return (
              <li key={f.id} className="friend-row">
                <Avatar person={friend} size="sm" />
                <span className="friend-text">
                  <strong>{friend.name}</strong>
                  <span className="muted">{f.approved ? `${bubbles.get(friend.bubble_id ?? -1)?.name ?? ''}`.trim() || 'Friends' : `Waiting for a yes from ${waitingFor.join(' and ')}`}</span>
                </span>
                {(canAsk || isAdmin) && (
                  <Button size="sm" variant="ghost" onClick={() => remove(f, friend)}>
                    {f.approved ? 'Stop' : 'Cancel'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canAsk && (
        <div className="row">
          <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
            Add a friend
          </Button>
        </div>
      )}
      {adding && <AddFriend kid={kid} onClose={() => setAdding(false)} />}
      {changing && home && <BubbleSettings bubble={home} onClose={() => setChanging(false)} />}
    </section>
  );
}

function AddFriend({ kid, onClose }: { kid: Person; onClose: () => void }) {
  const { me, people, bubbles, friendships, refreshPeople, toast } = useStore();
  const guardian = isGuardianOf(me, kid);
  // Kids from other families who aren't friends yet, by family.
  const kids = [...people.values()].filter((p) => p.active && p.role === 'kid' && p.bubble_id !== kid.bubble_id && !friendshipBetween(kid.id, p.id, friendships));
  const homes = [...bubbles.values()].map((b) => ({ bubble: b, kids: kids.filter((k) => k.bubble_id === b.id) })).filter((h) => h.kids.length);

  return (
    <Dialog open onClose={onClose} title={`A friend for ${kid.name}`}>
      <div className="stack">
        <p className="muted">They can chat once a guardian from each family says yes. Grown-ups there get a note to ask.</p>
        {homes.length === 0 && <p>There are no kids from other families here yet. An admin adds them on the Family page.</p>}
        {homes.map(({ bubble, kids: list }) => (
          <div key={bubble.id}>
            <h3 className="section-label">
              {bubble.emoji} {bubble.name}
            </h3>
            <ul className="people-pick">
              {list.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="person-chip"
                    onClick={async () => {
                      await askForFriend(kid, p, guardian, { bubbles, refreshPeople, toast });
                      onClose();
                    }}
                  >
                    <Avatar person={p} size="sm" />
                    <span>{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
