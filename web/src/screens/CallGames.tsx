import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CallSession, CallSnapshot, Snap } from '../lib/call';
import {
  endTurn,
  familyTotal,
  favourites,
  gotIt,
  newFace,
  nextActor,
  skipWord,
  startAct,
  toggleStar,
  ACT_SECONDS,
  type ActGame,
  type CallGame,
  type DrawGame,
  type FaceGame,
} from '../lib/callGames';
import { useStore } from '../lib/store';
import { defaultBand } from '../games/bands';
import { whoCanChange } from '../lib/permissions';
import { api } from '../lib/api';
import { loadImage, toBlob, upload } from '../lib/image';
import type { Room } from '../lib/types';
import { Avatar, Button, IconButton, Notice, Spinner } from '../components/ui';
import { Icon } from '../components/icons';
import { gameDef } from '../games/registry';
import { useGame } from '../games/useGame';
import { listNames } from '../games/common';

const COUNTDOWN_MS = 3500;

interface Props {
  session: CallSession;
  snap: CallSnapshot;
  room: Room | undefined;
  inCall: number[];
  picking: boolean;
  onPicked: () => void;
  onClose: () => void;
}

/** The games played during a call: a picker, then whichever game is on. */
export function CallGames({ session, snap, room, inCall, picking, onPicked, onClose }: Props) {
  const game = snap.game as CallGame | null;
  if (game?.kind === 'face') return <PullAFace game={game} session={session} snap={snap} room={room} inCall={inCall} />;
  if (game?.kind === 'act') return <ActItOut game={game} session={session} snap={snap} inCall={inCall} />;
  if (game?.kind === 'draw') return <DrawTogether game={game} session={session} />;
  if (picking) return <Picker session={session} room={room} onPicked={onPicked} onClose={onClose} />;
  return null;
}

