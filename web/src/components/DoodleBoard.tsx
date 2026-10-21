import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  KRAFT,
  LineCollector,
  PAGE_WIDTH,
  crayons,
  drawItem,
  drawPage,
  finishLine,
  isDrawable,
  isPaper,
  liveBlend,
  lineWidth,
  makeShape,
  papers,
  paperIn,
  shapeSize,
  shapes,
  sizes,
  stickers,
  tapTilt,
  tearWidth,
  visibleItems,
  type Item,
  type LineTool,
  type PaperFinish,
  type PaperItem,
  type ShapeKind,
} from '../lib/doodle';

/** 'pen' is the wax crayon; 'tear' tears paper along your finger; 'shape' places cut paper shapes. */
export type ToolKind = LineTool | 'tear' | 'shape' | 'sticker';

export interface Tool {
  kind: ToolKind;
  colour: string;
  size: number;
  sticker: string;
  shape: ShapeKind;
  paper: PaperFinish;
}

export const defaultTool: Tool = { kind: 'felt', colour: '#1f2023', size: 12, sticker: '⭐', shape: 'heart', paper: 'plain' };

const KINDS: readonly string[] = ['felt', 'brush', 'pencil', 'pen', 'marker', 'erase', 'tear', 'shape', 'sticker'];

/** A tool from storage, with anything this version doesn't know put back to the default. */
export function toolFrom(raw: unknown): Tool {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Tool, unknown>>;
  const pick = <T,>(v: unknown, ok: readonly T[], fallback: T): T => (ok.includes(v as T) ? (v as T) : fallback);
  return {
    kind: pick(o.kind, KINDS, defaultTool.kind) as ToolKind,
    colour: pick(o.colour, crayons.map((c) => c.value), defaultTool.colour),
    size: pick(o.size, sizes.map((s) => s.value), defaultTool.size),
    sticker: pick(o.sticker, stickers, defaultTool.sticker),
    shape: pick(o.shape, shapes.map((s) => s.value), defaultTool.shape),
    paper: pick(o.paper, papers.map((p) => p.value), defaultTool.paper),
  };
}

/** Keep a checkpoint of the drawn page every so many items, so undo needn't redraw everything. */
const CHECKPOINT_EVERY = 10;
const CHECKPOINTS_KEPT = 2;

interface Drawn {
  w: number;
  h: number;
  visible: Item[];
  checkpoints: { count: number; canvas: HTMLCanvasElement }[];
}

interface Stroke {
  id: number;
  tool: Tool;
  rect: DOMRect;
  collector: LineCollector;
  start: [number, number];
  at: [number, number];
  /** For shapes: the angle when the drag first moved away, so turning is measured from there. */
  turnFrom: number | null;
  /** For the rubber: how much of the line has been rubbed out on the page already. */
  rubbed: number;
  below: PaperItem[];
}

/**
 * A page to draw on. The background (a photo, or paper) sits underneath, so
 * the rubber only rubs out drawing. Finished items are handed to onAdd; the
 * one being drawn shows straight away, drawn exactly as it will be.
 */
