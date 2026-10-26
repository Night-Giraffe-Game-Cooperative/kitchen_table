import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Presence } from 'phoenix';
import { api } from './api';
import { connect, disconnect, join, onConnectionChange } from './socket';
import { checkSoon, clearNotifications, disablePush, refreshPush } from './push';
import type { Bubble, CallInfo, Friendship, Game, Me, Message, Person, Room } from './types';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'danger';
  action?: { label: string; href: string };
}

interface Session {
  me: Me;
  socket_token: string;
  app_name: string;
  reactions: string[];
  colours: string[];
  ice_servers?: RTCIceServer[];
  https_port?: number | null;
}

/** Someone has started a call in a chat this person is in. */
export interface Ring {
  roomId: number;
  by: number;
}

interface Store {
  me: Me;
  appName: string;
  reactions: string[];
  colours: string[];
  people: Map<number, Person>;
  bubbles: Map<number, Bubble>;
  /** Kids' friendships across households that this person can see. */
  friendships: Friendship[];
  online: Set<number>;
  rooms: Room[];
  games: Game[];
  connected: boolean;
  activeRoom: RefObject<number | null>;
  /** The room whose call this device is in, so it doesn't ring for it. */
  activeCall: RefObject<number | null>;
  iceServers: RTCIceServer[];
  httpsPort: number | null;
  ring: Ring | null;
  dismissRing: () => void;
  setMe: (me: Me) => void;
  refreshPeople: () => Promise<void>;
  refreshRooms: () => Promise<void>;
  refreshGames: () => Promise<void>;
  markRoomRead: (roomId: number, messageId: number) => void;
  toast: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  signOut: () => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore outside StoreProvider');
  return store;
}

export function usePerson(id: number | null | undefined): Person | undefined {
  const { people } = useStore();
  return id == null ? undefined : people.get(id);
}

let toastId = 0;

/** After this long without a tap or a key, an open app counts as put down. */
const IDLE_MS = 3 * 60_000;

