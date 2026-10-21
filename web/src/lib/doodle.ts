// The drawing model shared by doodles on photos and the doodle games.
// Coordinates are in a page 1000 units wide, so a drawing looks the same on a
// phone and a tablet. Pages keep the shape of the photo under them.
//
// A drawing is a list of items: pen lines, cut and torn paper stuck on the
// page, stickers, and undos. Every item draws the same on every device: any
// texture or wobble comes from a seed made from the item's own data, and the
// grain of the paper is fixed to the page, never Math.random at draw time.

export const PAGE_WIDTH = 1000;

/** How a line is drawn. 'pen' is the wax crayon (its name from before there were other pens). */
export type LineTool = 'felt' | 'brush' | 'pencil' | 'pen' | 'marker' | 'erase';
export type ShapeKind = 'circle' | 'heart' | 'star' | 'triangle' | 'square' | 'rect' | 'cloud' | 'leaf' | 'flower' | 'bubble';
export type PaperFinish = 'plain' | 'kraft' | 'tissue' | 'dots' | 'gingham';

/** A line: colour, width, points as [x0, y0, x1, y1, ...], and the tool. */
export type LineItem = { k: 'l'; c: string; w: number; p: number[]; t?: LineTool; u?: number };
/** A sticker: emoji at a point, size in page units. */
export type StickerItem = { k: 's'; e: string; x: number; y: number; s: number; u?: number };
/** A cut paper shape: centre, half-size in page units, turn in degrees, and paper. */
export type ShapeItem = { k: 'h'; h: ShapeKind; c: string; x: number; y: number; s: number; r: number; f?: PaperFinish; u?: number };
/** Torn paper: a strip torn along the points, or a patch when the path closes on itself. */
export type TornItem = { k: 't'; c: string; w: number; p: number[]; f?: PaperFinish; u?: number };
/** Takes back an earlier item, by its index. Live games only ever add to the list, so an undo is an item too. */
export type UndoItem = { k: 'x'; i: number; u?: number };

export type Item = LineItem | StickerItem | ShapeItem | TornItem | UndoItem;
export type PaperItem = ShapeItem | TornItem;

export const crayons = [
  { name: 'Ink', value: '#1f2023' },
  { name: 'Pebble', value: '#8b8f96' },
  { name: 'Chalk', value: '#ffffff' },
  { name: 'Poppy', value: '#e5484d' },
  { name: 'Tangerine', value: '#f08c2e' },
  { name: 'Sunshine', value: '#f6c945' },
  { name: 'Leaf', value: '#46a758' },
  { name: 'Teal', value: '#1f9e95' },
  { name: 'Sky', value: '#3e8ee8' },
  { name: 'Plum', value: '#8e5bd6' },
  { name: 'Bubblegum', value: '#f07bb4' },
  { name: 'Conker', value: '#8a5a3b' },
  { name: 'Cocoa', value: '#5b3a28' },
  { name: 'Cinnamon', value: '#a96c42' },
  { name: 'Honey', value: '#d9a06c' },
  { name: 'Peach', value: '#f4cdb0' },
  { name: 'Butter', value: '#fbe6a2' },
  { name: 'Mint', value: '#b4e2c5' },
  { name: 'Powder blue', value: '#bad7f4' },
  { name: 'Lavender', value: '#d4c4f2' },
  { name: 'Blossom', value: '#f8c6d6' },
];

export const sizes = [
  { name: 'Thin', value: 5 },
  { name: 'Medium', value: 12 },
  { name: 'Thick', value: 26 },
];

export const stickers = ['⭐', '❤️', '🌈', '🌸', '🦄', '🐶', '🐻', '🌞', '🎈', '👑', '🍦', '🦋'];

export const shapes: { name: string; value: ShapeKind }[] = [
  { name: 'Circle', value: 'circle' },
  { name: 'Heart', value: 'heart' },
  { name: 'Star', value: 'star' },
  { name: 'Triangle', value: 'triangle' },
  { name: 'Square', value: 'square' },
  { name: 'Rectangle', value: 'rect' },
  { name: 'Cloud', value: 'cloud' },
  { name: 'Leaf', value: 'leaf' },
  { name: 'Flower', value: 'flower' },
  { name: 'Speech bubble', value: 'bubble' },
];

export const papers: { name: string; value: PaperFinish }[] = [
  { name: 'Plain paper', value: 'plain' },
  { name: 'Kraft paper', value: 'kraft' },
  { name: 'Tissue paper', value: 'tissue' },
  { name: 'Spotty paper', value: 'dots' },
  { name: 'Gingham paper', value: 'gingham' },
];

/** Kraft paper is always brown, whatever colour is chosen. */
export const KRAFT = '#c49a6a';
/** The colour of a blank page. */
export const PAGE_PAPER = '#fffdf8';

const LINE_TOOLS: readonly string[] = ['felt', 'brush', 'pencil', 'pen', 'marker', 'erase'];
const SHAPE_KINDS: readonly string[] = shapes.map((s) => s.value);
const FINISHES: readonly string[] = papers.map((p) => p.value);

/** How wide a line is for a tool at a size from `sizes`. */
export function lineWidth(tool: LineTool, size: number): number {
  const w =
    tool === 'felt'
      ? size
      : tool === 'brush'
        ? size * 1.6
        : tool === 'pencil'
          ? Math.max(2.5, size * 0.5)
          : tool === 'marker'
            ? size * 1.8
            : tool === 'erase'
              ? size * 2.2
              : size * 1.15;
  return Math.round(w * 10) / 10;
}

/** How wide a torn strip is, for a size from `sizes`. */
export const tearWidth = (size: number) => 14 + size * 3;
/** The half-size of a shape placed with a tap, for a size from `sizes`. */
export const shapeSize = (size: number) => Math.round(24 + size * 2.6);

// ---------- Items ----------

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isPoints = (p: unknown): p is number[] => Array.isArray(p) && p.length >= 2 && p.length % 2 === 0 && p.every(num);

/** Whether something (perhaps from the network) is an item this version can draw. */
export function isDrawable(it: unknown): it is Exclude<Item, UndoItem> {
  if (!it || typeof it !== 'object') return false;
  const o = it as Record<string, unknown>;
  switch (o.k) {
    case 'l':
      return typeof o.c === 'string' && num(o.w) && o.w > 0 && isPoints(o.p) && (o.t == null || LINE_TOOLS.includes(o.t as string));
    case 't':
      return typeof o.c === 'string' && num(o.w) && o.w > 0 && isPoints(o.p);
    case 's':
      return typeof o.e === 'string' && num(o.x) && num(o.y) && num(o.s) && o.s > 0;
    case 'h':
      return typeof o.c === 'string' && SHAPE_KINDS.includes(o.h as string) && num(o.x) && num(o.y) && num(o.s) && o.s > 0 && num(o.r);
    default:
      return false;
  }
}

export const isPaper = (it: Item): it is PaperItem => it.k === 'h' || it.k === 't';

/** The items still showing once undos are applied. */
export function visibleItems(items: Item[]): Item[] {
  const undone = new Set<number>();
  let marks = false;
  for (const item of items) {
    if (!item || item.k === 'x') marks = true;
    if (item && item.k === 'x') undone.add(item.i);
  }
  return marks ? items.filter((it, i) => it && it.k !== 'x' && !undone.has(i)) : items;
}

/** The index of someone's latest item that hasn't been undone, or -1. */
export function lastUndoable(items: Item[], user: number): number {
  const undone = new Set<number>();
  for (const item of items) if (item && item.k === 'x') undone.add(item.i);
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it && it.k !== 'x' && it.u === user && !undone.has(i)) return i;
  }
  return -1;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Drops points closer together than the threshold, and rounds them, to keep strokes small. */
export function simplify(points: number[], threshold = 1.5): number[] {
  if (points.length <= 4) return points.map(round1);
  const out = [points[0], points[1]];
  for (let i = 2; i < points.length - 2; i += 2) {
    const dx = points[i] - out[out.length - 2];
    const dy = points[i + 1] - out[out.length - 1];
    if (dx * dx + dy * dy >= threshold * threshold) out.push(points[i], points[i + 1]);
  }
  out.push(points[points.length - 2], points[points.length - 1]);
  return out.map(round1);
}

/**
 * Collects a line as it's drawn, keeping points the way simplify() does, so
 * the line drawn live is the line that's sent.
 */
export class LineCollector {
  readonly kept: number[] = [];
  private lastX = 0;
  private lastY = 0;
  private threshold: number;
  constructor(threshold = 1.5) {
    this.threshold = threshold;
  }
  add(x: number, y: number) {
    this.lastX = x;
    this.lastY = y;
    const k = this.kept;
    if (!k.length) {
      k.push(round1(x), round1(y));
      return;
    }
    const dx = x - k[k.length - 2];
    const dy = y - k[k.length - 1];
    if (dx * dx + dy * dy >= this.threshold * this.threshold) k.push(round1(x), round1(y));
  }
  /** The line so far, ending where the finger is. */
  points(): number[] {
    const k = this.kept;
    const x = round1(this.lastX), y = round1(this.lastY);
    return k.length >= 2 && (x !== k[k.length - 2] || y !== k[k.length - 1]) ? [...k, x, y] : k.slice();
  }
}

/**
 * Drops points that sit within `epsilon` of a straight line between their
 * neighbours (Ramer–Douglas–Peucker), for lines whose look doesn't depend on
 * how fast they were drawn. Keeps the first and last points.
 */
