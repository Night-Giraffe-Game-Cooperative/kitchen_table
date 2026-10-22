import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { ago } from '../lib/time';
import type { CalendarLink, ConnectProvider, FoundCalendar } from '../lib/types';
import { Button, Dialog, Field, Input, Notice, Segmented, Toggle } from '../components/ui';
import { errorText, useLive, usePersonOf } from './tasksShared';
import { confirmFirst } from '../components/confirm';

interface LinkData {
  links: CalendarLink[];
  can_link: boolean;
}

type Provider = 'icloud' | 'caldav' | 'ics';
type SignIn = ConnectProvider['provider'];
type Share = CalendarLink['share'];
type Step =
  | { name: 'list' }
  | { name: 'add'; provider: Provider }
  | { name: 'connect'; provider: SignIn; account?: number }
  | { name: 'setup'; provider: SignIn }
  | { name: 'pick'; account: number }
  | { name: 'settings'; link: CalendarLink };

const signInName: Record<SignIn, string> = { google: 'Google', microsoft: 'Microsoft' };

export const linkColours = ['#5b7cfa', '#ff2968', '#34aadc', '#ff9500', '#2fb36b', '#a259ff', '#8e8e93', '#d4a106'];
const colourNames = ['Blue', 'Pink', 'Sky blue', 'Orange', 'Green', 'Purple', 'Grey', 'Mustard'];

/** Where a linked calendar is, in a few words: "iCloud", "Fastmail", "calendar.google.com". */
export function linkPlace(link: Pick<CalendarLink, 'host' | 'provider'>): string {
  if (link.provider === 'google') return 'Google';
  if (link.provider === 'microsoft') return 'Outlook';
  if (/icloud\.com$/.test(link.host)) return 'iCloud';
  if (/fastmail\.com$/.test(link.host)) return 'Fastmail';
  if (/google\.com$/.test(link.host)) return 'Google';
  if (/outlook\.|office365\.com$|live\.com$/.test(link.host)) return 'Outlook';
  return link.host;
}

const shareOptions: { value: Share; label: string }[] = [
  { value: 'family', label: 'The family' },
  { value: 'me', label: 'Just me' },
];

/**
 * The calendars linked to the family calendar, and linking more. With
 * `account`, it opens on choosing the calendars of a Google or Microsoft
 * account someone has just signed in to.
 */
