import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './lib/api';
import { StoreProvider } from './lib/store';
import type { Me } from './lib/types';
import { Setup, SignIn, ChangePassword } from './screens/Auth';
import { Shell } from './screens/Shell';
import { Button, Spinner } from './components/ui';

interface Session {
  me: Me;
  socket_token: string;
  app_name: string;
  reactions: string[];
  colours: string[];
  ice_servers?: RTCIceServer[];
  https_port?: number | null;
}

type Boot =
  | { kind: 'loading' }
  | { kind: 'offline'; message: string }
  | { kind: 'setup'; appName: string; needsCode: boolean }
  | { kind: 'signin'; appName: string }
  | { kind: 'change'; session: Session; current?: string }
  | { kind: 'ready'; session: Session };

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [appName, setAppName] = useState('Kitchen Table');

  const load = useCallback(async (current?: string) => {
    try {
      const setup = await api.get<{ needed: boolean; code?: boolean; app_name: string }>('/api/setup');
      setAppName(setup.app_name);
      if (setup.needed) return setBoot({ kind: 'setup', appName: setup.app_name, needsCode: !!setup.code });
      const session = await api.get<Session>('/api/me');
      if (session.me.must_change_password) setBoot({ kind: 'change', session, current });
      else setBoot({ kind: 'ready', session });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setBoot({ kind: 'signin', appName });
      else setBoot({ kind: 'offline', message: e instanceof Error ? e.message : 'Something went wrong.' });
    }
  }, [appName]);

  useEffect(() => {
    load();
    // Only on first load.
  }, []);

  const signedOut = useCallback(() => {
    setBoot({ kind: 'signin', appName });
    window.location.hash = '';
  }, [appName]);

  switch (boot.kind) {
    case 'loading':
      return (
        <div className="boot">
          <Spinner label="Loading" />
        </div>
      );
    case 'offline':
      return (
        <div className="boot">
          <div className="auth-card sheet">
            <h1>Can't reach the family server</h1>
            <p>Check the Wi-Fi, then tap Try again.</p>
            <Button variant="primary" icon="refresh" onClick={() => load()}>
              Try again
            </Button>
          </div>
        </div>
      );
    case 'setup':
      return <Setup appName={boot.appName} needsCode={boot.needsCode} onDone={() => load()} />;
    case 'signin':
      return <SignIn appName={boot.appName} onDone={(password) => load(password)} />;
    case 'change':
      return (
        <ChangePassword
          me={boot.session.me}
          appName={boot.session.app_name}
          current={boot.current}
          onDone={() => load()}
          onSignOut={async () => {
            await api.del('/api/session').catch(() => {});
            signedOut();
          }}
        />
      );
    case 'ready':
      return (
        <StoreProvider session={boot.session} onSignedOut={signedOut}>
          <Shell />
        </StoreProvider>
      );
  }
}