export function straighten(p: number[], epsilon = 0.35): number[] {
  const n = p.length / 2;
  if (n <= 2) return p.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = p[a * 2], ay = p[a * 2 + 1];
    const dx = p[b * 2] - ax, dy = p[b * 2 + 1] - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = p[i * 2] - ax, py = p[i * 2 + 1] - ay;
      const d = len > 1e-6 ? Math.abs(px * dy - py * dx) / len : Math.hypot(px, py);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > epsilon) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

/** The points to send for a finished line. The brush keeps every point: their spacing says how fast it moved. */
export function finishLine(tool: LineTool | 'tear', p: number[]): number[] {
  return tool === 'brush' ? p : straighten(p);
}

export function pageHeightFor(width: number | null | undefined, height: number | null | undefined, fallback = 750): number {
  if (!width || !height) return fallback;
  return Math.round((PAGE_WIDTH * height) / width);
}

/** A shape placed by pressing at its centre and dragging out: the drag sets its size and turn. */
export function makeShape(kind: ShapeKind, colour: string, finish: PaperFinish, x: number, y: number, size: number, turn: number): ShapeItem {
  return {
    k: 'h',
    h: kind,
    c: finish === 'kraft' ? KRAFT : colour,
    x: round1(x),
    y: round1(y),
    s: Math.round(Math.max(10, Math.min(480, size))),
    r: Math.round((((turn % 360) + 540) % 360) - 180),
    ...(finish !== 'plain' ? { f: finish } : {}),
  };
}

/** A gentle tilt for a shape placed with a tap, from where it was placed. */
export function tapTilt(x: number, y: number): number {
  return Math.round((hash32('tilt', x, y) / 4294967296) * 14 - 7);
}

// ---------- Seeded randomness ----------

/** FNV-1a over the parts; numbers count to a tenth, as items store them. */
export function hash32(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = typeof part === 'number' ? String(Math.round(part * 10)) : part;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x7c;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The seed for an item's texture. A line's comes from where it starts, so it
 * looks the same while it's being drawn as once it's sent.
 */
export function seedOf(it: Item): number {
  switch (it.k) {
    case 'l':
      return hash32('l', it.t ?? 'pen', it.c, it.w, it.p[0], it.p[1]);
    case 't':
      return hash32('t', it.f ?? 'plain', it.c, it.w, it.p[0], it.p[1]);
    case 'h':
      return hash32('h', it.h, it.c, it.f ?? 'plain', it.x, it.y, it.s, it.r);
    case 's':
      return hash32('s', it.e, it.x, it.y, it.s);
    default:
      return 0;
  }
}

function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A small, fast seeded generator (mulberry32): numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lattice1 = (seed: number, i: number) => (mix32((seed ^ Math.imul(i | 0, 0x9e3779b1)) >>> 0) / 4294967296) * 2 - 1;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth noise along a line, in [-1, 1]. */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const a = lattice1(seed, i);
  return a + (lattice1(seed, i + 1) - a) * smooth(x - i);
}

/** Noise with finer wobbles on top, in [-1, 1]. */
export function fbm1(seed: number, x: number, octaves = 3): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise1(seed + o * 7919, x * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.07;
  }
  return sum / norm;
}

/** Spreads values evenly over [0, 1], keeping their order. */
export function equalize(v: Float32Array): Float32Array {
  const idx = new Uint32Array(v.length);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  idx.sort((a, b) => v[a] - v[b]);
  const out = new Float32Array(v.length);
  const last = Math.max(1, v.length - 1);
  for (let r = 0; r < idx.length; r++) out[idx[r]] = r / last;
  return out;
}

/**
 * Value noise on a square that tiles seamlessly, for paper grain. Each octave
 * is [cells across, weight]. Values are spread evenly over [0, 1].
 */
export function noiseTile(size: number, seed: number, octaves: [number, number][]): Float32Array {
  const out = new Float32Array(size * size);
  for (const [cells, amp] of octaves) {
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = mix32((seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(cells, 0x85ebca6b)) >>> 0) / 4294967296;
    const scale = cells / size;
    for (let y = 0; y < size; y++) {
      const fy = y * scale, iy = Math.floor(fy), ty = smooth(fy - iy);
      const y0 = (iy % cells) * cells, y1 = ((iy + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const fx = x * scale, ix = Math.floor(fx), tx = smooth(fx - ix);
        const x0 = ix % cells, x1 = (ix + 1) % cells;
        const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * tx;
        const b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * tx;
        out[y * size + x] += amp * (a + (b - a) * ty);
      }
    }
  }
  return equalize(out);
}

// ---------- Geometry ----------

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
const smoothstep = (a: number, b: number, x: number) => smooth(clamp((x - a) / (b - a), 0, 1));

/** A line resampled into short straight steps along its smoothed curve. */
export interface Trail {
  x: number[];
  y: number[];
  /** Distance along the line at each sample. */
  s: number[];
  /** Where each sample sits among the original points (1.5 is halfway from the second to the third). */
  at: number[];
  len: number;
}

/**
 * Smooths a line through the midpoints between its points (as lines always
 * have been drawn) and samples it about every `step` units.
 */
export function trail(p: number[], step = 1.5): Trail {
  const t: Trail = { x: [p[0]], y: [p[1]], s: [0], at: [0], len: 0 };
  const n = p.length / 2;
  const push = (x: number, y: number, at: number) => {
    const i = t.x.length - 1;
    const d = Math.hypot(x - t.x[i], y - t.y[i]);
    if (d < 1e-6) return;
    t.x.push(x);
    t.y.push(y);
    t.s.push(t.s[i] + d);
    t.at.push(at);
  };
  if (n === 2) {
    const d = Math.hypot(p[2] - p[0], p[3] - p[1]);
    const m = Math.max(1, Math.ceil(d / step));
    for (let j = 1; j <= m; j++) push(p[0] + ((p[2] - p[0]) * j) / m, p[1] + ((p[3] - p[1]) * j) / m, j / m);
  } else if (n > 2) {
    let sx = p[0], sy = p[1];
    for (let i = 1; i <= n - 2; i++) {
      const cx = p[i * 2], cy = p[i * 2 + 1];
      const last = i === n - 2;
      const ex = last ? p[i * 2 + 2] : (cx + p[i * 2 + 2]) / 2;
      const ey = last ? p[i * 2 + 3] : (cy + p[i * 2 + 3]) / 2;
      const est = Math.hypot(cx - sx, cy - sy) + Math.hypot(ex - cx, ey - cy);
      const m = Math.max(1, Math.ceil(est / step));
      for (let j = 1; j <= m; j++) {
        const u = j / m, v = 1 - u;
        push(v * v * sx + 2 * v * u * cx + u * u * ex, v * v * sy + 2 * v * u * cy + u * u * ey, i - 0.5 + u * (last ? 1.5 : 1));
      }
      sx = ex;
      sy = ey;
    }
  }
  t.len = t.s[t.s.length - 1];
  return t;
}

/** Unit normals along a trail, pointing to the left of the way it goes. */
function normals(t: Trail, closed = false): [number[], number[]] {
  const n = t.x.length;
  const nx = new Array<number>(n), ny = new Array<number>(n);
  for (let j = 0; j < n; j++) {
    const a = closed ? (j - 1 + n) % n : Math.max(0, j - 1);
    const b = closed ? (j + 1) % n : Math.min(n - 1, j + 1);
    let dx = t.x[b] - t.x[a], dy = t.y[b] - t.y[a];
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) {
      dx = 1;
      dy = 0;
    } else {
      dx /= d;
      dy /= d;
    }
    nx[j] = dy;
    ny[j] = -dx;
  }
  return [nx, ny];
}

/** The spacing between the original points along a trail: how fast the line was drawn there. */
export function trailSpeed(t: Trail, p: number[]): number[] {
  const n = p.length / 2;
  const gap = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    gap[i] = b > a ? Math.hypot(p[b * 2] - p[a * 2], p[b * 2 + 1] - p[a * 2 + 1]) / (b - a) : 2;
  }
  return t.at.map((f) => {
    const c = clamp(f, 0, n - 1), i = Math.floor(c), u = c - i;
    return gap[i] + (gap[Math.min(n - 1, i + 1)] - gap[i]) * u;
  });
}

/**
 * The half-width of a brush stroke along its trail: it swells where the
 * brush moved slowly (points close together), thins where it flicked fast,
 * and tapers in and out.
 */
export function brushWidths(t: Trail, p: number[], w: number, seed: number): number[] {
  const m = t.x.length;
  const speed = trailSpeed(t, p);
  // Ease the speed along the line so the width doesn't jitter.
  for (let j = 1; j < m; j++) speed[j] += (speed[j - 1] - speed[j]) * 0.82;
  for (let j = m - 2; j >= 0; j--) speed[j] += (speed[j + 1] - speed[j]) * 0.82;
  const len = t.len;
  const out = new Array<number>(m);
  if (len < w * 0.6) return out.fill(w * 0.46);
  const into = Math.min(len * 0.22, w * 1.1 + 4);
  const outOf = Math.min(len * 0.4, w * 2.6 + 8);
  for (let j = 0; j < m; j++) {
    const s = t.s[j];
    const sp = 1.22 - 0.72 * smoothstep(2.5, 20, speed[j]);
    const a = 0.3 + 0.7 * Math.sin((Math.PI / 2) * clamp(s / into, 0, 1));
    const b = 0.06 + 0.94 * Math.sin((Math.PI / 2) * clamp((len - s) / outOf, 0, 1));
    const wob = 1 + 0.07 * noise1(seed, s / (w * 1.7 + 6));
    out[j] = (w / 2) * sp * Math.min(a, b) * wob;
  }
  return out;
}

