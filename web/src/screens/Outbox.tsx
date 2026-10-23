import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { ago } from '../lib/time';
import { Button, EmptyState, Field, Input, Notice, Spinner, Toggle } from '../components/ui';
import { Icon } from '../components/icons';
import { confirmFirst } from '../components/confirm';

interface Email {
  id: number;
  to: string;
  subject: string;
  body: string;
  sent_at: string;
}

/** How the app sends email, as an admin sees it. Never the password. */
interface EmailStatus {
  on: boolean;
  source: 'server' | 'app' | null;
  address: string | null;
  from: string | null;
  host: string | null;
  port: number | null;
}

/** Sending email for real: a mailbox to send from, such as a Gmail address and its app password. */
function EmailSetup() {
  const { me, toast } = useStore();
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [other, setOther] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ email: EmailStatus }>('/api/email').then((r) => setStatus(r.email), () => {});
  }, []);

  if (!status || !me.permissions.manage_people) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.put<{ email: EmailStatus }>('/api/email', { address, password, ...(other ? { host, port } : {}) });
      setStatus(r.email);
      setEditing(false);
      setPassword('');
      toast(`Sent a test email to ${me.email}. Email is on.`, 'success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!(await confirmFirst('Stop sending email?', 'Stop sending', 'Invitations and new one-time passwords will only wait here again.'))) return;
    try {
      setStatus((await api.del<{ email: EmailStatus }>('/api/email')).email);
    } catch (err) {
      toast((err as Error).message, 'danger');
    }
  }

  if (status.on && !editing) {
    return (
      <section className="panel sheet">
        <h2>Sending email</h2>
        <p>
          Email is on. Invitations and new one-time passwords go from <strong>{status.from}</strong>, and are kept here too.
        </p>
        {status.source === 'server' ? (
          <p className="muted">This server's own settings send it, so it's changed there.</p>
        ) : (
          <div className="row row-wrap">
            <Button
              size="sm"
              onClick={() => {
                setAddress(status.address ?? '');
                setEditing(true);
              }}
            >
              Change
            </Button>
            <Button size="sm" variant="ghost" onClick={turnOff}>
              Stop sending
            </Button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="panel sheet">
      <h2>Sending email</h2>
      <p>Right now emails only wait here, so people don't get their invitations unless you pass them on. To send them for real from a Gmail account:</p>
      <ol className="setup-steps">
        <li>Sign in to the Gmail account and switch on 2-Step Verification, if it isn't on.</li>
        <li>
          Make an app password at{' '}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
            myaccount.google.com/apppasswords
          </a>
          , named Kitchen Table. Google shows 16 letters.
        </li>
        <li>Put the Gmail address and those letters below. A test email comes to you first.</li>
      </ol>
      <form onSubmit={save} className="stack">
        <Field label={other ? 'Email address' : 'Gmail address'}>
          {(p) => <Input {...p} type="email" autoComplete="off" value={address} onChange={(e) => setAddress(e.target.value)} required />}
        </Field>
        <Field label={other ? 'Password' : 'App password'} hint="Kept locked away on the server. Nobody can read it back, not even admins.">
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <Toggle label="Another email provider" hint="For anything but Gmail: its email server, from its help pages." checked={other} onChange={setOther} />
        {other && (
          <div className="row row-wrap">
            <Field label="Email server">{(p) => <Input {...p} value={host} placeholder="smtp.example.com" onChange={(e) => setHost(e.target.value)} required />}</Field>
            <Field label="Port">{(p) => <Input {...p} inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />}</Field>
          </div>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="row row-wrap">
          <Button type="submit" variant="primary" icon="mail" busy={busy}>
            Save and send a test
          </Button>
          {editing && (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

/** Every email the app has sent, so an admin can pass on a password if an email goes astray. */
export function Outbox() {
  const { me } = useStore();
  const [emails, setEmails] = useState<Email[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ emails: Email[] }>('/api/outbox')
      .then((r) => setEmails(r.emails))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <a className="icon-btn btn-ghost" href="#/people" aria-label="Back to family">
          <Icon name="back" />
        </a>
        <h1>Emails sent by the app</h1>
      </header>
      {!me.permissions.manage_people && <Notice tone="warning">Only admins can see this.</Notice>}
      <EmailSetup />
      {error && <Notice tone="danger">{error}</Notice>}
      {!emails && !error && <Spinner label="Loading" />}
      {emails?.length === 0 && (
        <EmptyState art="📭" title="No emails yet">
          <p>Invitations and new one-time passwords appear here, whether or not they're emailed.</p>
        </EmptyState>
      )}
      <ul className="outbox">
        {emails?.map((e) => (
          <li key={e.id} className="panel sheet">
            <p className="outbox-to">
              To <strong>{e.to}</strong> · {ago(e.sent_at)}
            </p>
            <p className="outbox-subject">{e.subject}</p>
            <pre className="outbox-body">{e.body}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
