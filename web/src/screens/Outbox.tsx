import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { ago } from '../lib/time';
import { EmptyState, Notice, Spinner } from '../components/ui';
import { Icon } from '../components/icons';

interface Email {
  id: number;
  to: string;
  subject: string;
  body: string;
  sent_at: string;
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
      {error && <Notice tone="danger">{error}</Notice>}
      {!emails && !error && <Spinner label="Loading" />}
      {emails?.length === 0 && (
        <EmptyState art="📭" title="No emails yet">
          <p>Invitations and new one-time passwords appear here as well as being emailed.</p>
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