function Picker({
  session,
  room,
  onPicked,
  onClose,
}: {
  session: CallSession;
  room: Room | undefined;
  onPicked: () => void;
  onClose: () => void;
}) {
  const { me, people, toast } = useStore();
  const [starting, setStarting] = useState(false);

  async function draw() {
    const def = gameDef('doodle_together');
    if (!def || !room) return;
    setStarting(true);
    try {
      const ctx = { me, room, mode: 'coop' as const, band: defaultBand(me), people };
      const made = await def.create(def.defaults(ctx), ctx);
      const res = await api.post<{ game: { id: number } }>(`/api/rooms/${room.id}/games`, { type: def.type, ...made });
      session.setGame({ kind: 'draw', gameId: res.game.id });
      onPicked();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setStarting(false);
    }
  }

  const choices = [
    {
      key: 'face',
      emoji: '🤪',
      name: 'Pull a Face',
      blurb: 'Everyone pulls the same silly face, the camera snaps you all, then give a star to the best.',
      start: () => {
        session.setGame({ ...newFace(null) });
        onPicked();
      },
    },
    {
      key: 'act',
      emoji: '🎭',
      name: 'Act It Out',
      blurb: `Take turns acting out secret words without talking. Everyone else shouts out guesses. ${ACT_SECONDS} seconds each.`,
      start: () => {
        session.setGame({ ...startAct(me.id, null) });
        onPicked();
      },
    },
    {
      key: 'draw',
      emoji: '🖍️',
      name: 'Draw Together',
      blurb: 'One big page you all draw on at the same time while you chat. Keep it in the chat afterwards.',
      start: draw,
      disabled: !me.permissions.start_games,
    },
  ];

  return (
    <div className="cg cg-picker">
      <header className="cg-head">
        <h2>Play while you talk</h2>
        <IconButton icon="close" label="Close the games" onClick={onClose} />
      </header>
      <ul className="cg-choices">
        {choices.map((c) => (
          <li key={c.key}>
            <button type="button" className="cg-choice" onClick={c.start} disabled={c.disabled || starting}>
              <span className="cg-choice-art" aria-hidden="true">
                {c.emoji}
              </span>
              <span className="cg-choice-text">
                <strong>{c.name}</strong>
                <span>{c.disabled ? `Ask ${whoCanChange(me.role).toLowerCase()} to let you start games.` : c.blurb}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {starting && <Spinner label="Getting the page ready" />}
    </div>
  );
}

/* Pull a Face ---------------------------------------------------------------- */

function PullAFace({
  game,
  session,
  snap,
  room,
  inCall,
}: {
  game: FaceGame;
  session: CallSession;
  snap: CallSnapshot;
  room: Room | undefined;
  inCall: number[];
}) {
  const { me, people, toast } = useStore();
  const camera = useRef<HTMLVideoElement>(null);
  const starts = useRef(new Map<number, number>());
  const sent = useRef(new Set<number>());
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState<number | null>(null);

  // The countdown starts when this device hears about the round.
  if (!starts.current.has(game.round)) starts.current.set(game.round, Math.max(snap.gameAt, Date.now() - 60_000) + COUNTDOWN_MS);
  const startAt = starts.current.get(game.round)!;
  const now = useTicker(startAt > Date.now() ? 100 : 0);
  const left = startAt - now;
  const counting = left > 0;
  const canSnap = snap.hasVideo && snap.camera;

  useEffect(() => {
    const v = camera.current;
    if (v && v.srcObject !== snap.local) v.srcObject = snap.local;
    v?.play().catch(() => {});
  }, [snap.local]);

  useEffect(() => {
    if (counting || sent.current.has(game.round) || !canSnap || !camera.current) return;
    sent.current.add(game.round);
    const image = captureFace(camera.current, snap.facing === 'user');
    if (image) session.sendSnap(game.round, image);
  }, [counting, game.round, canSnap, session, snap.facing]);

  const photos = snap.snaps[game.round] ?? [];
  const best = favourites(game);
  const missing = inCall.filter((id) => !photos.some((p) => p.userId === id));

  async function share() {
    setSharing(true);
    try {
      if (!room) throw new Error('The chat for this call has gone.');
      const canvas = await renderCollage(photos, game, (id) => people.get(id)?.name ?? 'Someone');
      const blob = await toBlob(canvas, 'image/jpeg', 0.88);
      const { media_id } = await upload(room.id, { blob, width: canvas.width, height: canvas.height });
      await api.post(`/api/rooms/${room.id}/messages`, { kind: 'photo', media_id, body: `Pull a Face: ${game.prompt}` });
      setShared(game.round);
      toast('Shared in the chat.', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="cg cg-face">
      <video ref={camera} className="cg-hidden-camera" muted playsInline aria-hidden="true" />
      <header className="cg-head">
        <h2>
          <span aria-hidden="true">🤪</span> Pull a Face
        </h2>
        <IconButton icon="close" label="Stop the game" onClick={() => session.setGame(null)} />
      </header>

      <div className="cg-prompt paper-card" data-counting={counting || undefined}>
        <span className="cg-prompt-lead">Pull a face like…</span>
        <strong className="cg-prompt-text">{game.prompt}</strong>
      </div>

      {counting ? (
        <div className="cg-countdown" aria-live="assertive">
          <span key={Math.ceil(left / 1000)} className="cg-count">
            {Math.ceil(left / 1000)}
          </span>
          <span className="muted">{canSnap ? 'Get ready to pull your face!' : 'Your camera is off, so you can just watch.'}</span>
        </div>
      ) : (
        <>
          <span className="cg-flash" key={game.round} aria-hidden="true" />
          <ul className="cg-photos" aria-label="Everyone's faces">
            {photos.map((p, i) => {
              const voters = game.stars[p.peer] ?? [];
              const mine = p.userId === me.id;
              const starred = voters.includes(me.id);
              const name = mine ? 'You' : (people.get(p.userId)?.name ?? 'Someone');
              return (
                <li key={p.peer} className="cg-polaroid" style={{ '--tilt': `${(i % 3) - 1}deg` } as CSSProperties} data-best={best.includes(p.peer) || undefined}>
                  <img src={p.image} alt={`${name} pulling a face`} />
                  <span className="cg-polaroid-name">{name}</span>
                  <button
                    type="button"
                    className="cg-star"
                    aria-pressed={starred}
                    disabled={mine}
                    aria-label={mine ? `${voters.length} stars for your face` : `${starred ? 'Take back your star from' : 'Give a star to'} ${name}`}
                    onClick={() => session.setGame({ ...toggleStar(game, p.peer, p.userId, me.id) })}
                  >
                    <span aria-hidden="true">⭐</span> {voters.length}
                  </button>
                </li>
              );
            })}
            {missing.map((id) => (
              <li key={`waiting-${id}`} className="cg-polaroid cg-polaroid-empty">
                <Avatar person={people.get(id)} size="lg" />
                <span className="cg-polaroid-name">{id === me.id ? 'You' : people.get(id)?.name}</span>
                <span className="muted">No photo</span>
              </li>
            ))}
          </ul>
          {best.length > 0 && (
            <p className="cg-winner">
              Funniest face so far:{' '}
              <strong>{listNames(best.map((peer) => nameFor(photos.find((p) => p.peer === peer)?.userId, me.id, people)))}</strong>
            </p>
          )}
          <div className="cg-actions">
            <Button onClick={() => session.setGame({ ...newFace(game) })}>Another face</Button>
            <Button variant="secondary" onClick={share} disabled={sharing || !photos.length || shared === game.round}>
              {shared === game.round ? 'Shared' : sharing ? 'Sharing…' : 'Share to the chat'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** A square photo from the middle of the camera picture, the way the person sees themselves. */
function captureFace(video: HTMLVideoElement, mirror: boolean): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const side = Math.min(w, h);
  const size = 360;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  if (mirror) {
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.78);
}

/** Lays the round's photos out as instant photos on paper, for sharing in the chat. */
async function renderCollage(photos: Snap[], game: FaceGame, nameOf: (id: number) => string): Promise<HTMLCanvasElement> {
  const cols = Math.min(3, Math.max(1, photos.length));
  const rows = Math.ceil(photos.length / cols);
  const cell = 360;
  const pad = 36;
  const frame = { side: 18, bottom: 70 };
  const w = pad + cols * (cell + frame.side * 2 + pad);
  const titleH = 120;
  const h = titleH + rows * (cell + frame.side + frame.bottom + pad) + pad;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f3ecdf';
  ctx.fillRect(0, 0, w, h);
  const font = getComputedStyle(document.body).fontFamily;
  ctx.fillStyle = '#1b1d21';
  ctx.textAlign = 'center';
  ctx.font = `600 26px ${font}`;
  ctx.fillText('Pull a face like…', w / 2, 52);
  ctx.font = `800 36px ${font}`;
  ctx.fillText(game.prompt, w / 2, 98);

  const best = favourites(game);
  const images = await Promise.all(photos.map((p) => loadImage(p.image)));
  photos.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (cell + frame.side * 2 + pad);
    const y = titleH + row * (cell + frame.side + frame.bottom + pad);
    ctx.save();
    ctx.translate(x + cell / 2 + frame.side, y + cell / 2);
    ctx.rotate((((i % 3) - 1) * Math.PI) / 180);
    ctx.translate(-(cell / 2 + frame.side), -cell / 2);
    ctx.shadowColor = 'rgba(60, 40, 10, 0.28)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, cell + frame.side * 2, cell + frame.side + frame.bottom);
    ctx.shadowColor = 'transparent';
    ctx.drawImage(images[i], frame.side, frame.side, cell, cell);
    ctx.fillStyle = '#1b1d21';
    ctx.font = `700 28px ${font}`;
    const stars = (game.stars[p.peer] ?? []).length;
    ctx.fillText(`${nameOf(p.userId)}${stars ? `  ${'⭐'.repeat(Math.min(stars, 5))}` : ''}`, cell / 2 + frame.side, cell + frame.side + 46);
    if (best.includes(p.peer)) {
      ctx.font = '54px sans-serif';
      ctx.fillText('👑', cell + frame.side - 6, 40);
    }
    ctx.restore();
  });
  return canvas;
}

/* Act It Out ----------------------------------------------------------------- */

function ActItOut({ game, session, snap, inCall }: { game: ActGame; session: CallSession; snap: CallSnapshot; inCall: number[] }) {
  const { me, people } = useStore();
  const endsAt = snap.gameAt + game.remainingMs;
  const acting = game.phase === 'acting';
  const now = useTicker(acting ? 250 : 0);
  const left = Math.max(0, endsAt - now);
  const isActor = game.actor === me.id;
  const actorName = nameFor(game.actor, me.id, people);
  const ended = useRef<number | null>(null);

  // The actor's device calls time.
  useEffect(() => {
    if (!acting || !isActor || left > 0 || ended.current === game.turn) return;
    ended.current = game.turn;
    session.setGame({ ...endTurn(game) });
  }, [acting, isActor, left, game, session]);

  const remaining = () => Math.max(0, endsAt - Date.now());
  const next = nextActor(game, inCall);
  const scores = Object.entries(game.scores)
    .map(([id, n]) => ({ id: Number(id), n }))
    .sort((a, b) => b.n - a.n);
  const total = familyTotal(game);

  return (
    <div className="cg cg-act">
      <header className="cg-head">
        <h2>
          <span aria-hidden="true">🎭</span> Act It Out
        </h2>
        <IconButton icon="close" label="Stop the game" onClick={() => session.setGame(null)} />
      </header>

      {acting ? (
        <>
          <div className="cg-act-top">
            <Timer left={left} total={ACT_SECONDS * 1000} />
            <div>
              <p className="cg-act-who">{isActor ? 'Your turn to act!' : `${actorName} is acting`}</p>
              <p className="muted">
                {isActor ? "No talking: act it out and let them guess." : 'Shout out your guesses!'} {game.got > 0 && `Got ${game.got} so far.`}
              </p>
            </div>
          </div>
          {isActor ? (
            <>
              <div className="cg-secret paper-card">
                <span className="cg-prompt-lead">Act out</span>
                <strong className="cg-prompt-text">{game.word}</strong>
                <span className="cg-secret-note">Shh! Only you can see this.</span>
              </div>
              <div className="cg-actions">
                <Button onClick={() => session.setGame({ ...gotIt(game, remaining()) })}>
                  <Icon name="check" size={20} /> They got it!
                </Button>
                <Button variant="secondary" onClick={() => session.setGame({ ...skipWord(game, remaining()) })}>
                  Skip this one
                </Button>
              </div>
            </>
          ) : (
            <div className="cg-guess paper-card">
              <Avatar person={people.get(game.actor)} size="xl" />
              <span>Watch {actorName} and guess what they are.</span>
              {left === 0 && (
                <Button variant="secondary" size="sm" onClick={() => session.setGame({ ...endTurn(game) })}>
                  End the turn
                </Button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="cg-result paper-card">
            <span className="cg-prompt-lead">Time's up!</span>
            <strong className="cg-prompt-text">
              {isActor ? 'You' : actorName} got {game.got} {game.got === 1 ? 'word' : 'words'}
            </strong>
            {game.got > 0 && game.got >= game.best && game.turn > 1 && <span className="cg-secret-note">🏆 The best turn yet!</span>}
          </div>
          <div className="cg-scores">
            <p>
              <strong>Together: {total}</strong> {total === 1 ? 'word' : 'words'} guessed
            </p>
            <ul>
              {scores.map((s) => (
                <li key={s.id}>
                  <Avatar person={people.get(s.id)} size="xs" /> {nameFor(s.id, me.id, people)} <strong>{s.n}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div className="cg-actions">
            <Button onClick={() => session.setGame({ ...startAct(next, game) })}>
              {next === me.id ? 'Your turn to act' : `${nameFor(next, me.id, people)} acts next`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Timer({ left, total }: { left: number; total: number }) {
  const seconds = Math.ceil(left / 1000);
  return (
    <span
      className="cg-timer"
      data-low={seconds <= 10 || undefined}
      style={{ '--done': `${(1 - left / total) * 360}deg` } as CSSProperties}
      role="timer"
      aria-label={`${seconds} seconds left`}
    >
      <span>{seconds}</span>
    </span>
  );
}

/* Draw Together -------------------------------------------------------------- */

function DrawTogether({ game, session }: { game: DrawGame; session: CallSession }) {
  const { me, people, rooms } = useStore();
  const { game: g, error, play } = useGame<Record<string, unknown>>(game.gameId);
  const def = g ? gameDef(g.type) : undefined;
  const room = g ? rooms.find((r) => r.id === g.room_id) : undefined;

  return (
    <div className="cg cg-draw">
      <header className="cg-head">
        <h2>
          <span aria-hidden="true">🖍️</span> Draw Together
        </h2>
        <IconButton icon="close" label="Stop the game" onClick={() => session.setGame(null)} />
      </header>
      {error && <Notice tone="danger">{error}</Notice>}
      {!g && !error && <Spinner label="Getting the page" />}
      {g && def && (
        <div className="cg-draw-board">
          <def.Board game={g} play={play} me={me} people={people} room={room} />
        </div>
      )}
    </div>
  );
}

/* Helpers -------------------------------------------------------------------- */

function nameFor(id: number | undefined, me: number, people: Map<number, { name: string }>): string {
  if (id === me) return 'You';
  return (id != null && people.get(id)?.name) || 'Someone';
}

/** The time now, updated every `every` ms (or not at all when 0). */
function useTicker(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!every) return;
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [every]);
  return now;
}
