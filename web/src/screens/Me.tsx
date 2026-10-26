import { useEffect, useState, type FormEvent } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { permissionText, whoCanChange } from '../lib/permissions';
import { androidApp, appNotifier, disablePush, enablePush, pushState, testPush, thisDevice, type PushDevice, type PushState } from '../lib/push';
import { ago } from '../lib/time';
import type { Colour, Me } from '../lib/types';
import { Avatar, Button, Dialog, Field, Input, Notice, RoleBadge, Segmented, Toggle } from '../components/ui';
import { Icon } from '../components/icons';
import { avatars, ColourPicker } from './People';

type Scheme = 'device' | 'light' | 'dark';

function applyScheme(s: Scheme) {
  const dark = s === 'dark' || (s === 'device' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.scheme = dark ? 'dark' : 'light';
}

function stored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* fine */
  }
}

export function MePage() {
  const { me, signOut } = useStore();
  return (
    <div className="page me">
      <header className="page-head">
        <h1>Me</h1>
      </header>
      <Profile />
      <Appearance />
      <Notifications />
      <Abilities me={me} />
      {/* Kids without an email sign in with a code, so they have no password. */}
      {!me.no_email && <Password />}
      <Install />
      <YourData />
      <div className="row">
        <Button icon="logout" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

function Profile() {
  const { me, setMe, colours, toast } = useStore();
  const [name, setName] = useState(me.name);
  const [avatar, setAvatar] = useState(me.avatar);
  const [colour, setColour] = useState<Colour>(me.colour);
  const [busy, setBusy] = useState(false);
  const changed = name !== me.name || avatar !== me.avatar || colour !== me.colour;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.patch<{ me: Me }>('/api/me', { name, avatar, colour });
      setMe(res.me);
      toast('Saved.', 'success');
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel sheet">
      <div className="person-hero person-hero-flat">
        <Avatar person={{ name, avatar, colour }} size="xl" />
        <div>
          <p className="person-name">{name || me.name}</p>
          <p className="muted">
            <RoleBadge role={me.role} /> {me.email}
          </p>
        </div>
      </div>
      <form className="stack" onSubmit={save}>
        <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />}</Field>
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
        <div className="row">
          <Button type="submit" variant="primary" busy={busy} disabled={!changed}>
            Save
          </Button>
        </div>
      </form>
    </section>
  );
}

