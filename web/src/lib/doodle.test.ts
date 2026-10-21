import { describe, expect, it } from 'vitest';
import {
  KRAFT,
  LineCollector,
  brushWidths,
  cutShape,
  equalize,
  fbm1,
  finishLine,
  hash32,
  hull,
  isDrawable,
  isLoop,
  isPaper,
  lastUndoable,
  lineWidth,
  liveBlend,
  makeShape,
  noise1,
  noiseTile,
  paperIn,
  rng,
  seedOf,
  shapeIconPath,
  shapeOutline,
  shapeSize,
  shapes,
  simplify,
  sizes,
  straighten,
  tapTilt,
  tearGeometry,
  tearWidth,
  trail,
  visibleItems,
  type Item,
  type LineItem,
  type LineTool,
  type ShapeItem,
  type TornItem,
} from './doodle';

// ---------- Helpers ----------

function polyArea(p: number[]): number {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return a / 2;
}

function inside(p: number[], x: number, y: number): boolean {
  let hit = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], yi = p[i * 2 + 1], xj = p[j * 2], yj = p[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The distance from a point to the nearest edge of a closed polygon. */
function toEdge(p: number[], x: number, y: number): number {
  let best = Infinity;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[j * 2], by = p[j * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(ax + dx * u - x, ay + dy * u - y));
  }
  return best;
}

function bbox(p: number[]): [number, number, number, number] {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    minx = Math.min(minx, p[i]);
    maxx = Math.max(maxx, p[i]);
    miny = Math.min(miny, p[i + 1]);
    maxy = Math.max(maxy, p[i + 1]);
  }
  return [minx, miny, maxx, maxy];
}

const wave = (n: number, gap: number) => {
  const p: number[] = [];
  for (let i = 0; i < n; i++) p.push(100 + i * gap, 200 + Math.round(20 * Math.sin(i / 6) * 10) / 10);
  return p;
};

const ring = (cx: number, cy: number, r: number, n = 40) => {
  const p: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push(Math.round((cx + Math.cos(a) * r) * 10) / 10, Math.round((cy + Math.sin(a) * r) * 10) / 10);
  }
  return p;
};

// ---------- Seeded randomness ----------

describe('seeded randomness', () => {
  it('hashes the same parts to the same number, and numbers to a tenth', () => {
    expect(hash32('felt', '#e5484d', 12, 100.5)).toBe(hash32('felt', '#e5484d', 12, 100.5));
    expect(hash32('felt', 1.02)).toBe(hash32('felt', 1.0));
    expect(hash32('felt', 1.1)).not.toBe(hash32('felt', 1.0));
    expect(hash32('ab', 'c')).not.toBe(hash32('a', 'bc'));
    const h = hash32('anything');
    expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
  });

  it('gives the same sequence for the same seed, and a different one otherwise', () => {
    const a = rng(42), b = rng(42), c = rng(43);
    const sa = Array.from({ length: 50 }, a), sb = Array.from({ length: 50 }, b), sc = Array.from({ length: 50 }, c);
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    const r = rng(7);
    let sum = 0;
    for (let i = 0; i < 5000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 5000).toBeGreaterThan(0.45);
    expect(sum / 5000).toBeLessThan(0.55);
  });

  it('seeds a line from where it starts, so it looks the same live and once sent', () => {
    const live: LineItem = { k: 'l', t: 'felt', c: '#3e8ee8', w: 12, p: [10, 20, 30, 40] };
    const sent: LineItem = { ...live, p: [10, 20, 30, 40, 50, 60, 70, 80] };
    expect(seedOf(live)).toBe(seedOf(sent));
    expect(seedOf({ ...live, t: 'brush' })).not.toBe(seedOf(live));
    const shape: ShapeItem = { k: 'h', h: 'star', c: '#f6c945', x: 100, y: 100, s: 40, r: 5 };
    expect(seedOf(shape)).toBe(seedOf({ ...shape }));
    expect(seedOf({ ...shape, f: 'dots' })).not.toBe(seedOf(shape));
  });

  it('makes smooth noise in [-1, 1]', () => {
    let prev = noise1(5, 0);
    for (let x = 0; x < 50; x += 0.01) {
      const v = noise1(5, x);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
    }
    expect(noise1(5, 12.34)).toBe(noise1(5, 12.34));
    expect(noise1(5, 12.34)).not.toBe(noise1(6, 12.34));
    for (let x = 0; x < 30; x += 0.37) expect(Math.abs(fbm1(9, x))).toBeLessThanOrEqual(1);
  });

  it('makes paper grain that repeats, tiles without a seam and spreads evenly', () => {
    const size = 64;
    const a = noiseTile(size, 11, [
      [8, 1],
      [16, 0.5],
    ]);
    const b = noiseTile(size, 11, [
      [8, 1],
      [16, 0.5],
    ]);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(noiseTile(size, 12, [[8, 1]]))).not.toEqual(Array.from(noiseTile(size, 11, [[8, 1]])));
    // Spread evenly over [0, 1].
    const sorted = Array.from(a).sort((x, y) => x - y);
    expect(sorted[0]).toBe(0);
    expect(sorted[sorted.length - 1]).toBe(1);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeCloseTo(0.5, 1);
    // Neighbours across the wrap differ no more than neighbours inside.
    let seam = 0, within = 0;
    for (let y = 0; y < size; y++) {
      seam += Math.abs(a[y * size + size - 1] - a[y * size]);
      within += Math.abs(a[y * size + size / 2] - a[y * size + size / 2 - 1]);
    }
    expect(seam).toBeLessThan(within * 2 + 1);
  });

  it('equalizes without changing the order of values', () => {
    const v = new Float32Array([5, -2, 9, 0.5, 3]);
    const e = equalize(v);
    expect(Array.from(e)).toEqual([0.75, 0, 1, 0.25, 0.5]);
  });
});

