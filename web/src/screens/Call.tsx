import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { CallSession, type CallError, type CallSnapshot } from '../lib/call';
import { useStore } from '../lib/store';
import { whoCanChange } from '../lib/permissions';
import { go } from '../lib/router';
import type { Person } from '../lib/types';
import { Avatar, Button } from '../components/ui';
import { Icon, type IconName } from '../components/icons';
import { CallGames } from './CallGames';
import { defaultInk, IdeaSlip, InkLayer, InkTray, type InkSettings } from './CallInk';
import type { InkStroke } from '../lib/callInk';

const quickReactions = ['❤️', '😂', '👏', '🎉', '😮', '👍'];

const emptySnapshot: CallSnapshot = {
  status: 'starting',
  error: null,
  local: null,
  hasVideo: false,
  hasAudio: false,
  muted: false,
  camera: true,
  facing: 'user',
  canFlip: false,
  peers: [],
  startedAt: null,
  game: null,
  gameAt: 0,
  snaps: {},
  reactions: [],
  inkCount: 0,
  myInk: 0,
  idea: null,
};

const noSubscribe = () => () => {};
const noSnapshot = () => emptySnapshot;

/** A video call in a chat, full screen. Leaving the screen leaves the call. */
export function CallScreen({ roomId }: { roomId: number }) {
  const { me, rooms, people, iceServers, httpsPort, activeCall, ring, dismissRing } = useStore();
  const room = rooms.find((r) => r.id === roomId);
  const [session, setSession] = useState<CallSession | null>(null);
  const snap = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.snapshot ?? noSnapshot);
  const [picking, setPicking] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [inking, setInking] = useState(false);
  const [ink, setInk] = useState<InkSettings>(defaultInk);
  const [needsTap, setNeedsTap] = useState(false);
  const now = useNow();
  const tilesBox = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState({ cols: 2, rows: 2 });

  useEffect(() => {
    const s = new CallSession(roomId, me.id, iceServers);
    setSession(s);
    activeCall.current = roomId;
    s.start();
    return () => {
      s.leave();
      if (activeCall.current === roomId) activeCall.current = null;
    };
  }, [roomId, me.id, iceServers, activeCall]);

  useEffect(() => {
    if (ring?.roomId === roomId) dismissRing();
  }, [ring, roomId, dismissRing]);

  // Keep the screen awake during a call, where the browser allows it.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    return () => {
      lock?.release().catch(() => {});
    };
  }, []);

  const count = snap.peers.length + 1;
  useEffect(() => {
    const el = tilesBox.current;
    if (!el) return;
    const fit = () => {
      const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
      const next = bestGrid(count, el.clientWidth, el.clientHeight, gap);
      setGrid((g) => (g.cols === next.cols && g.rows === next.rows ? g : next));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [count]);

  const leave = () => go({ name: 'chats', roomId });

  if (snap.error === 'no-calls' || snap.error === 'forbidden' || snap.error === 'closed') {
    return (
      <div className="call call-message">
        <div className="sheet call-notice">
          <h1>{snap.error === 'no-calls' ? 'Video calls are switched off for you' : "You can't join this call"}</h1>
          <p className="muted">
            {snap.error === 'no-calls'
              ? `${whoCanChange(me.role)} can switch them on.`
              : snap.error === 'closed'
                ? 'This chat is closed, because someone in it can no longer chat with someone else.'
                : "You're not in this chat."}
          </p>
          <Button onClick={leave}>Back to the chat</Button>
        </div>
      </div>
    );
  }

  const others = snap.peers;
  const waiting = snap.status !== 'ended' && others.length === 0;
  const playing = !!snap.game || picking;
  const layout = playing ? 'game' : others.length === 1 ? 'duo' : 'grid';
  const inCall = new Set([me.id, ...others.map((p) => p.userId)]);
  const elapsed = snap.startedAt ? Math.max(0, Math.floor((now - snap.startedAt) / 1000)) : 0;
  const pens = inking ? ink : null;
  // Someone else's name beside their pen while they're drawing.
  const drawerName = (s: InkStroke) =>
    s.by !== me.id && s.live && Date.now() - (s.at ?? 0) < 3000 ? (people.get(s.by)?.name ?? null) : null;
  const names = [...inCall].map((id) => (id === me.id ? me.name : (people.get(id)?.name ?? ''))).filter(Boolean);

  const tiles = [
    <Tile
      key="me"
      self
      session={session}
      peer={session?.peerId ?? ''}
      pens={pens}
      drawerName={drawerName}
      stream={snap.local}
      person={me}
      label="You"
      mirrored={snap.facing === 'user'}
      camera={snap.camera && snap.hasVideo}
      micMuted={snap.muted || !snap.hasAudio}
      connected
      onBlocked={() => setNeedsTap(true)}
    />,
    ...others.map((p, i) => (
      <Tile
        key={p.peer}
        session={session}
        peer={p.peer}
        pens={pens}
        drawerName={drawerName}
        stream={p.stream}
        person={people.get(p.userId)}
        label={people.get(p.userId)?.name ?? 'Someone'}
        camera={p.camera}
        micMuted={p.muted}
        connected={p.connected}
        tilt={i % 2 ? 1 : -1}
        onBlocked={() => setNeedsTap(true)}
      />
    )),
  ];

  return (
    <div className="call" data-layout={layout} data-inking={inking || undefined} data-game={(snap.game?.kind as string | undefined) ?? undefined}>
      <header className="call-head">
        <span className="call-room">
          <span aria-hidden="true">{room?.emoji ?? '📞'}</span> {room?.name ?? 'Call'}
        </span>
        <span className="call-meta">
          {snap.status === 'starting' ? 'Starting…' : waiting ? 'Ringing everyone…' : `${clock(elapsed)} · ${inCall.size} in the call`}
        </span>
      </header>

      {snap.error && snap.error !== 'lost' && <CameraHelp error={snap.error} httpsPort={httpsPort} />}
      {snap.error === 'lost' && <div className="call-banner">Reconnecting to the call…</div>}
      {needsTap && (
        <button
          type="button"
          className="call-banner call-banner-button"
          onClick={() => {
            document.querySelectorAll<HTMLVideoElement>('.call video').forEach((v) => v.play().catch(() => {}));
            setNeedsTap(false);
          }}
        >
          <Icon name="speaker" size={18} /> Tap to hear everyone
        </button>
      )}

      <div className="call-stage">
        <div className="call-tiles" ref={tilesBox} style={{ '--cols': grid.cols, '--rows': grid.rows } as CSSProperties}>
          {waiting && !playing ? (
            <div className="call-waiting">
              {tiles[0]}
              <p className="call-waiting-text">
                <span className="incoming-rings small" aria-hidden="true" />
                Waiting for the family to join…
              </p>
            </div>
          ) : (
            tiles
          )}
        </div>
        {playing && session && (
          <aside className="call-game sheet" aria-label="Call games">
            <CallGames
              session={session}
              snap={snap}
              room={room}
              inCall={[...inCall]}
              picking={picking && !snap.game}
              onPicked={() => setPicking(false)}
              onClose={() => setPicking(false)}
            />
          </aside>
        )}
        <IdeaSlip snap={snap} people={people} me={me} />
      </div>

      <div className="call-floats" aria-hidden="true">
        {snap.reactions.map((r) => (
          <span key={r.id} className="call-float" style={{ '--x': `${r.x}%` } as CSSProperties}>
            <span className="call-float-emoji">{r.emoji}</span>
            <span className="call-float-name">{r.userId === me.id ? 'You' : people.get(r.userId)?.name}</span>
          </span>
        ))}
      </div>

      {reacting && (
        <div className="call-react-tray sheet" role="group" aria-label="Send a reaction">
          {quickReactions.map((e) => (
            <button
              key={e}
              type="button"
              className="call-react"
              onClick={() => {
                session?.react(e);
                setReacting(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {inking && session && (
        <InkTray settings={ink} onChange={setInk} session={session} snap={snap} names={names} room={room} people={people} me={me} />
      )}

      <footer className="call-controls" aria-label="Call controls">
        <CallButton
          icon={snap.muted ? 'mic-off' : 'mic'}
          label={snap.muted ? 'Unmute' : 'Mute'}
          pressed={snap.muted}
          disabled={!snap.hasAudio}
          onClick={() => session?.setMuted(!snap.muted)}
        />
        <CallButton
          icon={snap.camera ? 'video' : 'video-off'}
          label={snap.camera ? 'Camera off' : 'Camera on'}
          pressed={!snap.camera}
          disabled={!snap.hasVideo}
          onClick={() => session?.setCamera(!snap.camera)}
        />
        {snap.canFlip && <CallButton icon="flip" label="Flip camera" onClick={() => session?.flip()} />}
        <CallButton
          icon="marker"
          label={inking ? 'Pens away' : 'Draw'}
          pressed={inking}
          onClick={() => {
            setInking((d) => !d);
            setReacting(false);
          }}
        />
        <CallButton
          icon="smile"
          label="React"
          pressed={reacting}
          steady
          onClick={() => {
            setReacting((r) => !r);
            setInking(false);
          }}
        />
        <CallButton
          icon="dice"
          label={snap.game ? 'Game on' : 'Play a game'}
          pressed={playing}
          onClick={() => {
            if (snap.game) return;
            setPicking((p) => !p);
          }}
        />
        <CallButton icon="phone-down" label="Leave" tone="danger" onClick={leave} />
      </footer>
    </div>
  );
}

function Tile({
  session,
  peer,
  pens,
  drawerName,
  stream,
  person,
  label,
  self,
  mirrored,
  camera,
  micMuted,
  connected,
  tilt = 0,
  onBlocked,
}: {
  session: CallSession | null;
  peer: string;
  pens: InkSettings | null;
  drawerName: (s: InkStroke) => string | null;
  stream: MediaStream | null;
  person: Pick<Person, 'avatar' | 'colour' | 'name'> | undefined;
  label: string;
  self?: boolean;
  mirrored?: boolean;
  camera: boolean;
  micMuted: boolean;
  connected: boolean;
  tilt?: number;
  onBlocked: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) v.play().catch((e: DOMException) => e.name === 'NotAllowedError' && onBlocked());
  }, [stream, onBlocked]);

  return (
    <figure
      className={`tile tint-${person?.colour ?? 'slate'}`}
      data-self={self || undefined}
      data-camera={camera ? 'on' : 'off'}
      data-peer={peer || undefined}
      style={{ '--tilt': `${tilt * 0.8}deg` } as CSSProperties}
    >
      <div className="tile-photo">
        <video ref={video} autoPlay playsInline muted={self} data-mirrored={mirrored || undefined} />
        {!camera && (
          <span className="tile-avatar">
            <Avatar person={person} size="xl" />
          </span>
        )}
        {session && peer && <InkLayer session={session} peer={peer} video={video} mirrored={!!mirrored} settings={pens} nameOf={drawerName} />}
        {!connected && <span className="tile-wait">Connecting…</span>}
      </div>
      <figcaption className="tile-caption">
        <span className="tile-name">{label}</span>
        {micMuted && (
          <span className="tile-muted" title="Muted">
            <Icon name="mic-off" size={16} />
            <span className="sr-only">muted</span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function CallButton({
  icon,
  label,
  onClick,
  pressed,
  steady,
  disabled,
  tone,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  /** The label stays the same either way, so screen readers hear pressed or not; otherwise the label says it. */
  steady?: boolean;
  disabled?: boolean;
  tone?: 'danger';
}) {
  return (
    <button
      type="button"
      className={`call-btn${tone ? ` call-btn-${tone}` : ''}`}
      data-on={pressed || undefined}
      aria-pressed={steady ? !!pressed : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="call-btn-face">
        <Icon name={icon} size={24} />
      </span>
      <span className="call-btn-label">{label}</span>
    </button>
  );
}

function CameraHelp({ error, httpsPort }: { error: CallError; httpsPort: number | null }) {
  if (error === 'insecure') {
    const secure = httpsPort ? `https://${window.location.hostname}:${httpsPort}/${window.location.hash}` : null;
    return (
      <div className="call-banner call-banner-warn">
        <span>
          The camera only works on the secure address. You can still see and hear everyone.
          {secure && ' The first time, the browser warns about the address: choose Advanced, then Continue.'}
        </span>
        {secure && (
          <a className="btn btn-sm btn-secondary" href={secure}>
            Open the secure address
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="call-banner call-banner-warn">
      {error === 'denied'
        ? "The camera and microphone are blocked. Allow them in the browser's settings for this site, then come back into the call."
        : "This device hasn't got a camera or microphone we can use, but you can still see and hear everyone."}
    </div>
  );
}

/**
 * How many columns and rows to lay `n` photos out in, so each photo is as big
 * as it can be: the one whose cells hold the biggest square, after the white
 * frame and the name strip.
 */
function bestGrid(n: number, width: number, height: number, gap: number): { cols: number; rows: number } {
  const frame = { x: 18, y: 50 };
  let best = { cols: Math.min(n, 2), rows: Math.ceil(n / 2), side: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    // Leaving a whole column empty never helps.
    if ((cols - 1) * rows >= n) break;
    const w = (width - gap * (cols - 1)) / cols - frame.x;
    const h = (height - gap * (rows - 1)) / rows - frame.y;
    const side = Math.min(w, h);
    if (side > best.side) best = { cols, rows, side };
  }
  return { cols: best.cols, rows: best.rows };
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