export function LinkedCalendarsDialog({ onClose, account }: { onClose: () => void; account?: number }) {
  const live = useLive<LinkData>('/api/calendar/links', 'calendar_changed');
  const signIns = useLive<{ providers: ConnectProvider[] }>('/api/calendar/connect', 'calendar_changed');
  const [step, setStep] = useState<Step>(account ? { name: 'pick', account } : { name: 'list' });
  const back = () => setStep({ name: 'list' });

  const done = () => {
    live.reload();
    signIns.reload();
    back();
  };

  if (step.name === 'add') return <AddDialog provider={step.provider} onBack={back} onDone={done} onClose={onClose} />;
  if (step.name === 'connect') return <ConnectDialog provider={step.provider} account={step.account} onBack={back} onClose={onClose} />;
  if (step.name === 'setup') {
    const p = signIns.data?.providers.find((x) => x.provider === step.provider);
    if (p) return <SetupDialog provider={p} onBack={back} onDone={done} onClose={onClose} />;
  }
  // Back from signing in, linking is all there was to do.
  if (step.name === 'pick') return <PickDialog account={step.account} onBack={back} onDone={account ? onClose : done} onClose={onClose} />;
  if (step.name === 'settings')
    return <SettingsDialog link={step.link} onBack={back} onDone={done} onClose={onClose} onSignIn={(provider, account) => setStep({ name: 'connect', provider, account })} />;

  const links = live.data?.links ?? [];
  const providers = signIns.data?.providers ?? [];
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title="Linked calendars"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="stack">
        {live.error && !live.data && <Notice tone="danger">{live.error}</Notice>}
        {live.data && links.length === 0 && (
          <p className="muted">
            Link a calendar you already use and its events show here, next to everything else. Add to it here and it shows on your phones too.
          </p>
        )}
        {links.length > 0 && (
          <ul className="links">
            {links.map((l) => (
              <LinkRow key={l.id} link={l} onSettings={() => setStep({ name: 'settings', link: l })} onSynced={live.reload} />
            ))}
          </ul>
        )}
        {live.data?.can_link && (
          <section className="stack-sm" aria-labelledby="link-add">
            <h3 className="section-label" id="link-add">
              Link a calendar
            </h3>
            {providers.map((p) => (
              <SignInChoice
                key={p.provider}
                provider={p}
                onPick={() => setStep(p.ready ? { name: 'connect', provider: p.provider } : { name: 'setup', provider: p.provider })}
              />
            ))}
            <button type="button" className="choice" onClick={() => setStep({ name: 'add', provider: 'icloud' })}>
              <span className="choice-art" aria-hidden="true">
                🍎
              </span>
              <span>
                <strong>iCloud</strong>
                <span className="muted">Apple's calendars on iPhones, iPads and Macs. Both ways.</span>
              </span>
            </button>
            <button type="button" className="choice" onClick={() => setStep({ name: 'add', provider: 'caldav' })}>
              <span className="choice-art" aria-hidden="true">
                🗓️
              </span>
              <span>
                <strong>Another calendar server</strong>
                <span className="muted">Fastmail, Nextcloud, Zoho, Yahoo and others that use CalDAV. Both ways.</span>
              </span>
            </button>
            <button type="button" className="choice" onClick={() => setStep({ name: 'add', provider: 'ics' })}>
              <span className="choice-art" aria-hidden="true">
                🔗
              </span>
              <span>
                <strong>A calendar's address</strong>
                <span className="muted">A school, a club or the bin days, or Google or Outlook without signing in. Shown here, changed there.</span>
              </span>
            </button>
          </section>
        )}
      </div>
    </Dialog>
  );
}

function LinkRow({ link: l, onSettings, onSynced }: { link: CalendarLink; onSettings: () => void; onSynced: () => void }) {
  const { me, toast } = useStore();
  const personOf = usePersonOf();
  const [busy, setBusy] = useState(false);
  const owner = l.user_id === me.id ? 'you' : (personOf(l.user_id)?.name ?? 'someone');
  const about = [
    linkPlace(l),
    l.writable ? 'both ways' : 'shown here',
    l.share === 'me' ? 'only you see it' : `linked by ${owner}`,
    l.default && 'new events go here',
  ]
    .filter(Boolean)
    .join(' · ');

  async function sync() {
    setBusy(true);
    try {
      await api.post(`/api/calendar/links/${l.id}/sync`);
      toast(`${l.name} is up to date.`, 'success');
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setBusy(false);
      onSynced();
    }
  }

  return (
    <li className="link-row">
      <span className="link-dot" style={{ background: l.color }} aria-hidden="true" />
      <span className="link-text">
        <strong>{l.name}</strong>
        <span className="muted">{about}</span>
        {l.last_error ? (
          <span className="link-error">{l.last_error}</span>
        ) : (
          <span className="muted">{l.last_synced_at ? `Last checked ${ago(l.last_synced_at)}` : 'Not checked yet'}</span>
        )}
      </span>
      <span className="link-actions">
        <Button size="sm" variant="ghost" icon="refresh" busy={busy} onClick={sync} aria-label={`Check ${l.name} now`} data-tip={`Check ${l.name} now`} />
        {l.can_manage && (
          <Button size="sm" icon="pen" onClick={onSettings} aria-label={`Change ${l.name}`}>
            Change
          </Button>
        )}
      </span>
    </li>
  );
}