// ---------- Items ----------

describe('items', () => {
  const line = (t?: LineTool, u = 1): LineItem => ({ k: 'l', c: '#1f2023', w: 12, p: [0, 0, 10, 10], ...(t ? { t } : {}), u });
  const shape: ShapeItem = { k: 'h', h: 'heart', c: '#e5484d', x: 50, y: 60, s: 40, r: -10, f: 'dots', u: 2 };
  const torn: TornItem = { k: 't', c: '#46a758', w: 50, p: [0, 0, 100, 10, 200, 0], f: 'tissue', u: 1 };

  it('accepts old lines, new tools, paper and stickers', () => {
    for (const t of [undefined, 'pen', 'marker', 'erase', 'felt', 'brush', 'pencil'] as const) expect(isDrawable(line(t))).toBe(true);
    expect(isDrawable(shape)).toBe(true);
    expect(isDrawable(torn)).toBe(true);
    expect(isDrawable({ k: 's', e: '⭐', x: 1, y: 2, s: 30 })).toBe(true);
  });

  it('turns away anything it cannot draw', () => {
    expect(isDrawable({ ...line(), t: 'laser' })).toBe(false);
    expect(isDrawable({ ...line(), p: [1, 2, 3] })).toBe(false);
    expect(isDrawable({ ...line(), w: Number.NaN })).toBe(false);
    expect(isDrawable({ ...shape, h: 'dragon' })).toBe(false);
    expect(isDrawable({ ...shape, s: 0 })).toBe(false);
    expect(isDrawable({ ...torn, p: [] })).toBe(false);
    expect(isDrawable({ k: 'x', i: 0 })).toBe(false);
    expect(isDrawable(null)).toBe(false);
    expect(isDrawable('l')).toBe(false);
  });

  it('hides undone items of every kind, and leaves an untouched list alone', () => {
    const items: Item[] = [line('felt'), shape, torn, { k: 'x', i: 1, u: 2 }, { k: 'x', i: 2, u: 1 }];
    expect(visibleItems(items)).toEqual([items[0]]);
    const plain: Item[] = [line(), shape];
    expect(visibleItems(plain)).toBe(plain);
    expect(visibleItems([line(), null as unknown as Item, shape])).toEqual([line(), shape]);
  });

  it("finds someone's latest item still showing, paper included", () => {
    const items: Item[] = [line('felt', 1), shape, torn, line('brush', 2)];
    expect(lastUndoable(items, 1)).toBe(2);
    expect(lastUndoable(items, 2)).toBe(3);
    expect(lastUndoable([...items, { k: 'x', i: 2, u: 1 }], 1)).toBe(0);
    expect(lastUndoable([...items, { k: 'x', i: 3, u: 2 }], 2)).toBe(1);
    expect(lastUndoable(items, 99)).toBe(-1);
  });

  it('knows which items are paper', () => {
    const items: Item[] = [line(), shape, torn, { k: 's', e: '⭐', x: 0, y: 0, s: 20 }];
    expect(items.map(isPaper)).toEqual([false, true, true, false]);
    expect(paperIn(items)).toEqual([shape, torn]);
  });

  it('blends a live item the way it will land', () => {
    expect(liveBlend(line('felt'))).toBe('multiply');
    expect(liveBlend({ ...line('felt'), c: '#ffffff' })).toBe('normal');
    expect(liveBlend(line('brush'))).toBe('normal');
    expect(liveBlend(torn)).toBe('multiply');
    expect(liveBlend(shape)).toBe('normal');
  });
});