// Shapes are drawn in a unit box (about -1..1), y downwards, clockwise on screen.

function circlePts(r: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    out.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return out;
}

/** The outline of a union of circles, seen from a point inside it, cut flat below `floor`. */
function blobPts(circles: [number, number, number][], ox: number, oy: number, n: number, floor = Infinity): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = 0;
    for (const [cx, cy, r] of circles) {
      const fx = ox - cx, fy = oy - cy;
      const b = fx * dx + fy * dy;
      const disc = b * b - (fx * fx + fy * fy - r * r);
      if (disc >= 0) best = Math.max(best, -b + Math.sqrt(disc));
    }
    if (dy > 1e-6) best = Math.min(best, (floor - oy) / dy);
    out.push(ox + dx * best, oy + dy * best);
  }
  return out;
}

function polyPts(corners: number[][], perEdge: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < corners.length; i++) {
    const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % corners.length];
    for (let j = 0; j < perEdge; j++) out.push(ax + ((bx - ax) * j) / perEdge, ay + ((by - ay) * j) / perEdge);
  }
  return out;
}

const outlines = new Map<ShapeKind, number[]>();

/** A shape's outline in a unit box, as [x0, y0, x1, y1, ...], closed. */
export function shapeOutline(kind: ShapeKind): number[] {
  const known = outlines.get(kind);
  if (known) return known;
  let pts: number[];
  switch (kind) {
    case 'heart': {
      pts = [];
      const n = 120;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        pts.push(x / 16.5, (y + 2.2) / 16.5);
      }
      break;
    }
    case 'star': {
      const c: number[][] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 ? 0.44 : 1;
        c.push([Math.cos(a) * r, Math.sin(a) * r + 0.08]);
      }
      pts = polyPts(c, 8);
      break;
    }
    case 'triangle':
      pts = polyPts(
        [
          [0, -0.92],
          [1, 0.82],
          [-1, 0.82],
        ],
        30,
      );
      break;
    case 'square':
      pts = polyPts(
        [
          [-0.86, -0.86],
          [0.86, -0.86],
          [0.86, 0.86],
          [-0.86, 0.86],
        ],
        20,
      );
      break;
    case 'rect':
      pts = polyPts(
        [
          [-1, -0.5],
          [1, -0.5],
          [1, 0.5],
          [-1, 0.5],
        ],
        20,
      );
      break;
    case 'cloud':
      pts = blobPts(
        [
          [-0.62, 0.16, 0.36],
          [-0.24, -0.16, 0.46],
          [0.26, -0.3, 0.44],
          [0.66, 0.06, 0.36],
          [0.1, 0.18, 0.4],
        ],
        0,
        0.05,
        180,
        0.5,
      );
      break;
    case 'leaf': {
      // Two arcs meeting in points, leaning a little, with a stalk.
      const R = 1.18, d = R - 0.56;
      const side = (y: number) => Math.sqrt(Math.max(0, R * R - y * y)) - d;
      pts = [];
      const n = 48;
      for (let i = 0; i <= n; i++) {
        const y = -1 + (2 * i) / n;
        pts.push(side(y) + 0.12 * (1 - y * y), y * 0.92);
      }
      pts.push(0.035, 1.04, 0.04, 1.2, -0.04, 1.2, -0.035, 1.04);
      for (let i = n; i >= 0; i--) {
        const y = -1 + (2 * i) / n;
        pts.push(-side(y) + 0.12 * (1 - y * y), y * 0.92);
      }
      break;
    }
    case 'flower': {
      const c: [number, number, number][] = [[0, 0, 0.5]];
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
        c.push([Math.cos(a) * 0.56, Math.sin(a) * 0.56, 0.42]);
      }
      pts = blobPts(c, 0, 0, 200);
      break;
    }
    case 'bubble': {
      // A rounded body with a tail to the lower left.
      const rx = 1, ry = 0.7, cy = -0.12;
      const a0 = (112 * Math.PI) / 180, a1 = (136 * Math.PI) / 180;
      pts = [];
      const n = 90;
      for (let i = 0; i <= n; i++) {
        const a = a1 + ((Math.PI * 2 - (a1 - a0)) * i) / n;
        pts.push(Math.cos(a) * rx, cy + Math.sin(a) * ry);
      }
      pts.push(-0.62, 0.92);
      break;
    }
    default:
      pts = circlePts(0.95, 120);
  }
  outlines.set(kind, pts);
  return pts;
}

/**
 * A shape cut out with scissors: the outline turned and scaled onto the
 * page, then cut as short straight snips that wander a little, with a sharp
 * point wherever the outline turns a corner. Returns [x0, y0, ...], closed.
 */
export function cutShape(it: Pick<ShapeItem, 'h' | 'x' | 'y' | 's' | 'r'>, seed = hash32('h', it.h, it.x, it.y, it.s, it.r)): number[] {
  const base = shapeOutline(it.h);
  const n = base.length / 2;
  const a = (it.r * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const xs = new Array<number>(n), ys = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const bx = base[i * 2] * it.s, by = base[i * 2 + 1] * it.s;
    xs[i] = it.x + bx * cos - by * sin;
    ys[i] = it.y + bx * sin + by * cos;
  }
  // Corners: where the outline turns sharply.
  const corner = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n, q = (i + 1) % n;
    const ax = xs[i] - xs[p], ay = ys[i] - ys[p], bx = xs[q] - xs[i], by = ys[q] - ys[i];
    if (Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) > 0.42) corner[i] = 1;
  }
  const start = Math.max(0, corner.indexOf(1));
  const R = rng(seed);
  const out: number[] = [];
  const jitter = Math.min(0.7, 0.25 + it.s * 0.006);
  const drift = Math.min(1.6, it.s * 0.018);
  let since = 0, arc = 0;
  let next = 4 + R() * 9;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (k > 0) {
      const p = (i - 1 + n) % n;
      const d = Math.hypot(xs[i] - xs[p], ys[i] - ys[p]);
      since += d;
      arc += d;
    }
    if (k === 0 || corner[i] || since >= next) {
      const p = (i - 1 + n) % n, q = (i + 1) % n;
      let nx = ys[q] - ys[p], ny = xs[p] - xs[q];
      const nd = Math.hypot(nx, ny) || 1;
      nx /= nd;
      ny /= nd;
      const off = corner[i] ? (R() - 0.5) * jitter : (R() * 2 - 1) * jitter + drift * noise1(seed, arc / 45);
      out.push(xs[i] + nx * off, ys[i] + ny * off);
      since = 0;
      next = 4 + R() * 9;
    }
  }
  return out;
}

/** Whether a torn path closes on itself, so it tears out a patch rather than a strip. */
export function isLoop(p: number[]): boolean {
  const n = p.length / 2;
  if (n < 6) return false;
  let len = 0, minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = p[i * 2], y = p[i * 2 + 1];
    if (i) len += Math.hypot(x - p[i * 2 - 2], y - p[i * 2 - 1]);
    minx = Math.min(minx, x);
    maxx = Math.max(maxx, x);
    miny = Math.min(miny, y);
    maxy = Math.max(maxy, y);
  }
  const gap = Math.hypot(p[0] - p[n * 2 - 2], p[1] - p[n * 2 - 1]);
  return len > 150 && Math.min(maxx - minx, maxy - miny) > 45 && gap < Math.max(30, len * 0.08);
}

export interface TornGeometry {
  /** Polygons whose union is the whole piece, white torn core and all. */
  outer: number[][];
  /** Polygons whose union is the coloured face. */
  face: number[][];
  /** Loose fibres at the torn edge, as segments [x0, y0, x1, y1, ...]. */
  fibres: number[];
  closed: boolean;
}

/** How far a torn edge wanders, along the edge. */
function tearWobble(seed: number, s: number): number {
  return 2.4 * noise1(seed, s / 36) + 1.2 * noise1(seed + 1, s / 10.5) + 0.65 * noise1(seed + 2, s / 3.3) + 0.3 * noise1(seed + 3, s / 1.4);
}

/** How wide the white core shows along a torn edge: wider on the side the tear ran over. */
function rimWidth(seed: number, s: number, wide: boolean): number {
  const v = noise1(seed + 11, s / 24) * 0.7 + noise1(seed + 12, s / 7) * 0.3;
  return wide ? 1 + 2.6 * Math.max(0, v + 0.45) : 0.45 + 1.1 * Math.max(0, v + 0.2);
}

/** The convex hull of some points (monotone chain), as a polygon. */
export function hull(pts: number[]): number[] {
  const idx = Array.from({ length: pts.length / 2 }, (_, i) => i).sort((a, b) => pts[a * 2] - pts[b * 2] || pts[a * 2 + 1] - pts[b * 2 + 1]);
  const cross = (o: number, a: number, b: number) =>
    (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) - (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
  const lower: number[] = [], upper: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  const ring = lower.slice(0, -1).concat(upper.slice(0, -1));
  return ring.flatMap((i) => [pts[i * 2], pts[i * 2 + 1]]);
}

/** A polygon turned so it runs clockwise on screen, so overlapping polygons fill as one. */
function orient(poly: number[]): number[] {
  let area = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1];
  }
  if (area >= 0) return poly;
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(poly[i * 2], poly[i * 2 + 1]);
  return out;
}

