import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { CallSession, CallSnapshot } from '../lib/call';
import {
  addPoint,
  drawInk,
  drawSticker,
  inkColours,
  inkIdea,
  penSizes,
  stickerSizes,
  stickers,
  toPicture,
  type Fit,
  type InkStroke,
  type InkTool,
  type Sticker,
} from '../lib/callInk';
import { api } from '../lib/api';
import { toBlob, upload } from '../lib/image';
import { useStore } from '../lib/store';
import type { Person, Room } from '../lib/types';
import { Icon } from '../components/icons';

export interface InkSettings {
  tool: InkTool;
  colour: string;
  size: 0 | 1 | 2;
}

export const defaultInk: InkSettings = { tool: 'pen', colour: inkColours[2].value, size: 1 };

// Keep a stroke under what the server will pass on; a long scribble carries on as a new one.
const MAX_POINTS = 5000;

/**
 * The see-through sheet over one person's picture. Shows everything drawn on
 * them, and when the pens are out, lets you draw on it too.
 */
export function InkLayer({
  session,
  peer,
  video,
  mirrored,
  settings,
  nameOf,
}: {
  session: CallSession;
  peer: string;
  video: RefObject<HTMLVideoElement | null>;
  mirrored: boolean;
  /** The pens, when drawing is switched on. */
  settings: InkSettings | null;
  nameOf: (stroke: InkStroke) => string | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ id: string; pointer: number; stroke: InkStroke } | null>(null);
  const names = useRef(nameOf);
  names.current = nameOf;

  const fit = (): Fit | null => {
    const c = canvas.current;
    if (!c || !c.clientWidth) return null;
    const v = video.current;
    return { w: c.clientWidth, h: c.clientHeight, vw: v?.videoWidth || 640, vh: v?.videoHeight || 480, mirrored };
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    let frame = 0;
    const paint = () => {
      frame = 0;
      const c = canvas.current;
      const f = fitRef.current();
      if (!c || !f) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(f.w * dpr);
      const h = Math.round(f.h * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, f.w, f.h);
      drawInk(ctx, f, session.inkOn(peer), (s) => names.current(s));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const stop = session.subscribeInk(schedule);
    const resize = new ResizeObserver(schedule);
    if (canvas.current) resize.observe(canvas.current);
    const v = video.current;
    v?.addEventListener('loadedmetadata', schedule);
    v?.addEventListener('resize', schedule);
    schedule();
    return () => {
      stop();
      resize.disconnect();
      v?.removeEventListener('loadedmetadata', schedule);
      v?.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [session, peer, video, mirrored]);

  const at = (e: PointerEvent): [number, number] | null => {
    const f = fit();
    return f ? toPicture(f, e.offsetX, e.offsetY) : null;
  };

  const begin = (u: number, v: number, s: InkSettings) =>
    session.beginStroke(
      s.tool === 'pen'
        ? { on: peer, kind: 'pen', colour: s.colour, size: penSizes[s.size], points: [u, v] }
        : { on: peer, kind: 'sticker', sticker: s.tool, colour: '#24201d', size: stickerSizes[s.size], points: [u, v] },
    );

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!settings || drawing.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const p = at(e.nativeEvent);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke = begin(p[0], p[1], settings);
    drawing.current = { id: stroke.id, pointer: e.pointerId, stroke };
  };

  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drawing.current;
    if (!d || d.pointer !== e.pointerId || !settings) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const list = events.length ? events : [e.nativeEvent];
    if (d.stroke.kind === 'sticker') {
      const p = at(list[list.length - 1]);
      if (!p) return;
      d.stroke.points = p;
      session.updateStroke(d.id);
      return;
    }
    let changed = false;
    for (const ev of list) {
      const p = at(ev);
      if (p && addPoint(d.stroke.points, p[0], p[1])) changed = true;
    }
    if (!changed) return;
    session.updateStroke(d.id);
    if (d.stroke.points.length >= MAX_POINTS) {
      const n = d.stroke.points.length;
      session.endStroke(d.id);
      const next = begin(d.stroke.points[n - 2], d.stroke.points[n - 1], settings);
      drawing.current = { id: next.id, pointer: d.pointer, stroke: next };
    }
  };

  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drawing.current;
    if (!d || d.pointer !== e.pointerId) return;
    drawing.current = null;
    session.endStroke(d.id);
  };

  return (
    <canvas
      ref={canvas}
      className="tile-ink"
      data-drawing={settings ? (settings.tool === 'pen' ? 'pen' : 'sticker') : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
    />
  );
}