// ---------- Points ----------

describe('collecting points', () => {
  it('drops points too close together, keeps both ends and rounds to a tenth', () => {
    const p = [0, 0, 0.5, 0, 1, 0, 2, 0, 2.2, 0, 4.04, 0.01];
    expect(simplify(p)).toEqual([0, 0, 2, 0, 4, 0]);
    expect(simplify([1.04, 2.06])).toEqual([1, 2.1]);
  });

  it('collects live the same line simplify() would send', () => {
    const r = rng(3);
    const all: number[] = [];
    const c = new LineCollector();
    let x = 100, y = 100;
    for (let i = 0; i < 300; i++) {
      x = Math.round((x + (r() - 0.3) * 4) * 10) / 10;
      y = Math.round((y + (r() - 0.5) * 4) * 10) / 10;
      all.push(x, y);
      c.add(x, y);
    }
    expect(c.points()).toEqual(simplify(all));
  });

  it('straightens away points on a straight run, but keeps corners and ends', () => {
    const p = [0, 0, 10, 0, 20, 0, 30, 0, 30, 10, 30, 20, 30, 30.2];
    expect(straighten(p)).toEqual([0, 0, 30, 0, 30, 30.2]);
    const curve = wave(80, 3);
    const s = straighten(curve);
    expect(s.length).toBeLessThan(curve.length);
    expect(s.slice(0, 2)).toEqual(curve.slice(0, 2));
    expect(s.slice(-2)).toEqual(curve.slice(-2));
  });

  it('keeps every brush point, since their spacing is the speed', () => {
    const p = [0, 0, 1, 0, 2, 0, 3, 0];
    expect(finishLine('brush', p)).toEqual(p);
    expect(finishLine('felt', p)).toEqual([0, 0, 3, 0]);
    expect(finishLine('tear', p)).toEqual([0, 0, 3, 0]);
  });

  it('follows a line in short even steps from end to end', () => {
    const p = wave(30, 6);
    const t = trail(p, 1.5);
    expect([t.x[0], t.y[0]]).toEqual([p[0], p[1]]);
    expect(t.x[t.x.length - 1]).toBeCloseTo(p[p.length - 2], 6);
    expect(t.y[t.y.length - 1]).toBeCloseTo(p[p.length - 1], 6);
    for (let j = 1; j < t.x.length; j++) {
      expect(t.s[j]).toBeGreaterThan(t.s[j - 1]);
      expect(t.s[j] - t.s[j - 1]).toBeLessThan(2.5);
      expect(t.at[j]).toBeGreaterThanOrEqual(t.at[j - 1]);
    }
    expect(t.len / (t.x.length - 1)).toBeLessThanOrEqual(1.5);
    expect(t.len).toBe(t.s[t.s.length - 1]);
  });
});

// ---------- Tools ----------