/** The shape of a piece of torn paper. */
export function tearGeometry(it: Pick<TornItem, 'w' | 'p' | 'f'>, seed: number, patch = false): TornGeometry {
  const tissue = it.f === 'tissue';
  const R = rng(seed ^ 0x5bd1e995);
  const fibres: number[] = [];
  const addFibre = (x: number, y: number, nx: number, ny: number) => {
    if (R() > (tissue ? 0.7 : 0.5)) return;
    const turn = (R() - 0.5) * 1.3;
    const c = Math.cos(turn), s = Math.sin(turn);
    const dx = nx * c - ny * s, dy = nx * s + ny * c;
    const len = 0.8 + R() * R() * 3.6;
    const back = 0.4 + R() * 0.8;
    fibres.push(x - dx * back, y - dy * back, x + dx * len, y + dy * len);
  };

  if (patch || isLoop(it.p)) {
    const ring = it.p.concat(it.p[0], it.p[1]);
    const t = trail(ring, 1.5);
    const n = t.x.length - 1;
    // Which way is out: the path may go round either way.
    let area = 0;
    for (let j = 0; j < n; j++) area += t.x[j] * t.y[j + 1] - t.x[j + 1] * t.y[j];
    const out = area > 0 ? -1 : 1;
    const [nx, ny] = normals({ ...t, x: t.x.slice(0, n), y: t.y.slice(0, n) }, true);
    const outer: number[] = [], face: number[] = [];
    for (let j = 0; j < n; j++) {
      const s = t.s[j];
      const ox = nx[j] * out, oy = ny[j] * out;
      const e = tearWobble(seed, s);
      const rim = tissue ? 0 : rimWidth(seed, s, true);
      outer.push(t.x[j] + ox * e, t.y[j] + oy * e);
      const f = e - rim + (tissue ? 0 : 0.35 * noise1(seed + 21, s / 1.7));
      face.push(t.x[j] + ox * f, t.y[j] + oy * f);
      if (j % 2 === 0) addFibre(t.x[j] + ox * e, t.y[j] + oy * e, ox, oy);
    }
    return { outer: [orient(outer)], face: [orient(face)], fibres, closed: true };
  }

  const t = trail(it.p, 1.5);
  const n = t.x.length;
  const hw = it.w / 2;
  if (n < 2 || t.len < 4) {
    // A tap tears off a small scrap.
    const cx = it.p[0], cy = it.p[1];
    const r = Math.max(18, it.w * 0.75);
    // A lopsided oval, turned whichever way it came off.
    const turn = (seed % 628) / 100, c = Math.cos(turn), sn = Math.sin(turn);
    const ring: number[] = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const k = r * (1 + 0.16 * noise1(seed + 7, i / 3.5));
      const x = Math.cos(a) * k, y = Math.sin(a) * k * 0.78;
      ring.push(Math.round((cx + x * c - y * sn) * 10) / 10, Math.round((cy + x * sn + y * c) * 10) / 10);
    }
    return tearGeometry({ ...it, p: ring }, seed, true);
  }
  const [nx, ny] = normals(t);
  const outer: number[][] = [], face: number[][] = [];
  // Each side wanders on its own, and the width changes slowly too.
  const L: number[] = [], Rt: number[] = [], Lf: number[] = [], Rf: number[] = [];
  for (let j = 0; j < n; j++) {
    const s = t.s[j];
    const slow = 1 + 0.1 * fbm1(seed + 31, s / 120, 2);
    const el = hw * slow + tearWobble(seed + 40, s);
    const er = hw * slow + tearWobble(seed + 50, s);
    const rl = tissue ? 0 : rimWidth(seed + 60, s, true);
    const rr = tissue ? 0 : rimWidth(seed + 70, s, false);
    L.push(t.x[j] + nx[j] * el, t.y[j] + ny[j] * el);
    Rt.push(t.x[j] - nx[j] * er, t.y[j] - ny[j] * er);
    const jl = tissue ? 0 : 0.35 * noise1(seed + 80, s / 1.7);
    const jr = tissue ? 0 : 0.35 * noise1(seed + 90, s / 1.7);
    Lf.push(t.x[j] + nx[j] * (el - rl + jl), t.y[j] + ny[j] * (el - rl + jl));
    Rf.push(t.x[j] - nx[j] * (er - rr + jr), t.y[j] - ny[j] * (er - rr + jr));
    if (j % 2 === 0) {
      addFibre(L[j * 2], L[j * 2 + 1], nx[j], ny[j]);
      addFibre(Rt[j * 2], Rt[j * 2 + 1], -nx[j], -ny[j]);
    }
  }
  // Ragged ends, torn across: points from the right edge round to the left one.
  const cap = (j: number, away: number, salt: number) => {
    const dx = -ny[j] * away, dy = nx[j] * away;
    const lx = L[j * 2], ly = L[j * 2 + 1], rx = Rt[j * 2], ry = Rt[j * 2 + 1];
    const flx = Lf[j * 2], fly = Lf[j * 2 + 1], frx = Rf[j * 2], fry = Rf[j * 2 + 1];
    const width = Math.hypot(lx - rx, ly - ry);
    const steps = Math.max(4, Math.ceil(width / 1.5));
    const o: number[] = [], f: number[] = [];
    for (let i = 1; i < steps; i++) {
      const u = i / steps;
      const bulge = width * 0.12 * Math.sin(Math.PI * u) + tearWobble(seed + salt, u * width) * 0.9 + 1.5;
      const bx = rx + (lx - rx) * u + dx * bulge, by = ry + (ly - ry) * u + dy * bulge;
      o.push(bx, by);
      const rim = tissue ? 0 : rimWidth(seed + salt, u * width, salt % 2 === 0) * 0.8;
      f.push(frx + (flx - frx) * u + dx * (bulge - rim), fry + (fly - fry) * u + dy * (bulge - rim));
      if (i % 2 === 0) addFibre(bx, by, dx, dy);
    }
    return { o, f };
  };
  const reversePts = (a: number[]) => {
    const out: number[] = [];
    for (let i = a.length - 2; i >= 0; i -= 2) out.push(a[i], a[i + 1]);
    return out;
  };
  const head = cap(0, -1, 100), tail = cap(n - 1, 1, 201);
  outer.push(orient([...head.o, ...L, ...reversePts(tail.o), ...reversePts(Rt)]));
  face.push(orient([...head.f, ...Lf, ...reversePts(tail.f), ...reversePts(Rf)]));
  return { outer, face, fibres, closed: false };
}

// ---------- Colour ----------

type RGB = [number, number, number];
const BLACK: RGB = [20, 17, 15];
const WHITE: RGB = [255, 255, 255];

export function parseColour(c: unknown): RGB {
  if (typeof c === 'string') {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.replace(/./g, (ch) => ch + ch);
      const v = parseInt(h, 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }
    const r = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c);
    if (r) return [+r[1], +r[2], +r[3]];
  }
  return [31, 32, 35];
}