export function DoodleBoard({
  items,
  pageHeight,
  background,
  tool,
  onAdd,
  readOnly,
  label = 'Drawing page',
  user,
}: {
  items: Item[];
  pageHeight: number;
  background?: string | null;
  tool: Tool;
  onAdd?: (item: Item) => void;
  readOnly?: boolean;
  label?: string;
  user?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLCanvasElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const drawn = useRef<Drawn | null>(null);
  const stroke = useRef<Stroke | null>(null);
  const frame = useRef(0);

  // Fit the page to the space it has, keeping its shape.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const box = el.parentElement!.getBoundingClientRect();
      const byHeight = box.height > 0 ? (box.height * PAGE_WIDTH) / pageHeight : Infinity;
      setWidth(Math.max(120, Math.floor(Math.min(box.width, byHeight))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement!);
    return () => ro.disconnect();
  }, [pageHeight]);

  const height = Math.round((width * pageHeight) / PAGE_WIDTH);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const pxW = Math.round(width * dpr);
  const pxH = Math.round(height * dpr);

  // The blank page, when there's no photo.
  useEffect(() => {
    const c = paper.current;
    if (!c || !width) return;
    c.width = pxW;
    c.height = pxH;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(pxW / PAGE_WIDTH, 0, 0, pxW / PAGE_WIDTH, 0, 0);
    drawPage(ctx, PAGE_WIDTH, pageHeight);
  }, [pxW, pxH, width, pageHeight, background]);

  // Draw what's been added: only the new items when the page just grew,
  // from a checkpoint after an undo, or everything when the size changed.
  useEffect(() => {
    const c = canvas.current;
    const l = live.current;
    if (!c || !l || !width) return;
    const visible = visibleItems(items);
    let d = drawn.current;
    if (!d || d.w !== pxW || d.h !== pxH || c.width !== pxW || c.height !== pxH) {
      c.width = l.width = pxW;
      c.height = l.height = pxH;
      d = drawn.current = { w: pxW, h: pxH, visible: [], checkpoints: [] };
    }
    const ctx = c.getContext('2d')!;
    let same = 0;
    const n = Math.min(d.visible.length, visible.length);
    while (same < n && d.visible[same] === visible[same]) same++;
    let from = same;
    if (same < d.visible.length) {
      // Something already drawn was taken away: go back to the last checkpoint before it.
      d.checkpoints = d.checkpoints.filter((cp) => cp.count <= same);
      const cp = d.checkpoints[d.checkpoints.length - 1];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pxW, pxH);
      if (cp) ctx.drawImage(cp.canvas, 0, 0);
      from = cp?.count ?? 0;
    }
    const k = pxW / PAGE_WIDTH;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const below = paperIn(visible.slice(0, from));
    for (let i = from; i < visible.length; i++) {
      const it = visible[i];
      drawItem(ctx, it, below);
      if (isPaper(it) && isDrawable(it)) below.push(it);
      const count = i + 1;
      const last = d.checkpoints[d.checkpoints.length - 1]?.count ?? 0;
      if (count % CHECKPOINT_EVERY === 0 && count > last && visible.length - count < CHECKPOINT_EVERY * 3) {
        const cv = d.checkpoints.length >= CHECKPOINTS_KEPT ? d.checkpoints.shift()!.canvas : document.createElement('canvas');
        cv.width = pxW;
        cv.height = pxH;
        cv.getContext('2d')!.drawImage(c, 0, 0);
        d.checkpoints.push({ count, canvas: cv });
      }
    }
    d.visible = visible;
  }, [items, width, pxW, pxH]);

  // Nothing left half-drawn if the board goes away mid-stroke.
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function toPage(e: { clientX: number; clientY: number }, r: DOMRect): [number, number] {
    const x = ((e.clientX - r.left) / r.width) * PAGE_WIDTH;
    const y = ((e.clientY - r.top) / r.height) * pageHeight;
    return [Math.max(0, Math.min(PAGE_WIDTH, x)), Math.max(0, Math.min(pageHeight, y))];
  }

  const mine = () => (user != null ? { u: user } : {});

  function lineFor(t: Tool, p: number[]): Item {
    const kind = (t.kind === 'tear' || t.kind === 'shape' || t.kind === 'sticker' ? 'felt' : t.kind) as LineTool;
    return { k: 'l', c: kind === 'erase' ? '#000000' : t.colour, w: lineWidth(kind, t.size), p, t: kind, ...mine() };
  }

  function tornFor(t: Tool, p: number[]): Item {
    return { k: 't', c: t.paper === 'kraft' ? KRAFT : t.colour, w: tearWidth(t.size), p, ...(t.paper !== 'plain' ? { f: t.paper } : {}), ...mine() };
  }

  /** A tap places a shape at a set size; a drag sets its size, and turning round the centre turns it. */
  function shapeFor(s: Stroke): Item {
    const [x0, y0] = s.start;
    if (s.turnFrom == null) return { ...makeShape(s.tool.shape, s.tool.colour, s.tool.paper, x0, y0, shapeSize(s.tool.size), tapTilt(x0, y0)), ...mine() };
    const dist = Math.hypot(s.at[0] - x0, s.at[1] - y0);
    const turn = ((Math.atan2(s.at[1] - y0, s.at[0] - x0) - s.turnFrom) * 180) / Math.PI;
    return { ...makeShape(s.tool.shape, s.tool.colour, s.tool.paper, x0, y0, dist, turn), ...mine() };
  }

  function itemFor(s: Stroke): Item | null {
    if (s.tool.kind === 'shape') return shapeFor(s);
    const p = s.collector.points();
    if (p.length < 2) return null;
    return s.tool.kind === 'tear' ? tornFor(s.tool, p) : lineFor(s.tool, p);
  }

  function paint() {
    frame.current = 0;
    const s = stroke.current;
    const l = live.current;
    const c = canvas.current;
    if (!s || !l || !c) return;
    const k = l.width / PAGE_WIDTH;
    const lctx = l.getContext('2d')!;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, l.width, l.height);
    lctx.setTransform(k, 0, 0, k, 0, 0);
    if (s.tool.kind === 'erase') {
      // Rub out on the page as the rubber moves, a piece at a time.
      const kept = s.collector.points();
      if (kept.length >= 2) {
        const from = Math.max(0, s.rubbed - 4);
        const ctx = c.getContext('2d')!;
        ctx.setTransform(k, 0, 0, k, 0, 0);
        drawItem(ctx, lineFor(s.tool, kept.slice(from)), s.below);
        s.rubbed = Math.max(0, kept.length - 2);
      }
      // And show where the rubber is.
      lctx.lineWidth = 1.5 / k;
      lctx.strokeStyle = 'rgba(40,30,20,0.55)';
      lctx.fillStyle = 'rgba(255,255,255,0.35)';
      lctx.beginPath();
      lctx.arc(s.at[0], s.at[1], lineWidth('erase', s.tool.size) / 2, 0, Math.PI * 2);
      lctx.fill();
      lctx.stroke();
      return;
    }
    const it = itemFor(s);
    if (!it) return;
    l.style.mixBlendMode = liveBlend(it);
    drawItem(lctx, it, [], it.k === 'h' || it.k === 't');
  }

  function schedule() {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }

  function down(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (readOnly || !onAdd || stroke.current) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const [x, y] = toPage(e, rect);
    if (tool.kind === 'sticker') {
      onAdd({ k: 's', e: tool.sticker, x: Math.round(x), y: Math.round(y), s: 30 + tool.size * 3, ...mine() });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const collector = new LineCollector();
    collector.add(x, y);
    stroke.current = {
      id: e.pointerId,
      tool,
      rect,
      collector,
      start: [x, y],
      at: [x, y],
      turnFrom: null,
      rubbed: 0,
      below: tool.kind === 'erase' ? paperIn(drawn.current?.visible ?? []) : [],
    };
    schedule();
  }

  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    const s = stroke.current;
    if (!s || s.id !== e.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const pt = toPage(ev, s.rect);
      s.at = pt;
      if (s.tool.kind !== 'shape') s.collector.add(pt[0], pt[1]);
    }
    if (s.tool.kind === 'shape' && s.turnFrom == null) {
      const dist = Math.hypot(s.at[0] - s.start[0], s.at[1] - s.start[1]);
      if (dist > (12 * PAGE_WIDTH) / Math.max(1, width)) s.turnFrom = Math.atan2(s.at[1] - s.start[1], s.at[0] - s.start[0]);
    }
    schedule();
  }

  function up(e: ReactPointerEvent<HTMLCanvasElement>) {
    const s = stroke.current;
    if (!s || s.id !== e.pointerId) return;
    stroke.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const l = live.current!;
    l.getContext('2d')!.clearRect(0, 0, l.width, l.height);
    l.style.mixBlendMode = '';
    let it = itemFor(s);
    if (!it) return;
    if (it.k === 'l' || it.k === 't') it = { ...it, p: finishLine(it.k === 't' ? 'tear' : (it.t ?? 'pen'), it.p) };
    onAdd?.(it);
  }

  return (
    <div className="board-fit">
      <div ref={wrap} className="board" style={{ width, height }}>
        {background ? (
          <img className="board-bg" src={background} alt="" draggable={false} />
        ) : (
          <canvas ref={paper} className="board-paper" style={{ width, height }} aria-hidden="true" />
        )}
        <canvas
          ref={canvas}
          className="board-canvas"
          role="img"
          aria-label={label}
          style={{ width, height }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          data-tool={readOnly ? 'none' : tool.kind}
        />
        <canvas ref={live} className="board-live" style={{ width, height }} aria-hidden="true" />
      </div>
    </div>
  );
}