describe('tool sizes', () => {
  it('gives every tool a sensible width at every size', () => {
    for (const t of ['felt', 'brush', 'pencil', 'pen', 'marker', 'erase'] as const) {
      const ws = sizes.map((s) => lineWidth(t, s.value));
      for (const w of ws) expect(w).toBeGreaterThanOrEqual(2.5);
      expect(ws[2]).toBeGreaterThan(ws[0]);
    }
    expect(lineWidth('pencil', 1)).toBe(2.5);
    expect(tearWidth(26)).toBeGreaterThan(tearWidth(5));
    expect(shapeSize(26)).toBeGreaterThan(shapeSize(5));
  });

  it('swells a brush where it moved slowly and tapers its ends', () => {
    const slow = wave(120, 1.6);
    const fast = wave(16, 12);
    const ws = brushWidths(trail(slow), slow, 20, 1);
    const wf = brushWidths(trail(fast), fast, 20, 1);
    const mid = (a: number[]) => a[Math.floor(a.length / 2)];
    expect(mid(ws)).toBeGreaterThan(mid(wf));
    expect(ws[0]).toBeLessThan(mid(ws));
    expect(ws[ws.length - 1]).toBeLessThan(mid(ws) * 0.5);
    for (const w of [...ws, ...wf]) expect(w).toBeGreaterThan(0);
    expect(brushWidths(trail(slow), slow, 20, 1)).toEqual(ws);
  });

  it('wraps points in their convex hull', () => {
    const h = hull([0, 0, 10, 0, 5, 5, 10, 10, 0, 10, 3, 7]);
    expect(h.length).toBe(8);
    expect(Math.abs(polyArea(h))).toBeCloseTo(100, 6);
  });
});

// ---------- Paper ----------

describe('cut-out shapes', () => {
  it('has a closed, sensible outline for every shape', () => {
    for (const { value } of shapes) {
      const o = shapeOutline(value);
      expect(o.length).toBeGreaterThanOrEqual(8);
      for (const v of o) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThanOrEqual(1.3);
      }
      expect(Math.abs(polyArea(o))).toBeGreaterThan(0.5);
      expect(inside(o, 0, value === 'heart' ? 0.1 : 0)).toBe(true);
    }
  });

  it('cuts the same edge every time, close to the true outline', () => {
    for (const { value } of shapes) {
      const it = { h: value, x: 400, y: 300, s: 80, r: 0 };
      const a = cutShape(it);
      expect(cutShape(it)).toEqual(a);
      expect(cutShape(it, 99)).not.toEqual(a);
      const ideal = shapeOutline(value).map((v, i) => (i % 2 ? 300 : 400) + v * 80);
      for (let i = 0; i < a.length; i += 2) expect(toEdge(ideal, a[i], a[i + 1])).toBeLessThan(2.5);
      // Scissors cut in snips: far fewer points than the smooth outline.
      expect(a.length).toBeLessThan(ideal.length);
    }
  });

  it('turns and scales with the item', () => {
    const flat = cutShape({ h: 'star', x: 0, y: 0, s: 50, r: 0 }, 7);
    const turned = cutShape({ h: 'star', x: 0, y: 0, s: 50, r: 90 }, 7);
    expect(turned.length).toBe(flat.length);
    for (let i = 0; i < flat.length; i += 2) {
      expect(turned[i]).toBeCloseTo(-flat[i + 1], 6);
      expect(turned[i + 1]).toBeCloseTo(flat[i], 6);
    }
    const small = bbox(cutShape({ h: 'circle', x: 0, y: 0, s: 30, r: 0 }));
    const big = bbox(cutShape({ h: 'circle', x: 0, y: 0, s: 120, r: 0 }));
    expect((big[2] - big[0]) / (small[2] - small[0])).toBeCloseTo(4, 0);
  });

  it('makes a shape item from a press and drag', () => {
    const s = makeShape('heart', '#e5484d', 'plain', 100.04, 200.06, 55.4, 200);
    expect(s).toEqual({ k: 'h', h: 'heart', c: '#e5484d', x: 100, y: 200.1, s: 55, r: -160 });
    expect('f' in s).toBe(false);
    const kraft = makeShape('star', '#3e8ee8', 'kraft', 0, 0, 2, -725);
    expect(kraft.c).toBe(KRAFT);
    expect(kraft.f).toBe('kraft');
    expect(kraft.s).toBe(10);
    expect(kraft.r).toBe(-5);
    expect(makeShape('circle', '#000', 'dots', 0, 0, 9999, 0).s).toBe(480);
    expect(isDrawable(kraft)).toBe(true);
  });

  it('tilts a tapped shape a little, the same way each time', () => {
    for (let i = 0; i < 50; i++) {
      const t = tapTilt(i * 13.7, i * 7.1);
      expect(t).toBeGreaterThanOrEqual(-7);
      expect(t).toBeLessThanOrEqual(7);
      expect(tapTilt(i * 13.7, i * 7.1)).toBe(t);
    }
  });

  it('draws button icons from the same cut outlines', () => {
    for (const { value } of shapes) {
      const d = shapeIconPath(value);
      expect(d.startsWith('M')).toBe(true);
      expect(d.endsWith('Z')).toBe(true);
      const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      for (const n of nums) expect(Math.abs(n)).toBeLessThan(1.35);
    }
  });
});