const mixC = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.round(a * 1000) / 1000})`;
/** Roughly how light a colour looks, 0 to 1. */
export const lightness = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

// ---------- Paper grain and other textures ----------
// Made once, from fixed seeds, so they're the same on every device. Pen grain
// is fixed to the page, like the tooth of a real sheet of paper.

type Tex = 'tooth' | 'pencil' | 'edge' | 'fibres' | 'flecks' | 'page';

const TILE = 256;
/** Page units covered by each texture tile. */
const TILE_UNITS: Record<Tex, number> = { tooth: 150, pencil: 110, edge: 150, fibres: 190, flecks: 170, page: 150 };

let tiles: Record<Tex, HTMLCanvasElement> | null = null;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function maskTile(v: Float32Array, alpha: (v: number) => number, tone: RGB = [0, 0, 0]): HTMLCanvasElement {
  const c = canvas(TILE, TILE);
  const g = c.getContext('2d')!;
  const img = g.createImageData(TILE, TILE);
  for (let i = 0; i < v.length; i++) {
    img.data[i * 4] = tone[0];
    img.data[i * 4 + 1] = tone[1];
    img.data[i * 4 + 2] = tone[2];
    img.data[i * 4 + 3] = Math.round(clamp(alpha(v[i]), 0, 1) * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Fibres in paper: short wavy threads, some lighter, some darker, wrapping round the tile. */
function fibreTile(seed: number, count: number, dark: number, light: number, flecks = 0): HTMLCanvasElement {
  const c = canvas(TILE, TILE);
  const g = c.getContext('2d')!;
  const R = rng(seed);
  // A soft cloudiness first.
  const cloud = noiseTile(TILE, seed + 1, [
    [4, 1],
    [8, 0.6],
    [16, 0.3],
  ]);
  const img = g.createImageData(TILE, TILE);
  for (let i = 0; i < cloud.length; i++) {
    const v = cloud[i] - 0.5;
    img.data[i * 4] = v > 0 ? 255 : 70;
    img.data[i * 4 + 1] = v > 0 ? 255 : 52;
    img.data[i * 4 + 2] = v > 0 ? 250 : 30;
    img.data[i * 4 + 3] = Math.round(Math.abs(v) * (v > 0 ? light : dark) * 230);
  }
  g.putImageData(img, 0, 0);
  g.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = R() * TILE, y = R() * TILE;
    const a = R() * Math.PI * 2;
    const len = 5 + R() * R() * 34;
    const bend = (R() - 0.5) * len * 0.6;
    const isLight = R() < 0.55;
    g.strokeStyle = isLight ? `rgba(255,255,250,${light * (0.5 + R() * 0.5)})` : `rgba(70,50,30,${dark * (0.4 + R() * 0.6)})`;
    g.lineWidth = 0.5 + R() * 0.9;
    const ex = Math.cos(a) * len, ey = Math.sin(a) * len;
    const mx = -Math.sin(a) * bend, my = Math.cos(a) * bend;
    for (const ox of [-TILE, 0, TILE])
      for (const oy of [-TILE, 0, TILE]) {
        const sx = x + ox, sy = y + oy;
        if (sx + 50 < 0 || sx - 50 > TILE || sy + 50 < 0 || sy - 50 > TILE) continue;
        g.beginPath();
        g.moveTo(sx, sy);
        g.quadraticCurveTo(sx + ex / 2 + mx, sy + ey / 2 + my, sx + ex, sy + ey);
        g.stroke();
      }
  }
  for (let i = 0; i < flecks; i++) {
    const x = 3 + R() * (TILE - 6), y = 3 + R() * (TILE - 6);
    const r = 0.4 + R() * R() * 1.6;
    g.fillStyle = R() < 0.7 ? `rgba(60,38,20,${0.25 + R() * 0.35})` : `rgba(255,250,235,${0.3 + R() * 0.4})`;
    g.beginPath();
    g.ellipse(x, y, r, r * (0.5 + R() * 0.5), R() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function makeTiles(): Record<Tex, HTMLCanvasElement> {
  const tooth = noiseTile(TILE, 1201, [
    [96, 1],
    [48, 0.7],
    [24, 0.45],
    [12, 0.3],
  ]);
  const fine = noiseTile(TILE, 3307, [
    [128, 1],
    [64, 0.45],
    [32, 0.18],
  ]);
  return {
    // Wax skips the hollows of the paper: little flecks show through.
    tooth: maskTile(fine, (v) => smoothstep(0.8, 0.93, v)),
    // The rough outside of a crayon line: about half.
    edge: maskTile(tooth, (v) => smoothstep(0.38, 0.6, v)),
    // Graphite catches the tops of the paper's tooth and skips the hollows.
    pencil: maskTile(fine, (v) => 1 - 0.9 * smoothstep(0.62, 0.95, v)),
    fibres: fibreTile(77, 260, 0.22, 0.4),
    flecks: fibreTile(91, 340, 0.4, 0.35, 260),
    page: maskTile(fine, (v) => 0.07 * (1 - smoothstep(0, 0.3, v)), [90, 70, 40]),
  };
}

const patternCache = new WeakMap<CanvasRenderingContext2D, Map<Tex, CanvasPattern>>();

/** A texture to fill with, fixed to the page, or to `frame` for a piece of paper's own grain. */
function texture(ctx: CanvasRenderingContext2D, tex: Tex, frame?: { x: number; y: number; a: number }): CanvasPattern | null {
  tiles ??= makeTiles();
  let map = patternCache.get(ctx);
  if (!map) patternCache.set(ctx, (map = new Map()));
  let pat = map.get(tex);
  if (!pat) {
    const made = ctx.createPattern(tiles[tex], 'repeat');
    if (!made) return null;
    map.set(tex, (pat = made));
  }
  const s = TILE_UNITS[tex] / TILE;
  const m = new DOMMatrix();
  if (frame) m.translateSelf(frame.x, frame.y).rotateSelf((frame.a * 180) / Math.PI);
  m.scaleSelf(s, s);
  pat.setTransform(m);
  return pat;
}

// ---------- Working canvases ----------

type Box = { x: number; y: number; w: number; h: number };
const scratches = new Map<string, CanvasRenderingContext2D>();

/** Pixels per page unit on a context (its transform is a plain scale). */
const scaleOf = (ctx: CanvasRenderingContext2D) => {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b) || 1;
};

/** The pixels a box in page units covers on the context, clipped to it. */
function pixelBox(ctx: CanvasRenderingContext2D, minx: number, miny: number, maxx: number, maxy: number): Box | null {
  const m = ctx.getTransform();
  const x0 = Math.max(0, Math.floor(m.a * minx + m.e));
  const y0 = Math.max(0, Math.floor(m.d * miny + m.f));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(m.a * maxx + m.e));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(m.d * maxy + m.f));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** A cleared working canvas for the box, drawing in page units like `ctx`. */
function scratch(name: string, ctx: CanvasRenderingContext2D, box: Box): CanvasRenderingContext2D {
  let g = scratches.get(name);
  if (!g || g.canvas.width < box.w || g.canvas.height < box.h) {
    const c = canvas(Math.max(box.w, g?.canvas.width ?? 0, 64), Math.max(box.h, g?.canvas.height ?? 0, 64));
    g = c.getContext('2d')!;
    scratches.set(name, g);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, box.w, box.h);
  const m = ctx.getTransform();
  g.setTransform(m.a, m.b, m.c, m.d, m.e - box.x, m.f - box.y);
  return g;
}

function stamp(ctx: CanvasRenderingContext2D, g: CanvasRenderingContext2D, box: Box, op: GlobalCompositeOperation, alpha: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = alpha;
  ctx.drawImage(g.canvas, 0, 0, box.w, box.h, box.x, box.y, box.w, box.h);
  ctx.restore();
}

/** Fills the part of a working canvas in use (with a texture, say). */
function fillBox(g: CanvasRenderingContext2D, box: Box) {
  const m = g.getTransform();
  g.fillRect(-m.e / m.a, -m.f / m.d, box.w / m.a, box.h / m.d);
}

function bounds(t: Trail): [number, number, number, number] {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let j = 0; j < t.x.length; j++) {
    if (t.x[j] < minx) minx = t.x[j];
    if (t.x[j] > maxx) maxx = t.x[j];
    if (t.y[j] < miny) miny = t.y[j];
    if (t.y[j] > maxy) maxy = t.y[j];
  }
  return [minx, miny, maxx, maxy];
}

/** A path along a trail, moved sideways by `off` along the normals. */
function polyline(t: Trail, off?: (j: number) => number, nrm?: [number[], number[]], from = 0, to = t.x.length - 1): Path2D {
  const path = new Path2D();
  for (let j = from; j <= to; j++) {
    const o = off && nrm ? off(j) : 0;
    const x = t.x[j] + (nrm ? nrm[0][j] * o : 0), y = t.y[j] + (nrm ? nrm[1][j] * o : 0);
    if (j === from) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  if (from === to) path.lineTo(t.x[from] + 0.01, t.y[from]);
  return path;
}

/**
 * The outline of a line whose half-width changes as it goes: up one side,
 * round the end, back down the other side and round the start. Filled with
 * the nonzero rule, so tight turns that fold the inside edge still fill.
 */
function ribbon(t: Trail, h: (j: number) => number, nrm: [number[], number[]]): Path2D {
  const path = new Path2D();
  const n = t.x.length;
  const [nx, ny] = nrm;
  if (n === 1) {
    const r = Math.max(0.01, h(0));
    path.moveTo(t.x[0] + r, t.y[0]);
    path.arc(t.x[0], t.y[0], r, 0, Math.PI * 2);
    return path;
  }
  const capSteps = 10;
  const around = (j: number, sign: number) => {
    const r = Math.max(0.01, h(j));
    const dx = -ny[j] * sign, dy = nx[j] * sign;
    for (let i = 1; i < capSteps; i++) {
      const a = (Math.PI * i) / capSteps;
      const c = Math.cos(a), s = Math.sin(a);
      path.lineTo(t.x[j] + r * (nx[j] * sign * c + dx * s), t.y[j] + r * (ny[j] * sign * c + dy * s));
    }
  };
  for (let j = 0; j < n; j++) {
    const r = Math.max(0.01, h(j));
    const x = t.x[j] + nx[j] * r, y = t.y[j] + ny[j] * r;
    if (j) path.lineTo(x, y);
    else path.moveTo(x, y);
  }
  around(n - 1, 1);
  for (let j = n - 1; j >= 0; j--) {
    const r = Math.max(0.01, h(j));
    path.lineTo(t.x[j] - nx[j] * r, t.y[j] - ny[j] * r);
  }
  around(0, -1);
  path.closePath();
  return path;
}

function polygons(polys: number[][]): Path2D {
  const path = new Path2D();
  for (const poly of polys) {
    path.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) path.lineTo(poly[i], poly[i + 1]);
    path.closePath();
  }
  return path;
}

function pool(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, a: number) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, css(c, a));
  grad.addColorStop(0.6, css(c, a * 0.45));
  grad.addColorStop(1, css(c, 0));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// ---------- The pens ----------

/** Felt-tip: bright, a little see-through, a darker rim, and ink pooled where the nib rested. */
function drawFelt(ctx: CanvasRenderingContext2D, it: LineItem, t: Trail, _seed: number) {
  const w = it.w;
  const base = parseColour(it.c);
  const [minx, miny, maxx, maxy] = bounds(t);
  const box = pixelBox(ctx, minx - w, miny - w, maxx + w, maxy + w);
  if (!box) return;
  const g = scratch('a', ctx, box);
  const path = polyline(t);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = css(base, 0.3);
  g.lineWidth = w + Math.min(1.4, w * 0.22);
  g.stroke(path);
  g.strokeStyle = css(mixC(base, BLACK, 0.05));
  g.lineWidth = w;
  g.stroke(path);
  g.strokeStyle = css(base);
  g.lineWidth = Math.max(w * 0.7, w - 1.6);
  g.stroke(path);
  const speed = trailSpeed(t, it.p);
  // Less ink lands where the pen moved fast.
  g.globalCompositeOperation = 'destination-out';
  g.lineCap = 'butt';
  g.lineWidth = w + 2;
  let from = 0;
  for (let j = 1; j < t.x.length; j++) {
    if (t.s[j] - t.s[from] < 8 && j < t.x.length - 1) continue;
    const a = 0.12 * smoothstep(9, 26, speed[Math.floor((from + j) / 2)]);
    if (a > 0.01) {
      g.strokeStyle = `rgba(0,0,0,${a})`;
      g.stroke(polyline(t, undefined, undefined, from, j));
    }
    from = j;
  }
  g.lineCap = 'round';
  // The very tops of the paper's tooth take a little less ink.
  const tooth = texture(g, 'tooth');
  if (tooth) {
    g.globalAlpha = 0.07;
    g.fillStyle = tooth;
    fillBox(g, box);
    g.globalAlpha = 1;
  }
  // Ink pools where the pen touched down and lifted off, and where it paused.
  g.globalCompositeOperation = 'source-atop';
  const dark = mixC(base, BLACK, 0.32);
  const last = t.x.length - 1;
  pool(g, t.x[0], t.y[0], w * 0.62 + 1, dark, 0.5);
  pool(g, t.x[last], t.y[last], w * 0.56 + 1, dark, 0.42);
  let lastPool = -Infinity;
  for (let j = 1; j < last; j++) {
    if (speed[j] < 1.7 && t.s[j] - lastPool > w * 2 && t.s[j] > w && t.len - t.s[j] > w) {
      pool(g, t.x[j], t.y[j], w * 0.55 + 1, dark, 0.28);
      lastPool = t.s[j];
    }
  }
  const tone = lightness(base);
  stamp(ctx, g, box, tone > 0.82 ? 'source-over' : 'multiply', tone < 0.25 ? 0.97 : 0.93);
}

/** Paintbrush: swells when slow, thins when fast, tapers, streaky bristles, a watery rim, and dry-brush ends. */
function drawBrush(ctx: CanvasRenderingContext2D, it: LineItem, t: Trail, seed: number) {
  const w = it.w;
  const base = parseColour(it.c);
  const h = brushWidths(t, it.p, w, seed);
  const [minx, miny, maxx, maxy] = bounds(t);
  const pad = w * 0.8 + 6;
  const box = pixelBox(ctx, minx - pad, miny - pad, maxx + pad, maxy + pad);
  if (!box) return;
  const g = scratch('a', ctx, box);
  const light = lightness(base) > 0.82;
  const rim = mixC(base, BLACK, light ? 0.1 : 0.24);
  const nrm = normals(t);
  // Water creeping out past the paint.
  g.fillStyle = css(base, 0.16);
  g.fill(ribbon(t, (j) => h[j] + 0.4 + 1.6 * Math.max(0, noise1(seed + 5, t.s[j] / 9)), nrm));
  g.fillStyle = css(rim);
  g.fill(ribbon(t, (j) => h[j], nrm));
  g.fillStyle = css(base);
  g.fill(ribbon(t, (j) => Math.max(0, h[j] - Math.max(0.6, h[j] * 0.14)), nrm));

  const R = rng(seed);
  const K = clamp(Math.round(w / 2), 5, 16);
  // Bristle streaks, darker and lighter.
  g.globalCompositeOperation = 'source-atop';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const darker = mixC(base, BLACK, 0.4), lighter = mixC(base, WHITE, 0.45);
  for (let k = 0; k < K; k++) {
    const o = (R() * 2 - 1) * 0.86;
    const dark = R() < 0.55;
    g.strokeStyle = dark ? css(darker, 0.12 + R() * 0.2) : css(lighter, 0.1 + R() * 0.18);
    g.lineWidth = Math.max(0.35, w * (0.025 + R() * 0.05));
    g.stroke(polyline(t, (j) => o * h[j], nrm));
  }
  // A blob of paint where the brush first went down.
  pool(g, t.x[0], t.y[0], Math.max(2, h[Math.min(h.length - 1, 3)] * 1.3), darker, 0.22);

  // Dry brush: towards the end, and where it moved fast, the paint breaks into streaks.
  if (t.len > w * 0.8) {
    const speed = trailSpeed(t, it.p);
    const tail = Math.min(t.len * 0.5, w * 3.2 + 14);
    const dry = (j: number) => clamp(smoothstep(t.len - tail, t.len, t.s[j]) * 0.95 + smoothstep(16, 34, speed[j]) * 0.55, 0, 1);
    g.globalCompositeOperation = 'destination-out';
    g.lineCap = 'butt';
    const gaps = Math.round(K * 0.8);
    const chunk = Math.max(3, w * 0.35);
    const levels = 6;
    for (let k = 0; k < gaps; k++) {
      const o = (R() * 2 - 1) * 0.92;
      const thr = R() * 0.75;
      g.lineWidth = Math.max(0.5, w * (0.035 + R() * 0.07));
      const byLevel: (Path2D | null)[] = new Array(levels).fill(null);
      let from = 0;
      for (let j = 1; j < t.x.length; j++) {
        if (t.s[j] - t.s[from] < chunk && j < t.x.length - 1) continue;
        const a = smoothstep(thr, thr + 0.2, dry(Math.floor((from + j) / 2)));
        const level = Math.round(a * (levels - 1));
        if (level > 0) {
          const p = (byLevel[level] ??= new Path2D());
          for (let q = from; q <= j; q++) {
            const x = t.x[q] + nrm[0][q] * o * h[q], y = t.y[q] + nrm[1][q] * o * h[q];
            if (q === from) p.moveTo(x, y);
            else p.lineTo(x, y);
          }
        }
        from = j;
      }
      byLevel.forEach((p, level) => {
        if (!p) return;
        g.strokeStyle = `rgba(0,0,0,${level / (levels - 1)})`;
        g.stroke(p);
      });
    }
  }
  stamp(ctx, g, box, 'source-over', 0.94);
}

/** Pencil: thin and grainy, the paper's tooth showing through, pressing harder and softer as it goes. */
function drawPencil(ctx: CanvasRenderingContext2D, it: LineItem, t: Trail, seed: number) {
  const w = it.w;
  let base = parseColour(it.c);
  const graphite = lightness(base) < 0.22;
  if (graphite) base = [72, 72, 80];
  const [minx, miny, maxx, maxy] = bounds(t);
  const box = pixelBox(ctx, minx - w - 2, miny - w - 2, maxx + w + 2, maxy + w + 2);
  if (!box) return;
  const g = scratch('a', ctx, box);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = css(base);
  g.lineWidth = w;
  g.stroke(polyline(t));
  const nrm = normals(t);
  // A few darker threads where the point drags.
  g.globalCompositeOperation = 'source-atop';
  const R = rng(seed);
  const deeper = mixC(base, BLACK, graphite ? 0.45 : 0.3);
  for (let i = 0; i < 3; i++) {
    const o = (R() - 0.5) * 0.7 * w;
    g.strokeStyle = css(deeper, 0.35 + R() * 0.3);
    g.lineWidth = Math.max(0.35, w * (0.12 + R() * 0.12));
    g.stroke(polyline(t, () => o, nrm));
  }
  // Lighter and darker as the pressure changes, and lighter at the very ends.
  g.globalCompositeOperation = 'destination-out';
  g.lineCap = 'butt';
  g.lineWidth = w + 2;
  let from = 0;
  for (let j = 1; j < t.x.length; j++) {
    if (t.s[j] - t.s[from] < 6 && j < t.x.length - 1) continue;
    const s = t.s[Math.floor((from + j) / 2)];
    const press = 0.5 + 0.5 * fbm1(seed, s / 55, 2);
    const ends = Math.max(1 - smoothstep(0, 9, s), 1 - smoothstep(0, 12, t.len - s)) * 0.55;
    const a = clamp(press * 0.38 + ends, 0, 0.8);
    if (a > 0.02) {
      g.strokeStyle = `rgba(0,0,0,${a})`;
      g.stroke(polyline(t, undefined, undefined, from, j));
    }
    from = j;
  }
  // The paper's tooth.
  const grain = texture(g, 'pencil');
  if (grain) {
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = grain;
    fillBox(g, box);
  }
  stamp(ctx, g, box, lightness(base) > 0.82 ? 'source-over' : 'multiply', graphite ? 0.95 : 0.92);
}

/** Wax crayon: waxy colour that skips the hollows of the paper, with a rough outside edge. */
function drawCrayon(ctx: CanvasRenderingContext2D, it: LineItem, t: Trail, seed: number) {
  const w = it.w;
  const base = parseColour(it.c);
  const [minx, miny, maxx, maxy] = bounds(t);
  const box = pixelBox(ctx, minx - w - 2, miny - w - 2, maxx + w + 2, maxy + w + 2);
  if (!box) return;
  const g = scratch('a', ctx, box);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = css(base);
  g.lineWidth = w;
  g.stroke(polyline(t));
  const nrm = normals(t);
  // Waxy streaks along the stroke.
  g.globalCompositeOperation = 'source-atop';
  const R = rng(seed);
  const shine = mixC(base, WHITE, 0.35), shade = mixC(base, BLACK, 0.22);
  // Broken, not continuous: the wax skips and catches as it is dragged.
  for (let i = 0; i < Math.max(3, Math.round(w / 3)); i++) {
    const o = (R() - 0.5) * 0.85 * w;
    g.strokeStyle = R() < 0.5 ? css(shine, 0.1 + R() * 0.12) : css(shade, 0.1 + R() * 0.12);
    g.lineWidth = Math.max(0.4, w * (0.04 + R() * 0.08));
    const dash: number[] = [];
    for (let d = 0; d < 6; d++) dash.push(w * (0.8 + R() * 3), w * (0.4 + R() * 2));
    g.setLineDash(dash);
    g.lineDashOffset = R() * w * 4;
    g.stroke(polyline(t, () => o, nrm));
  }
  g.setLineDash([]);
  // A rough edge, where the wax only catches the tops of the paper.
  g.globalCompositeOperation = 'destination-out';
  const edge = texture(g, 'edge');
  if (edge && w > 3) {
    g.strokeStyle = edge;
    g.lineWidth = Math.max(1, w * 0.17);
    g.stroke(polyline(t, () => w / 2, nrm));
    g.stroke(polyline(t, () => -w / 2, nrm));
  }
  const tooth = texture(g, 'tooth');
  if (tooth) {
    g.fillStyle = tooth;
    fillBox(g, box);
  }
  stamp(ctx, g, box, 'source-over', 0.97);
}

/** Highlighter: a flat chisel nib, see-through, a darker start, and faint streaks. */
function drawMarker(ctx: CanvasRenderingContext2D, it: LineItem, t: Trail, seed: number) {
  const w = it.w;
  const base = parseColour(it.c);
  const [minx, miny, maxx, maxy] = bounds(t);
  const box = pixelBox(ctx, minx - w, miny - w, maxx + w, maxy + w);
  if (!box) return;
  const g = scratch('a', ctx, box);
  // The nib's long edge leans like /, so lines across are wide and lines down narrower.
  const ang = (-62 * Math.PI) / 180;
  const ux = (Math.cos(ang) * w) / 2, uy = (Math.sin(ang) * w) / 2;
  const tx = -uy * 0.28, ty = ux * 0.28;
  const path = new Path2D();
  const quad = (q: number[]) => {
    const o = orient(q);
    path.moveTo(o[0], o[1]);
    for (let i = 2; i < o.length; i += 2) path.lineTo(o[i], o[i + 1]);
    path.closePath();
  };
  const n = t.x.length;
  const nib = (x: number, y: number) => [x + ux + tx, y + uy + ty, x - ux + tx, y - uy + ty, x - ux - tx, y - uy - ty, x + ux - tx, y + uy - ty];
  if (n === 1) quad(nib(t.x[0], t.y[0]));
  for (let j = 0; j < n - 1; j++) quad(hull([...nib(t.x[j], t.y[j]), ...nib(t.x[j + 1], t.y[j + 1])]));
  g.fillStyle = css(base);
  g.fill(path);
  // Ink soaks in where the nib first presses.
  g.globalCompositeOperation = 'source-atop';
  const dark = mixC(base, BLACK, 0.2);
  pool(g, t.x[0], t.y[0], w * 0.5, dark, 0.45);
  pool(g, t.x[n - 1], t.y[n - 1], w * 0.4, dark, 0.25);
  // Streaks across the width of the nib.
  g.globalCompositeOperation = 'destination-out';
  g.lineCap = 'round';
  const R = rng(seed);
  for (let i = 0; i < 4; i++) {
    const f = (R() * 2 - 1) * 0.8;
    g.strokeStyle = `rgba(0,0,0,${0.05 + R() * 0.07})`;
    g.lineWidth = Math.max(0.5, w * (0.02 + R() * 0.035));
    const p = new Path2D();
    for (let j = 0; j < n; j++) {
      const x = t.x[j] + ux * f, y = t.y[j] + uy * f;
      if (j) p.lineTo(x, y);
      else p.moveTo(x, y);
    }
    g.stroke(p);
  }
  const light = lightness(base) > 0.82;
  stamp(ctx, g, box, light ? 'source-over' : 'multiply', light ? 0.45 : 0.5);
}

/**
 * The rubber: rubs out pens, but paper stays stuck down, so whatever paper
 * was under the rubbed-out ink shows again.
 */
function drawErase(ctx: CanvasRenderingContext2D, it: LineItem, t: Trail, below: PaperItem[]) {
  const w = it.w;
  const [minx, miny, maxx, maxy] = bounds(t);
  const box = pixelBox(ctx, minx - w, miny - w, maxx + w, maxy + w);
  if (!box) return;
  const m = scratch('mask', ctx, box);
  m.lineCap = 'round';
  m.lineJoin = 'round';
  m.strokeStyle = '#000';
  m.lineWidth = w;
  m.stroke(polyline(t));
  stamp(ctx, m, box, 'destination-out', 1);
  const touching = below.filter((p) => {
    const b = paperBounds(p);
    return b[0] < maxx + w && b[2] > minx - w && b[1] < maxy + w && b[3] > miny - w;
  });
  if (!touching.length) return;
  const g = scratch('pieces', ctx, box);
  for (const p of touching) drawPaper(g, p);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(m.canvas, 0, 0, box.w, box.h, 0, 0, box.w, box.h);
  g.restore();
  stamp(ctx, g, box, 'source-over', 1);
}

// ---------- Paper ----------

interface PaperShape {
  outer: Path2D;
  face: Path2D;
  fibres: Path2D | null;
  torn: boolean;
  bounds: [number, number, number, number];
  /** Where the paper's own grain and print sit. */
  frame: { x: number; y: number; a: number };
}

const paperShapes = new WeakMap<PaperItem, PaperShape>();

function polyBounds(polys: number[][]): [number, number, number, number] {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const poly of polys)
    for (let i = 0; i < poly.length; i += 2) {
      minx = Math.min(minx, poly[i]);
      maxx = Math.max(maxx, poly[i]);
      miny = Math.min(miny, poly[i + 1]);
      maxy = Math.max(maxy, poly[i + 1]);
    }
  return [minx, miny, maxx, maxy];
}

function paperShape(it: PaperItem): PaperShape {
  const known = paperShapes.get(it);
  if (known) return known;
  const seed = seedOf(it);
  let made: PaperShape;
  if (it.k === 'h') {
    const poly = cutShape(it, seed);
    const path = polygons([poly]);
    made = { outer: path, face: path, fibres: null, torn: false, bounds: polyBounds([poly]), frame: { x: it.x, y: it.y, a: (it.r * Math.PI) / 180 } };
  } else {
    const geo = tearGeometry(it, seed);
    const fib = new Path2D();
    for (let i = 0; i < geo.fibres.length; i += 4) {
      fib.moveTo(geo.fibres[i], geo.fibres[i + 1]);
      fib.lineTo(geo.fibres[i + 2], geo.fibres[i + 3]);
    }
    made = {
      outer: polygons(geo.outer),
      face: polygons(geo.face),
      fibres: geo.fibres.length ? fib : null,
      torn: true,
      bounds: polyBounds(geo.outer),
      frame: { x: it.p[0], y: it.p[1], a: (((seed % 360) - 180) * Math.PI * 0.12) / 180 },
    };
  }
  paperShapes.set(it, made);
  return made;
}

/** The box in page units a piece of paper covers, shadow and all. */
export function paperBounds(it: PaperItem): [number, number, number, number] {
  const b = paperShape(it).bounds;
  return [b[0] - 8, b[1] - 8, b[2] + 14, b[3] + 18];
}

/** Just a shadow: the shape is drawn far off the canvas and only its shadow lands. */
function shadowOnly(ctx: CanvasRenderingContext2D, path: Path2D, dx: number, dy: number, blur: number, colour: string) {
  const k = scaleOf(ctx);
  const far = 40000;
  ctx.save();
  ctx.shadowColor = colour;
  ctx.shadowBlur = blur * k;
  ctx.shadowOffsetX = far + dx * k;
  ctx.shadowOffsetY = dy * k;
  ctx.translate(-far / k, 0);
  ctx.fillStyle = '#000';
  ctx.fill(path);
  ctx.restore();
}

const CORE: RGB = [252, 249, 241];

/** Paints a piece of paper: its shadow, its torn white core, its colour and print, its grain, and its loose fibres. */
function paintPaper(ctx: CanvasRenderingContext2D, ps: PaperShape, colour: string, finish: PaperFinish, lifted: boolean) {
  const tissue = finish === 'tissue';
  const base = parseColour(colour);
  const [minx, miny, maxx, maxy] = ps.bounds;
  ctx.save();
  // See-through tissue mustn't show its own shadow through itself.
  if (tissue) {
    const outside = new Path2D();
    outside.rect(minx - 80, miny - 80, maxx - minx + 160, maxy - miny + 160);
    outside.addPath(ps.outer);
    ctx.save();
    ctx.clip(outside, 'evenodd');
  }
  // Depth: a wide soft shadow, and a tight one where the paper meets what's under it.
  if (lifted) shadowOnly(ctx, ps.outer, 6, 11, 18, `rgba(55,35,15,${tissue ? 0.14 : 0.28})`);
  else {
    shadowOnly(ctx, ps.outer, 2.2, 3.8, 8, `rgba(60,40,18,${tissue ? 0.12 : 0.34})`);
    shadowOnly(ctx, ps.outer, 0.3, 0.8, 1.5, `rgba(45,28,12,${tissue ? 0.1 : 0.36})`);
  }
  if (tissue) ctx.restore();
  if (ps.torn && !tissue) {
    ctx.fillStyle = css(CORE);
    ctx.fill(ps.outer);
  }
  ctx.save();
  ctx.clip(ps.face);
  const area = (fill: string | CanvasPattern | CanvasGradient, alpha = 1, op: GlobalCompositeOperation = 'source-over') => {
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.fillStyle = fill;
    ctx.fillRect(minx - 2, miny - 2, maxx - minx + 4, maxy - miny + 4);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
  const light = lightness(base) > 0.8;
  const reach = Math.hypot(maxx - minx, maxy - miny) / 2 + Math.hypot((minx + maxx) / 2 - ps.frame.x, (miny + maxy) / 2 - ps.frame.y) + 20;
  if (tissue) {
    area(css(base), 0.58, light ? 'source-over' : 'multiply');
  } else if (finish === 'gingham') {
    area('#fbfaf5');
    ctx.save();
    ctx.translate(ps.frame.x, ps.frame.y);
    ctx.rotate(ps.frame.a);
    const step = 16, half = 8;
    const start = -Math.ceil(reach / step) * step;
    ctx.fillStyle = css(light ? mixC(base, BLACK, 0.3) : base, 0.42);
    ctx.globalCompositeOperation = 'multiply';
    for (let v = start; v < reach; v += step) ctx.fillRect(v, -reach, half, reach * 2);
    for (let v = start; v < reach; v += step) ctx.fillRect(-reach, v, reach * 2, half);
    ctx.restore();
  } else {
    area(css(base));
    if (finish === 'dots') {
      ctx.save();
      ctx.translate(ps.frame.x, ps.frame.y);
      ctx.rotate(ps.frame.a);
      const step = 17;
      const start = -Math.ceil(reach / step) * step;
      ctx.fillStyle = light ? css(mixC(base, BLACK, 0.28)) : 'rgba(255,253,246,0.94)';
      const dots = new Path2D();
      let row = 0;
      for (let y = start; y < reach; y += step, row++) {
        for (let x = start + (row % 2 ? step / 2 : 0); x < reach; x += step) {
          dots.moveTo(x + 3.4, y);
          dots.arc(x, y, 3.4, 0, Math.PI * 2);
        }
      }
      ctx.fill(dots);
      ctx.restore();
    }
  }
  // The paper's own grain: fibres and a little cloudiness.
  const grain = texture(ctx, finish === 'kraft' ? 'flecks' : 'fibres', ps.frame);
  if (grain) area(grain, finish === 'kraft' ? 1 : tissue ? 0.45 : 0.55);
  // Light from the top left, as if the paper lifts very slightly.
  const lit = ctx.createLinearGradient(minx, miny, maxx, maxy);
  lit.addColorStop(0, 'rgba(255,255,255,0.13)');
  lit.addColorStop(0.5, 'rgba(255,255,255,0)');
  lit.addColorStop(1, 'rgba(40,25,10,0.08)');
  area(lit);
  ctx.restore();

  if (ps.fibres) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = tissue ? css(base, 0.45) : css(CORE, 0.85);
    ctx.lineWidth = 0.4;
    ctx.stroke(ps.fibres);
  } else {
    // A cut edge catches the light along its top.
    ctx.save();
    ctx.clip(ps.outer);
    ctx.strokeStyle = tissue ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 1.4;
    ctx.translate(0.5, 0.7);
    ctx.stroke(ps.outer);
    ctx.restore();
  }
  ctx.restore();
}

function drawPaper(ctx: CanvasRenderingContext2D, it: PaperItem, lifted = false) {
  const finish = FINISHES.includes(it.f as string) ? (it.f as PaperFinish) : 'plain';
  paintPaper(ctx, paperShape(it), finish === 'kraft' ? KRAFT : it.c, finish, lifted);
}

// ---------- Stickers ----------

/** A sticker: the emoji with a white die-cut border and a shadow, stuck on the page. */
function drawSticker(ctx: CanvasRenderingContext2D, it: StickerItem) {
  const s = it.s;
  const box = pixelBox(ctx, it.x - s, it.y - s, it.x + s, it.y + s);
  if (!box) return;
  const a = scratch('a', ctx, box);
  a.font = `${s}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  a.textAlign = 'center';
  a.textBaseline = 'middle';
  a.fillText(it.e, it.x, it.y);
  const b = scratch('mask', ctx, box);
  b.setTransform(1, 0, 0, 1, 0, 0);
  const r = Math.max(1.5, s * 0.07 * scaleOf(ctx));
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    b.drawImage(a.canvas, 0, 0, box.w, box.h, Math.cos(ang) * r, Math.sin(ang) * r, box.w, box.h);
  }
  b.globalCompositeOperation = 'source-in';
  b.fillStyle = '#fffefb';
  b.fillRect(0, 0, box.w, box.h);
  b.globalCompositeOperation = 'source-over';
  b.drawImage(a.canvas, 0, 0, box.w, box.h, 0, 0, box.w, box.h);
  const k = scaleOf(ctx);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = 'rgba(50,32,14,0.3)';
  ctx.shadowBlur = 4 * k;
  ctx.shadowOffsetX = 1 * k;
  ctx.shadowOffsetY = 2 * k;
  ctx.drawImage(b.canvas, 0, 0, box.w, box.h, box.x, box.y, box.w, box.h);
  ctx.restore();
}