/** The pens and stickers, on a strip of paper above the call buttons. */
export function InkTray({
  settings,
  onChange,
  session,
  snap,
  names,
  room,
  people,
  me,
}: {
  settings: InkSettings;
  onChange: (s: InkSettings) => void;
  session: CallSession;
  snap: CallSnapshot;
  /** Names of everyone in the call, for ideas. */
  names: string[];
  room: Room | undefined;
  people: Map<number, Person>;
  me: Person;
}) {
  const { toast } = useStore();
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!room) return;
    setSaving(true);
    try {
      const canvas = await renderCallPicture(session, snap, me, people);
      const blob = await toBlob(canvas, 'image/jpeg', 0.9);
      const { media_id } = await upload(room.id, { blob, width: canvas.width, height: canvas.height });
      await api.post(`/api/rooms/${room.id}/messages`, { kind: 'photo', media_id, body: 'Drawn on in our video call ✏️' });
      toast('Shared in the chat.', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ink-tray" role="toolbar" aria-label="Drawing on the call">
      <div className="ink-row">
        <div className="ink-pens" role="group" aria-label="Felt tips">
          {inkColours.map((c) => (
            <button
              key={c.value}
              type="button"
              className="ink-pen"
              style={{ '--pen': c.value } as CSSProperties}
              aria-pressed={settings.tool === 'pen' && settings.colour === c.value}
              aria-label={`${c.name} felt tip`}
              title={c.name}
              onClick={() => onChange({ ...settings, tool: 'pen', colour: c.value })}
            />
          ))}
        </div>
        <div className="ink-sizes" role="group" aria-label="Size">
          {(['Thin', 'Medium', 'Thick'] as const).map((label, i) => (
            <button
              key={label}
              type="button"
              className="ink-size"
              style={{ '--dot': `${8 + i * 7}px`, '--pen': settings.tool === 'pen' ? settings.colour : '#24201d' } as CSSProperties}
              aria-pressed={settings.size === i}
              aria-label={label}
              title={label}
              onClick={() => onChange({ ...settings, size: i as InkSettings['size'] })}
            />
          ))}
        </div>
      </div>
      <div className="ink-stickers" role="group" aria-label="Stickers">
        {stickers.map((s) => (
          <button
            key={s.id}
            type="button"
            className="ink-sticker"
            aria-pressed={settings.tool === s.id}
            aria-label={s.name}
            title={s.name}
            onClick={() => onChange({ ...settings, tool: settings.tool === s.id ? 'pen' : s.id })}
          >
            <StickerIcon sticker={s.id} />
          </button>
        ))}
      </div>
      <div className="ink-actions">
        <button type="button" className="ink-action" onClick={() => session.shareIdea(inkIdea(names))}>
          <Icon name="sparkle" size={18} /> Idea
        </button>
        <button type="button" className="ink-action" disabled={!snap.myInk} onClick={() => session.undoInk()}>
          <Icon name="undo" size={18} /> Undo
        </button>
        <button type="button" className="ink-action" disabled={!snap.inkCount} onClick={() => session.wipeInk()}>
          <Icon name="trash" size={18} /> Wipe all
        </button>
        <button type="button" className="ink-action ink-action-save" disabled={saving || !room} onClick={save}>
          <Icon name="camera" size={18} /> {saving ? 'Sharing…' : 'Share to the chat'}
        </button>
      </div>
    </div>
  );
}

