import { useEffect } from 'react';
import { useStore, type Toast } from '../lib/store';
import { href, useRoute, type Route } from '../lib/router';
import { Icon, type IconName } from '../components/icons';
import { Avatar } from '../components/ui';
import { Chats } from './Chats';
import { GamesHub } from './Games';
import { Learn } from './Learn';
import { CalendarScreen, seesCalendar } from './Calendar';
import { switchedOffBy } from '../lib/permissions';
import { People } from './People';
import { Outbox } from './Outbox';
import { MePage } from './Me';
import { isMyTurn } from '../games/registry';
import { CallScreen } from './Call';
import { IncomingCall } from '../components/IncomingCall';
import { TipLayer } from '../components/tips';
import { ConfirmHost } from '../components/confirm';
import { waitingOnMe } from '../lib/contacts';

export function Shell() {
  const route = useRoute();
  const { me, appName, rooms, games, bubbles, people, friendships, connected, toasts, dismissToast } = useStore();

  const unread = rooms.reduce((n, r) => n + r.unread, 0);
  const myTurns = games.filter((g) => isMyTurn(g, me.id)).length;
  const askingMe = waitingOnMe(me, friendships, people).length;
  const detail = (route.name === 'chats' && route.roomId) || (route.name === 'games' && route.gameId);

  // Keep the page scrolled to the top when moving between sections.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.name]);

  // A section their family doesn't have isn't shown. Games switched off for
  // just them stays, to say so.
  const myBubble = me.bubble_id ? bubbles.get(me.bubble_id) : undefined;
  const nav: { route: Route; label: string; icon: IconName; badge?: number; badgeText?: string }[] = [
    { route: { name: 'chats' }, label: 'Chats', icon: 'chat', badge: unread },
    ...(!switchedOffBy(myBubble, 'play_games') ? [{ route: { name: 'games' } as Route, label: 'Games', icon: 'games' as IconName, badge: myTurns }] : []),
    { route: { name: 'learn' }, label: 'Learn', icon: 'globe' },
    ...(seesCalendar(me)
      ? [{ route: { name: 'calendar' } as Route, label: 'Calendar', icon: 'calendar' as IconName }]
      : me.permissions.tasks
        ? [{ route: { name: 'calendar' } as Route, label: 'Tasks', icon: 'list' as IconName }]
        : []),
    { route: { name: 'people' }, label: 'Family', icon: 'people', badge: askingMe, badgeText: 'waiting for your yes' },
    { route: { name: 'me' }, label: 'Me', icon: 'me' },
  ];

  const current = route.name === 'outbox' ? 'people' : route.name;

  if (route.name === 'call') {
    return (
      <>
        <CallScreen roomId={route.roomId} />
        <IncomingCall />
        <TipLayer />
        <Toasts toasts={toasts} dismissToast={dismissToast} />
      </>
    );
  }

  return (
    <div className="app" data-detail={detail ? 'yes' : 'no'}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <nav className="rail" aria-label="Main">
        <div className="rail-brand">
          <img src="/icons/icon-192.png" alt="" width={36} height={36} />
          <span>{appName}</span>
        </div>
        <ul className="rail-list">
          {nav.map((n) => (
            <li key={n.label}>
              <a
                className="rail-link"
                href={href(n.route)}
                aria-current={current === n.route.name ? 'page' : undefined}
              >
                <span className="rail-icon">
                  <Icon name={n.icon} size={24} />
                  {!!n.badge && (
                    <span className="count" aria-hidden="true">
                      {n.badge > 99 ? '99+' : n.badge}
                    </span>
                  )}
                </span>
                <span className="rail-label">{n.label}</span>
                {!!n.badge && (
                  <span className="sr-only">
                    , {n.badge} {n.badgeText ?? 'new'}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
        <a className="rail-me" href="#/me">
          <Avatar person={me} size="sm" />
          <span>{me.name}</span>
        </a>
      </nav>

      <main id="main" className="main" tabIndex={-1}>
        {!connected && (
          <div className="offline" role="status">
            Reconnecting to the family server…
          </div>
        )}
        {route.name === 'chats' && <Chats roomId={route.roomId} />}
        {route.name === 'games' && <GamesHub gameId={route.gameId} />}
        {route.name === 'learn' && <Learn />}
        {route.name === 'calendar' && <CalendarScreen view={route.view} linkAccount={route.linkAccount} />}
        {route.name === 'people' && <People personId={route.personId} />}
        {route.name === 'outbox' && <Outbox />}
        {route.name === 'me' && <MePage />}
      </main>

      <IncomingCall />
      <TipLayer />
      <ConfirmHost />
      <Toasts toasts={toasts} dismissToast={dismissToast} />
    </div>
  );
}

function Toasts({ toasts, dismissToast }: { toasts: Toast[]; dismissToast: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span>{t.text}</span>
          {t.action && (
            <a className="toast-action" href={t.action.href} onClick={() => dismissToast(t.id)}>
              {t.action.label}
            </a>
          )}
          <button type="button" className="toast-close" aria-label="Close" onClick={() => dismissToast(t.id)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