// ---------- Drawing items ----------

/**
 * Draws one item onto a 2D context already scaled so one unit is one page
 * unit. `below` is the paper stuck down before it, which the rubber leaves.
 * `lifted` draws paper as if it's still held just above the page.
 */
export function drawItem(ctx: CanvasRenderingContext2D, item: Item, below: PaperItem[] = [], lifted = false) {
  if (!isDrawable(item)) return;
  ctx.save();
  try {
    if (item.k === 's') drawSticker(ctx, item);
    else if (item.k === 'h' || item.k === 't') drawPaper(ctx, item, lifted);
    else {
      const t = trail(item.p, item.t === 'erase' || item.t === 'marker' ? 2.2 : 1.2);
      const seed = seedOf(item);
      switch (item.t) {
        case 'felt':
          drawFelt(ctx, item, t, seed);
          break;
        case 'brush':
          drawBrush(ctx, item, t, seed);
          break;
        case 'pencil':
          drawPencil(ctx, item, t, seed);
          break;
        case 'marker':
          drawMarker(ctx, item, t, seed);
          break;
        case 'erase':
          drawErase(ctx, item, t, below);
          break;
        default:
          drawCrayon(ctx, item, t, seed);
      }
    }
  } catch (e) {
    // One odd item shouldn't stop the rest of the picture drawing.
    console.warn('Could not draw an item', e);
  } finally {
    ctx.restore();
  }
}

