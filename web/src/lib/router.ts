import { useEffect, useState } from 'react';

// Hash routes, so the server only ever serves one page:
// #/chats, #/chats/3, #/games, #/games/7, #/calendar, #/calendar/month (or tasks, homework, rewards), #/people, #/me, #/call/3
// and #/calendar/link/5, where Google or Microsoft send someone back to pick an account's calendars.
export type Route =
  | { name: 'chats'; roomId?: number }
  | { name: 'games'; gameId?: number }
  | { name: 'calendar'; view?: CalendarView; linkAccount?: number }
  | { name: 'people'; personId?: number }
  | { name: 'outbox' }
  | { name: 'call'; roomId: number }
  | { name: 'me' };

export type CalendarView = 'today' | 'month' | 'tasks' | 'homework' | 'rewards';
const calendarViews: string[] = ['month', 'tasks', 'homework', 'rewards'];

export function parse(hash: string): Route {
  const [, section, id, more] = hash.replace(/^#/, '').split('/');
  const n = id ? Number(id) : undefined;
  const num = n !== undefined && Number.isFinite(n) ? n : undefined;
  switch (section) {
    case 'games':
      return { name: 'games', gameId: num };
    case 'calendar':
      if (id === 'link' && Number(more) > 0) return { name: 'calendar', view: 'month', linkAccount: Number(more) };
      return { name: 'calendar', view: id && calendarViews.includes(id) ? (id as CalendarView) : undefined };
    case 'people':
      return { name: 'people', personId: num };
    case 'outbox':
      return { name: 'outbox' };
    case 'call':
      return num ? { name: 'call', roomId: num } : { name: 'chats' };
    case 'me':
      return { name: 'me' };
    default:
      return { name: 'chats', roomId: num };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'chats':
      return route.roomId ? `#/chats/${route.roomId}` : '#/chats';
    case 'games':
      return route.gameId ? `#/games/${route.gameId}` : '#/games';
    case 'calendar':
      return route.view && route.view !== 'today' ? `#/calendar/${route.view}` : '#/calendar';
    case 'people':
      return route.personId ? `#/people/${route.personId}` : '#/people';
    case 'outbox':
      return '#/outbox';
    case 'call':
      return `#/call/${route.roomId}`;
    case 'me':
      return '#/me';
  }
}

export function go(route: Route) {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