function Appearance() {
  const [scheme, setScheme] = useState<Scheme>(() => stored('scheme', 'device') as Scheme);
  const [big, setBig] = useState(() => stored('text', 'normal') === 'large');

  useEffect(() => {
    store('scheme', scheme);
    applyScheme(scheme);
    if (scheme !== 'device') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyScheme('device');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [scheme]);

  useEffect(() => {
    store('text', big ? 'large' : 'normal');
    document.documentElement.dataset.text = big ? 'large' : 'normal';
  }, [big]);

  return (
    <section className="panel sheet">
      <h2>Appearance</h2>
      <div className="field">
        <span className="field-label">Colours</span>
        <Segmented
          label="Colours"
          value={scheme}
          onChange={setScheme}
          options={[
            { value: 'light', label: 'Light', icon: 'sun' },
            { value: 'dark', label: 'Dark', icon: 'moon' },
            { value: 'device', label: 'Like my device', icon: 'device' },
          ]}
        />
      </div>
      <Toggle label="Bigger text" hint="Makes everything a little larger on this device." checked={big} onChange={setBig} />
    </section>
  );
}

function Notifications() {
  const { me, toast } = useStore();
  const [state, setState] = useState<PushState | null>(null);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [mine, setMine] = useState<PushDevice | undefined>();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const app = appNotifier();

  useEffect(() => {
    pushState().then(setState, () => setState('unsupported'));
    api.get<{ devices: PushDevice[] }>('/api/push').then((r) => setDevices(r.devices), () => {});
  }, []);

  // In the Android app, coming back from its settings may have changed things.
  useEffect(() => {
    if (!app) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') pushState().then(setState, () => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [app]);

  useEffect(() => {
    thisDevice(devices).then(setMine, () => setMine(undefined));
  }, [devices, state]);

  async function change(on: boolean) {
    setBusy(true);
    try {
      if (on) {
        setDevices(await enablePush());
        toast('Notifications are on for this device.', 'success');
      } else {
        const left = await disablePush();
        if (left) setDevices(left);
      }
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setState(await pushState().catch(() => 'unsupported' as const));
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      await testPush();
      toast('Sent. It should pop up in a moment.', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setTesting(false);
    }
  }

  async function remove(id: number) {
    try {
      setDevices((await api.del<{ devices: PushDevice[] }>(`/api/push/devices/${id}`)).devices);
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  const others = devices.filter((d) => d.id !== mine?.id);

  return (
    <section className="panel sheet">
      <h2>Notifications</h2>
      {state === 'unsupported' && !androidApp() && <p className="muted">This browser can't show notifications from the app.</p>}
      {state === 'unsupported' && androidApp() && (
        <Notice>
          <p>
            This version of the Kitchen Table app can't show notifications. The newest one can, so ask whoever set it up to update it. Or open Kitchen Table in
            Chrome, choose <strong>Install app</strong> from Chrome's ⋮ menu, and switch notifications on under Me there.
          </p>
          {androidApp()! >= 1.1 && (
            <a className="btn btn-secondary btn-sm" href={`${window.location.origin}/?open=browser#/me`}>
              Open in Chrome
            </a>
          )}
        </Notice>
      )}
      {state === 'install-first' && (
        <Notice>
          On iPhone and iPad, notifications need the app on your Home Screen. In Safari, tap Share, then <strong>Add to Home Screen</strong>, open Kitchen
          Table from there and switch them on here.
        </Notice>
      )}
      {state === 'blocked' && !app && <Notice tone="warning">Notifications are blocked for this site. Allow them in the browser's site settings, then come back here.</Notice>}
      {state === 'blocked' && app && (
        <Notice tone="warning">
          <p>Notifications are switched off for Kitchen Table in this device's settings. Allow them there, then come back here.</p>
          <Button size="sm" onClick={() => app.settings()}>
            Open settings
          </Button>
        </Notice>
      )}
      {(state === 'on' || state === 'off') && (
        <Toggle
          label="On this device"
          hint={
            app
              ? "New messages, calls and your turn in a game pop up when you're not using the app. It checks every minute or so while it's in the background, and every 15 minutes or so once it's closed."
              : "New messages, calls and your turn in a game pop up while the app is closed. Nothing pops up while you're using it."
          }
          checked={state === 'on'}
          onChange={change}
          disabled={busy}
        />
      )}
      {state === 'on' && (
        <div className="row">
          <Button icon="bell" busy={testing} onClick={test}>
            Send a test
          </Button>
        </div>
      )}
      {others.length > 0 && (
        <div className="stack-sm">
          <h3 className="field-label">Also on</h3>
          <ul className="devices">
            {others.map((d) => (
              <li key={d.id}>
                <span>
                  {d.device ?? 'Another device'}
                  <span className="muted"> · last used {ago(d.last_used_at ?? d.since)}</span>
                </span>
                <Button size="sm" variant="ghost" aria-label={`Switch off ${d.device ?? 'another device'}`} onClick={() => remove(d.id)}>
                  Switch off
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(state === 'on' || devices.length > 0) && (
        <>
          <DaySummary kind="morning" />
          <DaySummary kind="evening" />
        </>
      )}
      <p className="muted">
        {me.quiet_hours ? `Quiet hours keep your devices quiet from ${me.quiet_hours.from} to ${me.quiet_hours.to}. ` : ''}
        To mute one chat, tap the bell at the top of it.
      </p>
    </section>
  );
}

const summaries = {
  morning: {
    label: 'Morning summary',
    time: 'Morning time',
    usual: '07:00',
    kid: "What's on today, your jobs and homework due, each morning. Tap it to see Today.",
    grownup:
      "What's on today, what the family needs to remember, homework due and jobs, each morning. Tap it to see Today. Days with nothing on stay quiet.",
  },
  evening: {
    label: 'Evening summary',
    time: 'Evening time',
    usual: '20:00',
    kid: "What's on tomorrow and homework due, the evening before, so bags get packed tonight.",
    grownup:
      "What's on tomorrow, what to remember and homework due, the evening before, so kit and forms are ready. Tap it to see Today. Quiet days stay quiet.",
  },
} as const;

/** The day summaries: what's on, what to remember and homework due, at a time each person chooses. */
function DaySummary({ kind }: { kind: keyof typeof summaries }) {
  const { me, setMe, toast } = useStore();
  const text = summaries[kind];
  const [time, setTime] = useState(me[kind] ?? text.usual);
  const [busy, setBusy] = useState(false);

  async function save(value: string) {
    setBusy(true);
    try {
      setMe((await api.patch<{ me: Me }>('/api/me', { [kind]: value })).me);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <hr className="rule" />
      <Toggle
        label={text.label}
        hint={me.role === 'kid' ? text.kid : text.grownup}
        checked={me[kind] !== null}
        onChange={(on) => save(on ? time : 'off')}
        disabled={busy}
      />
      {me[kind] !== null && (
        <div className="row row-wrap">
          <Field label={text.time}>
            {(p) => (
              <Input
                {...p}
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                onBlur={() => time && time !== me[kind] && save(time)}
              />
            )}
          </Field>
        </div>
      )}
    </>
  );
}

function Abilities({ me }: { me: Me }) {
  if (me.role === 'admin') return null;
  const off = permissionText.filter((p) => !me.permissions[p.key] && p.key !== 'manage_kids');
  return (
    <section className="panel sheet">
      <h2>What you can do</h2>
      <ul className="abilities">
        {permissionText
          .filter((p) => me.permissions[p.key])
          .map((p) => (
            <li key={p.key}>
              <Icon name="check" size={18} /> {p.label}
            </li>
          ))}
      </ul>
      {off.length > 0 && <p className="muted">Switched off for you: {off.map((p) => p.label.toLowerCase()).join(', ')}. {whoCanChange(me.role)} can change this.</p>}
      {me.quiet_hours && (
        <p className="muted">
          <Icon name="clock" size={16} /> Quiet hours: {me.quiet_hours.from} to {me.quiet_hours.to}.
        </p>
      )}
    </section>
  );
}

function Password() {
  const { toast } = useStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (next !== again) return setError("The two new passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/me/password', { current, new: next });
      setCurrent('');
      setNext('');
      setAgain('');
      toast('Your password has changed.', 'success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel sheet">
      <h2>Password</h2>
      <form className="stack" onSubmit={save}>
        <Field label="Current password">
          {(p) => <Input {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}
        </Field>
        <Field label="New password" hint="At least 8 characters. A short sentence is easy to remember.">
          {(p) => <Input {...p} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />}
        </Field>
        <Field label="New password again">
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />}
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="row">
          <Button type="submit" variant="primary" busy={busy}>
            Save new password
          </Button>
        </div>
      </form>
    </section>
  );
}

function YourData() {
  const { me, signOut } = useStore();
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.del('/api/me', { password });
      await signOut();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="panel sheet">
      <h2>Your things</h2>
      <p className="muted">
        A zip of everything the app keeps about you: your messages, photos and doodles, calendar, tasks and rewards.{' '}
        <a href="/privacy">How the app looks after them</a>
      </p>
      <div className="row row-wrap">
        <a className="btn btn-secondary btn-md" href="/api/export/me" download>
          <Icon name="download" size={20} />
          <span>Download my things</span>
        </a>
        {me.role !== 'kid' && (
          <Button variant="ghost" icon="trash" onClick={() => setDeleting(true)}>
            Delete my account
          </Button>
        )}
      </div>
      {me.role === 'kid' && <p className="muted">To delete your account, ask your guardian.</p>}
      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete your account?"
        size="sm"
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="danger" type="submit" form="delete-me" busy={busy} disabled={!password}>
              Delete for good
            </Button>
          </>
        }
      >
        <form id="delete-me" className="stack" onSubmit={remove}>
          <p>
            Your messages, photos and doodles, ticks and rewards, and the calendars you linked go for good, and you're signed out everywhere. Events
            you added and games you played stay for the family, without your name. This can't be undone, so download your things first if you'd like
            to keep them.
          </p>
          <Field label="Your password">
            {(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
        </form>
      </Dialog>
    </section>
  );
}

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

function Install() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);

  if (standalone) return null;

  return (
    <section className="panel sheet">
      <h2>Put it on your home screen</h2>
      {prompt ? (
        <>
          <p className="muted">It opens like an app, full screen, and always has the newest version.</p>
          <Button variant="primary" icon="plus" onClick={() => prompt.prompt().then(() => setPrompt(null))}>
            Add to home screen
          </Button>
        </>
      ) : ios ? (
        <p className="muted">
          In Safari, tap the Share button, then <strong>Add to Home Screen</strong>. It then opens like an app and always has the newest version.
        </p>
      ) : (
        <p className="muted">
          In Chrome, open the menu (⋮) and choose <strong>Add to home screen</strong> or <strong>Install app</strong>. It then opens like an app and
          always has the newest version.
        </p>
      )}
    </section>
  );
}
