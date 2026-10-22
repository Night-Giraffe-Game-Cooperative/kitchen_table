import { useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import type { Me } from '../lib/types';
import { Button, Field, Input, Notice } from '../components/ui';

function AuthLayout({ appName, children }: { appName: string; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-brand">
        <img src="/icons/icon-192.png" alt="" width={72} height={72} className="auth-logo" />
        <p className="auth-name">{appName}</p>
      </div>
      <div className="auth-card sheet">{children}</div>
      <a className="auth-privacy" href="/privacy">
        Privacy
      </a>
    </main>
  );
}

function errorText(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.';
}

export function Setup({ appName, needsCode, onDone }: { appName: string; needsCode: boolean; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/setup', { name, email, password, avatar: '🦒', setup_code: needsCode ? code : undefined });
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout appName={appName}>
      <h1>Set up your family's table</h1>
      <p className="lede">You'll be the first admin. Once you're in, you can add everyone else by email.</p>
      <form onSubmit={submit} className="stack">
        {needsCode && (
          <Field label="Setup code" hint="Whoever put Kitchen Table online has it. It's also in the server's log.">
            {(p) => (
              <Input
                {...p}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            )}
          </Field>
        )}
        <Field label="Your name">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required />}
        </Field>
        <Field label="Email">
          {(p) => (
            <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          )}
        </Field>
        <Field label="Password" hint="At least 8 characters. A short sentence is easy to remember.">
          {(p) => (
            <Input
              {...p}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          )}
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" wide busy={busy}>
          Set up the family
        </Button>
      </form>
    </AuthLayout>
  );
}

export function SignIn({ appName, onDone }: { appName: string; onDone: (password: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ me: Me }>('/api/session', { email, password });
      onDone(res.me.must_change_password ? password : '');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout appName={appName}>
      <h1>Sign in</h1>
      <form onSubmit={submit} className="stack">
        <Field label="Email">
          {(p) => (
            <Input
              {...p}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              required
            />
          )}
        </Field>
        <Field label="Password" hint="New here? Use the one-time password from your invitation email.">
          {(p) => (
            <Input
              {...p}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoCapitalize="none"
              required
            />
          )}
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" wide busy={busy}>
          Sign in
        </Button>
      </form>
      <p className="auth-foot">Forgotten your password? Ask a family admin for a new one-time password.</p>
    </AuthLayout>
  );
}

export function ChangePassword({
  me,
  appName,
  current: given,
  onDone,
  onSignOut,
}: {
  me: Me;
  appName: string;
  current?: string;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const [current, setCurrent] = useState(given ?? '');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && again !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== again) return setError("The two new passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/me/password', { current, new: password });
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout appName={appName}>
      <h1>Hello {me.name}, choose your own password</h1>
      <p className="lede">Your one-time password only works once. Pick a password you'll remember.</p>
      <form onSubmit={submit} className="stack">
        {!given && (
          <Field label="One-time password">
            {(p) => (
              <Input
                {...p}
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                autoCapitalize="none"
                required
              />
            )}
          </Field>
        )}
        <Field label="New password" hint="At least 8 characters. A short sentence is easy to remember.">
          {(p) => (
            <Input
              {...p}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          )}
        </Field>
        <Field label="New password again" error={mismatch ? "These don't match yet." : null}>
          {(p) => (
            <Input
              {...p}
              type="password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              autoComplete="new-password"
              required
            />
          )}
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" wide busy={busy}>
          Save my password
        </Button>
      </form>
      <p className="auth-foot">
        Not {me.name}?{' '}
        <button type="button" className="link" onClick={onSignOut}>
          Sign out
        </button>
      </p>
    </AuthLayout>
  );
}