function AddDialog({ provider, onBack, onDone, onClose }: { provider: Provider; onBack: () => void; onDone: () => void; onClose: () => void }) {
  const { toast } = useStore();
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  // Typed by the person linking, sent with each request, never kept here.
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [share, setShare] = useState<Share>('family');
  const [found, setFound] = useState<FoundCalendar[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const icloud = provider === 'icloud';
  const feed = provider === 'ics';
  const account = { provider, url, username: username.trim(), password };

  async function find(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<{ calendars: FoundCalendar[] }>('/api/calendar/links/discover', account);
      setFound(r.calendars);
      setChosen(r.calendars.filter((c) => c.writable).map((c) => c.url).slice(0, 1));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function link(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!feed && chosen.length === 0) return setError('Choose at least one calendar.');
    setBusy(true);
    try {
      const body = feed ? { provider, url, name: name.trim(), share } : { ...account, share, calendars: chosen.map((u) => ({ url: u })) };
      const r = await api.post<{ links: CalendarLink[] }>('/api/calendar/links', body);
      toast(r.links.length === 1 ? `${r.links[0].name} is linked.` : `${r.links.length} calendars are linked.`, 'success');
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const title = icloud ? 'Link iCloud' : feed ? "Link a calendar's address" : 'Link a calendar server';
  const picking = !feed && found !== null;
  const formId = 'link-form';

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={picking ? () => setFound(null) : onBack}>Back</Button>
          <Button variant="primary" type="submit" form={formId} busy={busy}>
            {feed || picking ? 'Link' : 'Find calendars'}
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={feed || picking ? link : find}>
        {feed && (
          <>
            <p className="muted">Events from the address show here and stay up to date. Change them where the calendar is kept.</p>
            <Field
              label="The calendar's address"
              hint={
                <>
                  Google Calendar: the calendar's settings, then <em>Secret address in iCal format</em>. Outlook: Settings, Calendar, Shared
                  calendars, then publish it and copy the ICS link. Schools and clubs often have a <em>Subscribe</em> link.
                </>
              }
            >
              {(p) => <Input {...p} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="webcal://… or https://….ics" inputMode="url" spellCheck={false} autoFocus required />}
            </Field>
            <Field label="Name" hint="Leave empty to use the calendar's own name.">
              {(p) => <Input {...p} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="School" />}
            </Field>
          </>
        )}

        {!feed && !picking && (
          <>
            {icloud ? (
              <Notice tone="info">
                Apple asks apps like this one for an app-specific password rather than your Apple ID password. Make one at{' '}
                <a href="https://account.apple.com/account/manage" target="_blank" rel="noreferrer">
                  account.apple.com
                </a>{' '}
                under <em>Sign-In and Security</em>, then <em>App-Specific Passwords</em>, and paste it here.
              </Notice>
            ) : (
              <Field label="Server address" hint="Your calendar provider's CalDAV address, such as caldav.fastmail.com or your Nextcloud's address.">
                {(p) => <Input {...p} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="caldav.example.com" inputMode="url" spellCheck={false} autoFocus required />}
              </Field>
            )}
            <Field label={icloud ? 'Apple ID email' : 'Username'}>
              {(p) => (
                <Input
                  {...p}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  inputMode={icloud ? 'email' : undefined}
                  autoFocus={icloud}
                  required
                />
              )}
            </Field>
            <Field label={icloud ? 'App-specific password' : 'Password'} hint="Kept locked away on the server, and only used to reach this calendar.">
              {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />}
            </Field>
          </>
        )}

        {picking && found && <FoundList found={found} chosen={chosen} onChange={setChosen} />}

        {(feed || picking) && <WhoSees share={share} onChange={setShare} feed={feed} />}
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Dialog>
  );
}

/** The calendars an account has, to tick the ones to link. */
function FoundList({ found, chosen, onChange }: { found: FoundCalendar[]; chosen: string[]; onChange: (chosen: string[]) => void }) {
  return (
    <fieldset className="fieldset">
      <legend>Which calendars</legend>
      <ul className="found-list">
        {found.map((c) => {
          const on = chosen.includes(c.url);
          return (
            <li key={c.url}>
              <button type="button" role="checkbox" aria-checked={on} className="found" onClick={() => onChange(on ? chosen.filter((u) => u !== c.url) : [...chosen, c.url])}>
                <span className="link-dot" style={{ background: c.color ?? linkColours[0] }} aria-hidden="true" />
                <span className="link-text">
                  <strong>{c.name}</strong>
                  <span className="muted">{c.writable ? 'Both ways' : 'Shown here only'}</span>
                </span>
                <span className="found-box" aria-hidden="true">
                  ✓
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function WhoSees({ share, onChange, feed = false }: { share: Share; onChange: (share: Share) => void; feed?: boolean }) {
  return (
    <fieldset className="fieldset">
      <legend>Who sees it</legend>
      <Segmented label="Who sees it" value={share} options={shareOptions} onChange={onChange} />
      <p className="field-hint">
        {share === 'family'
          ? `Everyone who sees the family calendar sees these events${feed ? '' : ', and grown-ups can add to it'}.`
          : 'Only you see these events, here. Nobody else in the family does, admins included.'}
      </p>
    </fieldset>
  );
}

const signInArt: Record<SignIn, string> = { google: '📆', microsoft: '📨' };
const signInAbout: Record<SignIn, { title: string; about: string }> = {
  google: { title: 'Google', about: 'Google Calendar, on Android phones and the web. Both ways, once you sign in.' },
  microsoft: { title: 'Outlook', about: 'Outlook.com, Hotmail and Microsoft 365. Both ways, once you sign in.' },
};

/** Google or Outlook in the list of ways to link. Until an admin sets it up, it says so. */
function SignInChoice({ provider: p, onPick }: { provider: ConnectProvider; onPick: () => void }) {
  const { title, about } = signInAbout[p.provider];
  const waiting = !p.ready && !p.can_setup;
  return (
    <button type="button" className="choice" onClick={onPick} disabled={waiting} aria-describedby={waiting ? `${p.provider}-waiting` : undefined}>
      <span className="choice-art" aria-hidden="true">
        {signInArt[p.provider]}
      </span>
      <span>
        <strong>{title}</strong>
        <span className="muted">{about}</span>
        {!p.ready && (
          <span className="muted" id={`${p.provider}-waiting`}>
            {p.can_setup ? `Set up signing in to ${signInName[p.provider]} first. It takes a few minutes, once.` : `An admin needs to set this up first.`}
          </span>
        )}
      </span>
    </button>
  );
}

/** Off to Google or Microsoft to sign in and say yes; they send you back to choose calendars. */
function ConnectDialog({ provider, account, onBack, onClose }: { provider: SignIn; account?: number; onBack: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = signInName[provider];

  async function go() {
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<{ url: string }>(`/api/calendar/connect/${provider}/start`, account ? { account } : {});
      window.location.assign(r.url);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={account ? `Sign in to ${name} again` : `Link ${provider === 'google' ? 'Google' : 'Outlook'} calendars`}
      footer={
        <>
          <Button onClick={onBack}>Back</Button>
          <Button variant="primary" busy={busy} onClick={go}>
            Continue to {name}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p>
          You'll go to {name} to sign in and say yes to Kitchen Table seeing and changing your calendars' events. Then you'll come back here to choose which
          calendars to link.
        </p>
        {provider === 'google' && (
          <Notice tone="info">
            Google may say it hasn't checked this app. It's your family's own, so choose <em>Advanced</em>, then <em>Go to Kitchen Table</em>.
          </Notice>
        )}
        <p className="muted">If you come back signed out, open Kitchen Table in your phone's or computer's browser, sign in, and link it there.</p>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Dialog>
  );
}

interface AccountCalendars {
  account: { id: number; provider: SignIn; email: string | null };
  calendars: FoundCalendar[];
}

/** Choosing which of a signed-in account's calendars to link, and who sees them. */
function PickDialog({ account, onBack, onDone, onClose }: { account: number; onBack: () => void; onDone: () => void; onClose: () => void }) {
  const { toast } = useStore();
  const [data, setData] = useState<AccountCalendars | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [share, setShare] = useState<Share>('family');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    api
      .get<AccountCalendars>(`/api/calendar/accounts/${account}/calendars`)
      .then((r) => {
        if (!on) return;
        setData(r);
        setChosen(r.calendars.filter((c) => c.writable).map((c) => c.url).slice(0, 1));
      })
      .catch((err) => on && setError(errorText(err)));
    return () => {
      on = false;
    };
  }, [account]);

  async function link(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setError(null);
    if (chosen.length === 0) return setError('Choose at least one calendar.');
    setBusy(true);
    try {
      const r = await api.post<{ links: CalendarLink[] }>('/api/calendar/links', {
        provider: data.account.provider,
        account,
        share,
        calendars: chosen.map((u) => ({ url: u })),
      });
      toast(r.links.length === 1 ? `${r.links[0].name} is linked.` : `${r.links.length} calendars are linked.`, 'success');
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const name = data ? signInName[data.account.provider] : null;
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={data ? `Link ${data.account.provider === 'google' ? 'Google' : 'Outlook'} calendars` : 'Link calendars'}
      footer={
        <>
          <Button onClick={onBack}>Back</Button>
          <Button variant="primary" type="submit" form="pick-form" busy={busy} disabled={!data}>
            Link
          </Button>
        </>
      }
    >
      <form id="pick-form" className="stack" onSubmit={link}>
        {!data && !error && <p className="muted">Looking for the calendars…</p>}
        {data && (
          <>
            <p className="muted">
              Signed in to {name}
              {data.account.email ? ` as ${data.account.email}` : ''}.
            </p>
            <FoundList found={data.calendars} chosen={chosen} onChange={setChosen} />
            <WhoSees share={share} onChange={setShare} />
          </>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Dialog>
  );
}

/**
 * For admins: pasting in the app registered with Google or Microsoft, which
 * the whole family's sign-ins go through. Done once.
 */
function SetupDialog({ provider: p, onBack, onDone, onClose }: { provider: ConnectProvider; onBack: () => void; onDone: () => void; onClose: () => void }) {
  const { toast } = useStore();
  const [clientId, setClientId] = useState(p.client_id ?? '');
  // Typed by the admin, sent once, never kept here.
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const google = p.provider === 'google';
  const name = signInName[p.provider];

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.put(`/api/calendar/connect/${p.provider}`, { client_id: clientId.trim(), client_secret: secret.trim() });
      toast(`Signing in to ${name} is set up.`, 'success');
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirmFirst(`Stop signing in to ${name}?`, 'Stop', `Calendars already linked through ${name} stop updating until it's set up again.`))) return;
    setBusy(true);
    try {
      await api.del(`/api/calendar/connect/${p.provider}`);
      toast(`Signing in to ${name} is off.`, 'success');
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={`Set up signing in to ${name}`}
      footer={
        <>
          {p.ready && (
            <Button variant="danger" icon="trash" onClick={remove} disabled={busy} className="foot-start">
              Stop
            </Button>
          )}
          <Button onClick={onBack}>Back</Button>
          <Button variant="primary" type="submit" form="setup-form" busy={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="setup-form" className="stack" onSubmit={save}>
        <p>
          {name} lets an app sign people in once the app is registered with {name}. It's free, it's in your name, and it's done once for the whole family.
        </p>
        <ol className="setup-steps">
          {google ? (
            <>
              <li>
                At{' '}
                <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
                  console.cloud.google.com
                </a>
                , make a project and turn on the <em>Google Calendar API</em>.
              </li>
              <li>
                Under <em>Google Auth Platform</em>, give the app a name and choose <em>External</em>. Under <em>Data access</em>, add the{' '}
                <em>calendar.events</em> and <em>calendar.calendarlist.readonly</em> scopes. Under <em>Audience</em>, choose <em>Publish app</em>, or
                Google signs people out after a week.
              </li>
              <li>
                Under <em>Clients</em>, create a <em>Web application</em> client with the address below as its <em>Authorized redirect URI</em>.
              </li>
            </>
          ) : (
            <>
              <li>
                At{' '}
                <a href="https://entra.microsoft.com/" target="_blank" rel="noreferrer">
                  entra.microsoft.com
                </a>
                , under <em>App registrations</em>, make a new registration for <em>any organisation and personal Microsoft accounts</em>.
              </li>
              <li>
                Give it the address below as a <em>Web</em> redirect URI, and under <em>API permissions</em> add Microsoft Graph's <em>Calendars.ReadWrite</em>.
              </li>
              <li>
                Under <em>Certificates &amp; secrets</em>, make a client secret. It runs out after up to two years, so put a new one in here before then.
              </li>
            </>
          )}
          <li>Paste its client ID and secret here.</li>
        </ol>
        {p.redirect_uri && (
          <Field label="Redirect address" hint={`Give ${name} exactly this.`}>
            {(f) => (
              <div className="row copy-row">
                <Input {...f} value={p.redirect_uri} readOnly spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
                <Button
                  size="sm"
                  icon={copied ? 'check' : 'copy'}
                  onClick={() => navigator.clipboard?.writeText(p.redirect_uri ?? '').then(() => setCopied(true), () => {})}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            )}
          </Field>
        )}
        <Field label={google ? 'Client ID' : 'Application (client) ID'}>
          {(f) => <Input {...f} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} required />}
        </Field>
        <Field label="Client secret" hint={p.ready ? 'Saved and locked away. Leave empty to keep it.' : 'Kept locked away on the server.'}>
          {(f) => <Input {...f} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" required={!p.ready} />}
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Dialog>
  );
}

function SettingsDialog({
  link,
  onBack,
  onDone,
  onClose,
  onSignIn,
}: {
  link: CalendarLink;
  onBack: () => void;
  onDone: () => void;
  onClose: () => void;
  onSignIn: (provider: SignIn, account: number) => void;
}) {
  const { me, toast } = useStore();
  const mine = link.user_id === me.id;
  const [name, setName] = useState(link.name);
  const [color, setColor] = useState(link.color);
  const [share, setShare] = useState<Share>(link.share);
  const [isDefault, setDefault] = useState(link.default);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/api/calendar/links/${link.id}`, { name: name.trim(), color, share, default: isDefault, ...(password ? { password } : {}) });
      toast('Saved.', 'success');
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function unlink() {
    if (!(await confirmFirst(`Unlink ${link.name}?`, 'Unlink', `Its events stay in ${linkPlace(link)}, but leave the family calendar.`))) return;
    setBusy(true);
    try {
      await api.del(`/api/calendar/links/${link.id}`);
      toast('Unlinked.', 'success');
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Change ${link.name}`}
      footer={
        <>
          <Button variant="danger" icon="trash" onClick={unlink} disabled={busy} className="foot-start">
            Unlink
          </Button>
          <Button onClick={onBack}>Back</Button>
          <Button variant="primary" type="submit" form="link-settings" busy={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="link-settings" className="stack" onSubmit={save}>
        <p className="muted">
          {linkPlace(link)}
          {link.username ? `, signed in as ${link.username}` : ''}.
        </p>
        <Field label="Name">{(p) => <Input {...p} value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />}</Field>
        <fieldset className="fieldset">
          <legend>Colour</legend>
          <div className="colour-pick">
            {(linkColours.includes(color) ? linkColours : [color, ...linkColours]).map((c) => (
              <button key={c} type="button" className="colour-option" style={{ background: c }} aria-pressed={color === c} aria-label={colourNames[linkColours.indexOf(c)] ?? "The calendar's own colour"} onClick={() => setColor(c)} />
            ))}
          </div>
        </fieldset>
        {mine && (
          <fieldset className="fieldset">
            <legend>Who sees it</legend>
            <Segmented label="Who sees it" value={share} options={shareOptions} onChange={setShare} />
          </fieldset>
        )}
        {link.writable && share === 'family' && (
          <Toggle label="New events go here" hint="When someone adds to the family calendar, unless they choose another." checked={isDefault} onChange={setDefault} />
        )}
        {mine && link.account_id && (link.provider === 'google' || link.provider === 'microsoft') && (
          <div className="stack-sm">
            <p className="field-hint">If {signInName[link.provider]} stops letting Kitchen Table in, sign in again. Everything stays linked.</p>
            <Button icon="refresh" onClick={() => onSignIn(link.provider as SignIn, link.account_id!)}>
              Sign in to {signInName[link.provider]} again
            </Button>
          </div>
        )}
        {mine && link.provider === 'caldav' && (
          <Field label="New password" hint="Only if it's changed. For iCloud, a new app-specific password.">
            {(p) => <Input {...p} type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />}
          </Field>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Dialog>
  );
}