function StickerIcon({ sticker }: { sticker: Sticker }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = 40 * dpr;
    c.height = 40 * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const def = stickers.find((s) => s.id === sticker);
    // Wide stickers are drawn smaller so they fit the button.
    const height = def?.emoji ? 30 : sticker === 'nose' ? 24 : 15;
    drawSticker(ctx, sticker, 20, 20, height);
  }, [sticker]);
  return <canvas ref={ref} className="ink-sticker-icon" width={40} height={40} aria-hidden="true" />;
}

/** A suggestion of what to draw, on a slip of paper at the top of the call. */
export function IdeaSlip({ snap, people, me }: { snap: CallSnapshot; people: Map<number, Person>; me: Person }) {
  if (!snap.idea) return null;
  const by = snap.idea.by === me.id ? 'You' : (people.get(snap.idea.by)?.name ?? 'Someone');
  return (
    <div className="call-idea" key={snap.idea.id} role="status">
      <span className="call-idea-lead">{by} had an idea:</span>
      <strong>{snap.idea.text}</strong>
    </div>
  );
}

/**
 * Everyone's picture as it is right now, drawings and all, as instant photos
 * on paper, for saving to the chat.
 */
async function renderCallPicture(session: CallSession, snap: CallSnapshot, me: Person, people: Map<number, Person>): Promise<HTMLCanvasElement> {
  const entries = [
    { peer: session.peerId, person: me as Pick<Person, 'name' | 'avatar'> | undefined, camera: snap.camera && snap.hasVideo },
    ...snap.peers.map((p) => ({ peer: p.peer, person: people.get(p.userId), camera: p.camera })),
  ];
  const cols = entries.length <= 2 ? entries.length : entries.length <= 4 ? 2 : 3;
  const rows = Math.ceil(entries.length / cols);
  const pw = 480;
  const ph = 360;
  const frame = { side: 18, bottom: 64 };
  const pad = 36;
  const titleH = 96;
  const cellW = pw + frame.side * 2;
  const cellH = ph + frame.side + frame.bottom;
  const canvas = document.createElement('canvas');
  canvas.width = pad + cols * (cellW + pad);
  canvas.height = titleH + rows * (cellH + pad) + pad / 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f3ecdf';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const font = getComputedStyle(document.body).fontFamily;
  ctx.fillStyle = '#1b1d21';
  ctx.textAlign = 'center';
  ctx.font = `800 34px ${font}`;
  ctx.fillText('Our video call', canvas.width / 2, 60);

  entries.forEach((entry, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (cellW + pad);
    const y = titleH + row * (cellH + pad);
    ctx.save();
    ctx.translate(x + cellW / 2, y + cellH / 2);
    ctx.rotate(((((i % 3) - 1) * 1.2) * Math.PI) / 180);
    ctx.translate(-cellW / 2, -cellH / 2);
    ctx.shadowColor = 'rgba(60, 40, 10, 0.28)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, cellW, cellH);
    ctx.shadowColor = 'transparent';

    ctx.save();
    ctx.translate(frame.side, frame.side);
    ctx.beginPath();
    ctx.rect(0, 0, pw, ph);
    ctx.clip();
    ctx.fillStyle = '#2a2522';
    ctx.fillRect(0, 0, pw, ph);
    const video = document.querySelector<HTMLVideoElement>(`.tile[data-peer="${entry.peer}"] video`);
    const vw = video?.videoWidth || 640;
    const vh = video?.videoHeight || 480;
    const fit: Fit = { w: pw, h: ph, vw, vh, mirrored: false };
    if (entry.camera && video?.videoWidth) {
      const scale = Math.max(pw / vw, ph / vh);
      ctx.drawImage(video, (pw - vw * scale) / 2, (ph - vh * scale) / 2, vw * scale, vh * scale);
    } else {
      ctx.font = `150px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(entry.person?.avatar ?? '🙂', pw / 2, ph / 2 + 8);
    }
    drawInk(ctx, fit, session.inkOn(entry.peer));
    ctx.restore();

    ctx.fillStyle = '#1b1d21';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 28px ${font}`;
    ctx.fillText(entry.person?.name ?? 'Someone', cellW / 2, ph + frame.side + 42);
    ctx.restore();
  });
  return canvas;
}