export function StoreProvider({ session, onSignedOut, children }: { session: Session; onSignedOut: () => void; children: ReactNode }) {
  const [me, setMe] = useState<Me>(session.me);
  const [people, setPeople] = useState<Map<number, Person>>(new Map());
  const [bubbles, setBubbles] = useState<Map<number, Bubble>>(new Map());
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [online, setOnline] = useState<Set<number>>(new Set());
  const [rooms, setRooms] = useState<Room[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [connected, setConnected] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const activeRoom = useRef<number | null>(null);
  const activeCall = useRef<number | null>(null);
  const [ring, setRing] = useState<Ring | null>(null);
  const dismissRing = useCallback(() => setRing(null), []);
  const rangAt = useRef(new Map<number, number>());
  const reportActive = useRef<((always?: boolean) => void) | null>(null);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info', action?: Toast['action']) => {
    const id = ++toastId;
    // The same note twice (another "your turn" in the same game) replaces the first.
    setToasts((t) => [...t.filter((x) => x.text !== text).slice(-2), { id, text, tone, action }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'danger' ? 7000 : 4500);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refreshPeople = useCallback(async () => {
    const res = await api.get<{ people: Person[]; bubbles: Bubble[]; friendships?: Friendship[] }>('/api/people');
    setPeople(new Map(res.people.map((p) => [p.id, p])));
    setBubbles(new Map(res.bubbles.map((b) => [b.id, b])));
    setFriendships(res.friendships ?? []);
  }, []);

  const refreshRooms = useCallback(async () => {
    const res = await api.get<{ rooms: Room[] }>('/api/rooms');
    setRooms(res.rooms.map((r) => (r.id === activeRoom.current ? { ...r, unread: 0 } : r)));
  }, []);

  const refreshGames = useCallback(async () => {
    const res = await api.get<{ games: Game[] }>('/api/games');
    setGames(res.games);
  }, []);

  const refreshMe = useCallback(async () => {
    const res = await api.get<{ me: Me }>('/api/me');
    setMe(res.me);
  }, []);

  const markRoomRead = useCallback((roomId: number, messageId: number) => {
    setRooms((rs) => rs.map((r) => (r.id === roomId ? { ...r, unread: 0 } : r)));
    api.post(`/api/rooms/${roomId}/read`, { message_id: messageId }).catch(() => {});
  }, []);

  const signOut = useCallback(async () => {
    // Someone else may sign in on this device next.
    await disablePush().catch(() => {});
    await api.del('/api/session').catch(() => {});
    disconnect();
    onSignedOut();
  }, [onSignedOut]);

  // Connect straight away, before any screen's effects try to join a channel
  // (a game opened from a link joins on its first render).
  useState(() => connect(session.socket_token));

  // Load everything, then keep it live.
  useEffect(() => {
    connect(session.socket_token);
    refreshPeople().catch(() => {});
    refreshRooms().catch(() => {});
    refreshGames().catch(() => {});

    const offConn = onConnectionChange((up) => {
      setConnected(up);
      if (up) {
        refreshRooms().catch(() => {});
        refreshGames().catch(() => {});
        // The server starts a rejoined device as in use.
        reportActive.current?.(true);
      }
    });

    const [mine, leaveMine] = join(`user:${session.me.id}`);
    mine.on('rooms_changed', () => refreshRooms().catch(() => {}));
    mine.on('games_changed', () => refreshGames().catch(() => {}));
    mine.on('room_activity', ({ room_id, message }: { room_id: number; message: Message }) => {
      if (message.user_id !== session.me.id) checkSoon();
      setRooms((rs) => {
        const known = rs.some((r) => r.id === room_id);
        if (!known) {
          refreshRooms().catch(() => {});
          return rs;
        }
        const updated = rs.map((r) => {
          if (r.id !== room_id) return r;
          const mineMsg = message.user_id === session.me.id;
          const viewing = activeRoom.current === room_id && document.visibilityState === 'visible';
          return {
            ...r,
            // Chats an admin only reads never count as unread.
            unread: mineMsg || viewing || !r.member ? 0 : r.unread + 1,
            last_message_at: message.inserted_at,
            last_message: { id: message.id, user_id: message.user_id, user_name: null, text: previewText(message) },
          };
        });
        return sortRooms(updated);
      });
    });
    mine.on('call_ring', ({ room_id, by }: { room_id: number; by: number }) => {
      checkSoon();
      rangAt.current.set(room_id, Date.now());
      if (activeCall.current !== room_id) setRing({ roomId: room_id, by });
    });
    mine.on('call_changed', ({ room_id, call }: { room_id: number; call: CallInfo | null }) => {
      const live = call && call.user_ids.length > 0 ? call : null;
      setRooms((rs) => rs.map((r) => (r.id === room_id ? { ...r, call: live } : r)));
      // Stop ringing once the call is over, or once this person has joined it elsewhere.
      if (!call || call.user_ids.includes(session.me.id)) setRing((rg) => (rg?.roomId === room_id ? null : rg));
    });
    mine.on('your_turn', (game: Game) => {
      checkSoon();
      // No need to say so to someone already looking at the game.
      if (window.location.hash === `#/games/${game.id}`) return;
      toast(`Your turn in ${gameName(game.type)}.`, 'info', { label: 'Play', href: `#/games/${game.id}` });
    });

    const [family, leaveFamily] = join('family:presence');

    // Tells the server whether this device is on screen and in use, so
    // notifications go to the person's other devices only while it isn't.
    let active = true;
    let lastUse = Date.now();
    const report = (always = false) => {
      const now = document.visibilityState === 'visible' && Date.now() - lastUse < IDLE_MS;
      if (now && !active) clearNotifications();
      if (now !== active || always) family.push('active', { active: now });
      active = now;
    };
    const used = () => {
      lastUse = Date.now();
      if (!active) report();
    };
    const onVisibility = () => report();
    const idleCheck = window.setInterval(report, 30_000);
    const useEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    useEvents.forEach((e) => window.addEventListener(e, used, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    reportActive.current = report;
    report(true);
    if (document.visibilityState === 'visible') clearNotifications();
    refreshPush().catch(() => {});

    // A tapped notification asks the open window to show its chat or game.
    const onWorkerMessage = (e: MessageEvent) => {
      const hash = e.data?.type === 'open' ? e.data.hash : null;
      if (typeof hash === 'string' && hash.startsWith('#/')) window.location.hash = hash;
    };
    navigator.serviceWorker?.addEventListener('message', onWorkerMessage);

    const presence = new Presence(family);
    presence.onSync(() => {
      const ids = new Set<number>();
      presence.list((id) => ids.add(Number(id)));
      setOnline(ids);
    });
    family.on('people_changed', ({ id }: { id: number | null }) => {
      refreshPeople().catch(() => {});
      refreshRooms().catch(() => {});
      // No id means a whole bubble changed, which may change what I can do.
      if (id === session.me.id || id == null) refreshMe().catch(() => {});
    });

    const onAuth = () => {
      disconnect();
      onSignedOut();
    };
    window.addEventListener('family:auth', onAuth);

    return () => {
      offConn();
      leaveMine();
      leaveFamily();
      window.removeEventListener('family:auth', onAuth);
      window.clearInterval(idleCheck);
      useEvents.forEach((e) => window.removeEventListener(e, used));
      document.removeEventListener('visibilitychange', onVisibility);
      navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
      reportActive.current = null;
    };
  }, [session, refreshPeople, refreshRooms, refreshGames, refreshMe, toast, onSignedOut]);

  // Opened from a call's notification, or opened while a call rings: ring
  // here too, so it can be answered.
  useEffect(() => {
    for (const r of rooms) {
      const call = r.call;
      if (!call || !r.member || call.started_by === session.me.id || call.user_ids.includes(session.me.id)) continue;
      if (activeCall.current === r.id || Date.now() - (rangAt.current.get(r.id) ?? 0) < 60_000) continue;
      if (Date.now() - Date.parse(call.started_at) > 40_000) continue;
      rangAt.current.set(r.id, Date.now());
      setRing({ roomId: r.id, by: call.started_by });
    }
  }, [rooms, session.me.id]);

  // Keep the app badge and title in step with unread messages.
  useEffect(() => {
    const unread = rooms.reduce((n, r) => n + r.unread, 0);
    document.title = unread ? `(${unread}) ${session.app_name}` : session.app_name;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (unread) nav.setAppBadge?.(unread).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [rooms, session.app_name]);

  const value = useMemo<Store>(
    () => ({
      me,
      appName: session.app_name,
      reactions: session.reactions,
      colours: session.colours,
      people,
      bubbles,
      friendships,
      online,
      rooms,
      games,
      connected,
      activeRoom,
      activeCall,
      iceServers: session.ice_servers ?? [],
      httpsPort: session.https_port ?? null,
      ring,
      dismissRing,
      setMe,
      refreshPeople,
      refreshRooms,
      refreshGames,
      markRoomRead,
      toast,
      toasts,
      dismissToast,
      signOut,
    }),
    [me, session, people, bubbles, friendships, online, rooms, games, connected, ring, dismissRing, refreshPeople, refreshRooms, refreshGames, markRoomRead, toast, toasts, dismissToast, signOut],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function sortRooms(rooms: Room[]): Room[] {
  return [...rooms].sort((a, b) => {
    if (a.kind === 'family') return -1;
    if (b.kind === 'family') return 1;
    return (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '');
  });
}

export function previewText(m: Message): string {
  if (m.deleted) return 'Message deleted';
  if (m.kind === 'photo') return '📷 ' + (m.body || 'Photo');
  if (m.kind === 'doodle') return '🖍️ ' + (m.body || 'Doodle');
  if (m.kind === 'game') return '🎲 Started a game';
  if (m.kind === 'call') return '📞 Video call';
  return m.body ?? '';
}

const names: Record<string, string> = {
  doodle_together: 'Doodle Together',
  doodle_duel: 'Doodle Battle',
  doodle_telephone: 'Doodle Telephone',
  chess: 'Chess',
  backgammon: 'Backgammon',
  word_garden: 'Word Garden',
  picture_puzzle: 'Picture Puzzle',
  story_chain: 'Story Chain',
};

export function gameName(type: string): string {
  return names[type] ?? 'a game';
}