/** Draws the visible items onto a 2D context already scaled so one unit is one page unit. */
export function drawItems(ctx: CanvasRenderingContext2D, items: Item[]) {
  drawVisible(ctx, visibleItems(items), 0);
}

/**
 * Draws already-visible items from index `from` on, over a context that
 * already has the ones before it: lets a page add new items without redrawing.
 */
export function drawVisible(ctx: CanvasRenderingContext2D, visible: Item[], from: number) {
  const below: PaperItem[] = [];
  for (let i = 0; i < from; i++) if (isPaper(visible[i]) && isDrawable(visible[i])) below.push(visible[i] as PaperItem);
  for (let i = from; i < visible.length; i++) {
    const it = visible[i];
    drawItem(ctx, it, below);
    if (isPaper(it) && isDrawable(it)) below.push(it);
  }
}

/** Paper stuck down among visible items, for the rubber to leave alone. */
export function paperIn(visible: Item[]): PaperItem[] {
  return visible.filter((it): it is PaperItem => isPaper(it) && isDrawable(it));
}

/**
 * How the layer showing an item while it's drawn should blend with the page
 * under it, so it looks then as it will once it's down.
 */
export function liveBlend(it: Item): 'multiply' | 'normal' {
  if (!isDrawable(it)) return 'normal';
  if (it.k === 'l') return (it.t === 'felt' || it.t === 'pencil' || it.t === 'marker') && lightness(parseColour(it.c)) <= 0.82 ? 'multiply' : 'normal';
  if (it.k === 'h' || it.k === 't') return it.f === 'tissue' && lightness(parseColour(it.c)) <= 0.8 ? 'multiply' : 'normal';
  return 'normal';
}