describe('torn paper', () => {
  const strip: TornItem = { k: 't', c: '#3e8ee8', w: 50, p: wave(40, 8) };

  it('tells a patch torn round in a loop from a strip', () => {
    expect(isLoop(ring(300, 300, 80))).toBe(true);
    expect(isLoop(strip.p)).toBe(false);
    expect(isLoop(ring(300, 300, 10))).toBe(false);
    expect(isLoop([0, 0, 50, 0])).toBe(false);
  });

  it('tears the same edge for the same seed', () => {
    const a = tearGeometry(strip, 5);
    expect(tearGeometry(strip, 5)).toEqual(a);
    expect(tearGeometry(strip, 6).outer).not.toEqual(a.outer);
  });

  it('tears a strip about as wide as asked, with its coloured face inside the white core', () => {
    const g = tearGeometry(strip, 5);
    expect(g.closed).toBe(false);
    expect(g.outer.length).toBe(1);
    expect(g.face.length).toBe(1);
    const [outer] = g.outer, [face] = g.face;
    expect(Math.abs(polyArea(face))).toBeLessThan(Math.abs(polyArea(outer)));
    let inner = 0;
    for (let i = 0; i < face.length; i += 2) if (inside(outer, face[i], face[i + 1]) || toEdge(outer, face[i], face[i + 1]) < 0.5) inner++;
    expect(inner / (face.length / 2)).toBeGreaterThan(0.97);
    const t = trail(strip.p);
    const centre: number[] = [];
    for (let j = 0; j < t.x.length; j++) centre.push(t.x[j], t.y[j]);
    // Each edge point sits about half the width from the path it was torn along.
    for (let i = 0; i < outer.length; i += 2) {
      let d = Infinity;
      for (let j = 0; j < centre.length; j += 2) d = Math.min(d, Math.hypot(centre[j] - outer[i], centre[j + 1] - outer[i + 1]));
      expect(d).toBeLessThan(strip.w / 2 + 12);
    }
    expect(g.fibres.length % 4).toBe(0);
    expect(g.fibres.length).toBeGreaterThan(0);
  });

  it('tears out a closed patch from a loop, and a scrap from a tap', () => {
    const patch = tearGeometry({ w: 30, p: ring(300, 300, 80) }, 1);
    expect(patch.closed).toBe(true);
    expect(inside(patch.face[0], 300, 300)).toBe(true);
    const scrap = tearGeometry({ w: 30, p: [500, 500] }, 1);
    expect(scrap.closed).toBe(true);
    expect(inside(scrap.outer[0], 500, 500)).toBe(true);
  });

  it('has no white core on tissue paper', () => {
    const g = tearGeometry({ ...strip, f: 'tissue' }, 5);
    expect(g.face).toEqual(g.outer);
  });
});