/** A blank page: warm paper with a fine tooth and the odd fibre. */
export function drawPage(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.fillStyle = PAGE_PAPER;
  ctx.fillRect(0, 0, width, height);
  const tooth = texture(ctx, 'page');
  if (tooth) {
    ctx.fillStyle = tooth;
    ctx.fillRect(0, 0, width, height);
  }
  const fibres = texture(ctx, 'fibres');
  if (fibres) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = fibres;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

/**
 * Renders a finished picture: the background (a photo or plain paper) with
 * the drawing on its own layer, so the eraser only rubs out the drawing.
 */
export function renderPicture(items: Item[], pageHeight: number, background: HTMLImageElement | null, maxSide = 1600): HTMLCanvasElement {
  const scaleUp = background
    ? Math.min(maxSide / Math.max(background.naturalWidth, background.naturalHeight), 1) * (background.naturalWidth / PAGE_WIDTH)
    : maxSide / Math.max(PAGE_WIDTH, pageHeight);
  const width = Math.round(PAGE_WIDTH * scaleUp);
  const height = Math.round(pageHeight * scaleUp);

  const out = canvas(width, height);
  const ctx = out.getContext('2d')!;
  if (background) {
    ctx.fillStyle = PAGE_PAPER;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(background, 0, 0, width, height);
  } else {
    ctx.setTransform(scaleUp, 0, 0, scaleUp, 0, 0);
    drawPage(ctx, PAGE_WIDTH, pageHeight);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  const layer = canvas(width, height);
  const lctx = layer.getContext('2d')!;
  lctx.scale(scaleUp, scaleUp);
  drawItems(lctx, items);
  ctx.drawImage(layer, 0, 0);
  return out;
}

/** An SVG path for a shape, cut as it would be, for buttons. Fits a box from -1 to 1. */
export function shapeIconPath(kind: ShapeKind): string {
  const poly = cutShape({ h: kind, x: 0, y: 0, s: 60, r: 0 }, hash32('icon', kind));
  let d = '';
  for (let i = 0; i < poly.length; i += 2) d += `${i ? 'L' : 'M'}${(poly[i] / 60).toFixed(3)} ${(poly[i + 1] / 60).toFixed(3)}`;
  return d + 'Z';
}
