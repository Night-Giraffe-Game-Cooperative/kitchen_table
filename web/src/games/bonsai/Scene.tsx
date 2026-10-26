// The bonsai, painted in watercolour: soft washes with wobbly, darker edges
// and a little grain, on cream paper. The tree's shape comes from its twigs;
// colours come from the kind of tree, the month and the time of day.

import type { ReactNode } from 'react';
import { NightGiraffe } from '../giraffe/NightGiraffe';
import { THIRSTY, bare, dayOf, monthOf, rand, seasonOf, shootEnds, type Extra, type Pot, type State, type Twig, type Visitor } from './rules';

export const WIDTH = 400;
export const HEIGHT = 440;
/** The bottom of the trunk, on top of the soil. */
export const BASE = { x: 200, y: 322 };

export const at = (t: { x: number; y: number }) => ({ x: BASE.x + t.x, y: BASE.y + t.y });

type Time = 'dawn' | 'day' | 'evening' | 'night';

export function timeOf(now: number): Time {
  const h = new Date(now).getHours();
  return h >= 19 || h < 6 ? 'night' : h < 9 ? 'dawn' : h < 17 ? 'day' : 'evening';
}

interface Leaves {
  mid: string[];
  dark: string;
  light: string;
  /** Little flowers dotted over the pads. */
  flowers?: string[];
  /** How full the pads look, as leaves fall. */
  full: number;
}

/** The leaves' colours for the kind of tree and the month. */
function leavesFor(kind: State['kind'], month: number): Leaves {
  if (kind === 'pine') return { mid: ['#5f8a6b', '#668f70'], dark: '#2f5446', light: month >= 2 && month <= 5 ? '#cfe09a' : '#9dbf9a', full: 1 };
  if (kind === 'cherry') {
    if (month === 2 || month === 3) return { mid: ['#f2c2d0', '#efb3c6'], dark: '#d9849f', light: '#fff1f5', flowers: ['#fffafb', '#f7a9c0'], full: 1 };
    if (month === 8 || month === 9) return { mid: ['#d9a54b', '#c98a3e', '#a9a44e'], dark: '#93562e', light: '#f1cf7a', full: 1 };
    if (month === 10) return { mid: ['#d07a3e', '#b9633a'], dark: '#7e3f25', light: '#e9a860', full: 0.7 };
    return { mid: ['#79a65a', '#86ae5f'], dark: '#3f6d38', light: '#b6d58a', full: 1 };
  }
  // Japanese maple.
  if (month >= 2 && month <= 4) return { mid: ['#9cc56b', '#a8c86a'], dark: '#5f8f45', light: '#e3a07e', full: 1 };
  if (month === 8) return { mid: ['#a4ad4f', '#c9a548', '#8fae5a'], dark: '#6a6a33', light: '#e6c56c', full: 1 };
  if (month === 9) return { mid: ['#e07a3a', '#d4553a', '#e9a23b'], dark: '#9c3527', light: '#f6c46a', full: 1 };
  if (month === 10) return { mid: ['#c8432f', '#b8352b', '#d96a3a'], dark: '#7d2320', light: '#ec8f5a', full: 0.7 };
  return { mid: ['#6f9f4f', '#79a557'], dark: '#3f6d38', light: '#acd07e', full: 1 };
}

/** Mixes two colours, for a thirsty tree's paler leaves and wet or dry soil. */
export function mix(a: string, b: string, t: number): string {
  const n = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

const potColours: Record<Pot, { body: string; rim: string; shade: string }> = {
  blue: { body: '#5b7fa6', rim: '#7396bb', shade: '#36577b' },
  clay: { body: '#c0714f', rim: '#d48a68', shade: '#8f4a2f' },
  cream: { body: '#e6d9bf', rim: '#f2e8d4', shade: '#b19d7a' },
  night: { body: '#323a5c', rim: '#46507a', shade: '#1c2139' },
};

const skies: Record<Time, string> = { dawn: '#f4d3bd', day: '#cfe2e8', evening: '#f1c3a0', night: '#5d6fa3' };

/** How thick a branch is: the more it carries, the thicker, and a little thicker with age. */
function thickness(twigs: Twig[], ageDays: number): Map<number, number> {
  const kids = new Map<number, number[]>();
  for (const t of twigs) kids.set(t.p, [...(kids.get(t.p) ?? []), t.id]);
  const weight = new Map<number, number>();
  const count = (id: number): number => {
    const n = 1 + (kids.get(id) ?? []).reduce((sum, k) => sum + count(k), 0);
    weight.set(id, n);
    return n;
  };
  for (const t of twigs) if (t.p === -1) count(t.id);
  const grown = 1 + Math.min(1, ageDays / 365) * 0.4;
  return new Map([...weight].map(([id, n]) => [id, (3 + Math.sqrt(n) * 5.6) * grown]));
}

/** One branch from its parent to a twig, tapering, with a gentle curve. */
function limb(a: { x: number; y: number }, b: { x: number; y: number }, wa: number, wb: number, bend: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = (a.x + b.x) / 2 + nx * bend;
  const cy = (a.y + b.y) / 2 + ny * bend;
  const p = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  return [
    `M${p(a.x + (nx * wa) / 2, a.y + (ny * wa) / 2)}`,
    `Q${p(cx + (nx * (wa + wb)) / 4, cy + (ny * (wa + wb)) / 4)} ${p(b.x + (nx * wb) / 2, b.y + (ny * wb) / 2)}`,
    `L${p(b.x - (nx * wb) / 2, b.y - (ny * wb) / 2)}`,
    `Q${p(cx - (nx * (wa + wb)) / 4, cy - (ny * (wa + wb)) / 4)} ${p(a.x - (nx * wa) / 2, a.y - (ny * wa) / 2)}Z`,
  ].join(' ');
}

interface Blob {
  x: number;
  y: number;
  r: number;
  up: number;
  fill: string;
}

/** A pad of leaves as a cloud of overlapping dabs, flatter for a pine. */
function padBlobs(s: State, t: Twig, leaves: Leaves, droop: number): Blob[] {
  const p = at(t);
  const n = Math.round((7 + t.d * 2 + t.r / 5) * leaves.full);
  const flat = s.kind === 'pine' ? 0.42 : 0.56;
  const spread = s.kind === 'pine' ? 1.3 : 1.12;
  const fill = leaves.mid[Math.floor(rand(s.seed, t.id, 30) * leaves.mid.length)];
  return Array.from({ length: n }, (_, i) => {
    const a = rand(s.seed, t.id, i, 20) * Math.PI * 2;
    const d = Math.sqrt(rand(s.seed, t.id, i, 21)) * 0.72;
    const up = Math.sin(a) * d;
    return {
      x: p.x + Math.cos(a) * d * t.r * spread,
      y: p.y + up * t.r * flat * 1.6 - t.r * 0.08 + droop,
      r: t.r * (0.36 + rand(s.seed, t.id, i, 22) * 0.22),
      up,
      fill,
    };
  });
}

function Pads({ s, leaves, thirsty }: { s: State; leaves: Leaves; thirsty: boolean }) {
  const pale = (c: string) => (thirsty ? mix(c, '#c4b47c', 0.4) : c);
  const blobs = s.twigs.filter((t) => t.r > 0).flatMap((t) => padBlobs(s, t, leaves, thirsty ? 2.5 : 0));
  return (
    <>
      <g filter="url(#bonsai-wash)" opacity="0.92">
        {blobs.map((b, i) => (
          <circle key={i} cx={b.x} cy={b.y} r={b.r} fill={pale(b.fill)} fillOpacity="0.78" />
        ))}
      </g>
      <g filter="url(#bonsai-wash)" style={{ mixBlendMode: 'multiply' }}>
        {blobs
          .filter((b) => b.up > -0.1)
          .map((b, i) => (
            <circle key={i} cx={b.x + 1.5} cy={b.y + b.r * 0.35} r={b.r * 0.75} fill={pale(leaves.dark)} fillOpacity="0.36" />
          ))}
      </g>
      <g filter="url(#bonsai-wash)">
        {blobs
          .filter((b) => b.up < -0.2)
          .map((b, i) => (
            <circle key={i} cx={b.x - 1.5} cy={b.y - b.r * 0.25} r={b.r * 0.5} fill={pale(leaves.light)} fillOpacity="0.65" />
          ))}
      </g>
      {/* Little leaves round the edges, so the pads look leafy rather than round. */}
      <g filter="url(#bonsai-ink)">
        {blobs.flatMap((b, i) =>
          [0, 1, 2].map((k) => {
            const a = -Math.PI * (0.1 + rand(s.seed, i, k, 43) * 0.8) + (b.up > 0.2 ? Math.PI : 0);
            const x = b.x + Math.cos(a) * b.r * 0.92;
            const y = b.y + Math.sin(a) * b.r * 0.92;
            const deg = (a * 180) / Math.PI + 90 + (rand(s.seed, i, k, 44) - 0.5) * 50;
            const fill = pale(k === 2 ? leaves.light : b.fill);
            return <ellipse key={`${i}-${k}`} cx={x} cy={y} rx="3.6" ry="1.9" transform={`rotate(${deg} ${x} ${y})`} fill={fill} fillOpacity="0.85" />;
          }),
        )}
      </g>
      {leaves.flowers && !thirsty && (
        <g filter="url(#bonsai-ink)">
          {blobs.map((b, i) => (
            <circle key={i} cx={b.x + (rand(s.seed, i, 40) - 0.5) * b.r} cy={b.y + (rand(s.seed, i, 41) - 0.6) * b.r} r={1.6 + rand(s.seed, i, 42)} fill={leaves.flowers![i % 2]} />
          ))}
        </g>
      )}
    </>
  );
}

/** In winter, the fine twigs that hold next year's leaves, with buds on. */
function BareTwigs({ s }: { s: State }) {
  const byId = new Map(s.twigs.map((t) => [t.id, t]));
  const lines: ReactNode[] = [];
  for (const t of s.twigs) {
    if (t.r <= 0) continue;
    const p = at(t);
    const parent = byId.get(t.p);
    const out = parent ? Math.atan2(t.y - parent.y, t.x - parent.x) : -Math.PI / 2;
    const k = 4 + t.d;
    for (let i = 0; i < k; i++) {
      const a = out * 0.5 - Math.PI / 4 + (i / (k - 1) - 0.5) * 2.2 + (rand(s.seed, t.id, i, 50) - 0.5) * 0.4;
      const len = t.r * (0.7 + rand(s.seed, t.id, i, 51) * 0.5);
      const x1 = p.x + Math.cos(a) * len;
      const y1 = p.y + Math.sin(a) * len * 0.75;
      const fx = p.x + Math.cos(a) * len * 0.55;
      const fy = p.y + Math.sin(a) * len * 0.42;
      const b = a + (rand(s.seed, t.id, i, 52) < 0.5 ? -0.6 : 0.6);
      const x2 = fx + Math.cos(b) * len * 0.4;
      const y2 = fy + Math.sin(b) * len * 0.3;
      lines.push(
        <g key={`${t.id}-${i}`}>
          <path d={`M${p.x} ${p.y} Q${fx} ${fy - 2} ${x1} ${y1}`} />
          <path d={`M${fx} ${fy} L${x2} ${y2}`} strokeWidth="0.7" />
          <circle cx={x1} cy={y1} r="1.3" fill="#9b5a4a" stroke="none" />
          <circle cx={x2} cy={y2} r="1" fill="#9b5a4a" stroke="none" />
        </g>,
      );
    }
  }
  return (
    <g filter="url(#bonsai-ink)" stroke="#5d4636" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.85">
      {lines}
    </g>
  );
}

function shootColour(s: State, month: number): string {
  if (s.kind === 'pine') return '#a3c27a';
  if (s.kind === 'maple' && month >= 2 && month <= 4) return '#b0614f';
  return '#7aa053';
}

function Shoots({ s, leafy, month, thirsty }: { s: State; leafy: boolean; month: number; thirsty: boolean }) {
  const byId = new Map(s.twigs.map((t) => [t.id, t]));
  const colour = shootColour(s, month);
  return (
    <g filter="url(#bonsai-ink)" strokeLinecap="round">
      {s.shoots.map((sh) => {
        const t = byId.get(sh.on);
        if (!t) return null;
        const e = shootEnds(t, sh);
        const a = at({ x: e.x0, y: e.y0 });
        const b = at({ x: e.x1, y: e.y1 + (thirsty ? sh.len * 0.12 : 0) });
        const bend = Math.sin(sh.a) > 0 ? -3 : 3;
        const n = Math.max(1, Math.floor(sh.len / 9));
        return (
          <g key={sh.id}>
            <path d={`M${a.x} ${a.y} Q${(a.x + b.x) / 2} ${(a.y + b.y) / 2 + bend} ${b.x} ${b.y}`} stroke={colour} strokeWidth={s.kind === 'pine' ? 2.4 : 1.6} fill="none" />
            {leafy &&
              Array.from({ length: n }, (_, i) => {
                const f = (i + 1) / (n + 0.4);
                const x = a.x + (b.x - a.x) * f;
                const y = a.y + (b.y - a.y) * f;
                const deg = (sh.a * 180) / Math.PI + (i % 2 ? 45 : -45);
                return <ellipse key={i} cx={x} cy={y} rx="3.4" ry="1.7" transform={`rotate(${deg} ${x} ${y})`} fill={thirsty ? '#b9b37a' : '#9cc56b'} fillOpacity="0.9" />;
              })}
          </g>
        );
      })}
    </g>
  );
}

function Trunk({ s, ageDays }: { s: State; ageDays: number }) {
  const byId = new Map(s.twigs.map((t) => [t.id, t]));
  const w = thickness(s.twigs, ageDays);
  const root = s.twigs.find((t) => t.p === -1);
  const base = (root && w.get(root.id)) ?? 12;
  const parts: { d: string; lit: string; wb: number; b: { x: number; y: number } }[] = [];
  for (const t of s.twigs) {
    const parent = byId.get(t.p);
    if (!parent) continue;
    const a = at(parent);
    const b = at(t);
    const wa = Math.max(w.get(t.id)! * 1.08, 1.5);
    const wb = t.r > 0 ? Math.max(w.get(t.id)! * 0.55, 1.4) : w.get(t.id)!;
    const wide = parent.p === -1 ? Math.max(wa, base * 0.9) : wa;
    const bend = (rand(s.seed, t.id, 60) - 0.5) * 14;
    const left = (p: { x: number; y: number }, w: number) => ({ x: p.x - w * 0.2, y: p.y });
    parts.push({ d: limb(a, b, wide, wb, bend), lit: limb(left(a, wide), left(b, wb), wide * 0.4, wb * 0.4, bend), wb, b });
  }
  const flare = `M${BASE.x - base * 1.35} ${BASE.y + 3} Q${BASE.x - base * 0.55} ${BASE.y - 2} ${BASE.x - base * 0.48} ${BASE.y - 16} L${BASE.x + base * 0.48} ${BASE.y - 16} Q${BASE.x + base * 0.6} ${BASE.y - 2} ${BASE.x + base * 1.4} ${BASE.y + 3}Z`;
  return (
    <>
      <g filter="url(#bonsai-wash)" fill="#86654e" opacity="0.9">
        <path d={flare} />
        {parts.map((p, i) => (
          <g key={i}>
            <path d={p.d} />
            <circle cx={p.b.x} cy={p.b.y} r={p.wb / 2} />
          </g>
        ))}
      </g>
      {/* Light on the left, shade on the right, so the trunk looks round. */}
      <g filter="url(#bonsai-ink)" fill="#b8977a" opacity="0.45">
        {parts.map((p, i) => (
          <path key={i} d={p.lit} />
        ))}
      </g>
      <g filter="url(#bonsai-wash)" fill="#4f372a" opacity="0.42" style={{ mixBlendMode: 'multiply' }} transform="translate(2.2 0.5)">
        {parts.map((p, i) => (
          <path key={i} d={p.d} transform={`translate(${p.wb * 0.18} 0)`} />
        ))}
        <path d={flare} transform="translate(3 0)" />
      </g>
    </>
  );
}

function PotAndSoil({ pot, water, moss }: { pot: Pot; water: number; moss: boolean }) {
  const c = potColours[pot];
  const soil = mix('#c2a984', '#5a4030', Math.min(1, water * 1.15));
  return (
    <>
      <ellipse cx="205" cy="376" rx="126" ry="7" fill="#6d5844" opacity="0.22" filter="url(#bonsai-soft)" />
      <g filter="url(#bonsai-wash)">
        <path d="M112 366h24v9h-24zM264 366h24v9h-24z" fill={c.shade} fillOpacity="0.9" />
        <path d="M92 331 L308 331 L294 368 Q200 375 106 368 Z" fill={c.body} fillOpacity="0.86" />
        <path d="M225 331 L308 331 L294 368 Q262 372 226 373 Z" fill={c.shade} fillOpacity="0.42" />
        <path d="M86 322 Q200 315 314 322 L312 333 Q200 338 88 333 Z" fill={c.rim} fillOpacity="0.9" />
      </g>
      <path d="M110 337 L136 337 L131 362 L114 362 Z" fill="#fff" opacity="0.18" filter="url(#bonsai-wash)" />
      <path className="bonsai-soil" d="M96 324 Q200 311 304 324 Q200 331 96 324 Z" fill={soil} fillOpacity="0.95" filter="url(#bonsai-wash)" />
      {moss && (
        <g filter="url(#bonsai-wash)">
          {[118, 140, 166, 232, 258, 280].map((x, i) => (
            <ellipse key={x} cx={x} cy={322.5 - (i % 2) * 1.5} rx={12 + (i % 3) * 3} ry="3.6" fill={i % 2 ? '#7fa45c' : '#93b46a'} fillOpacity="0.85" />
          ))}
        </g>
      )}
    </>
  );
}

function Extras({ extras, night }: { extras: Extra[]; night: boolean }) {
  const has = (e: Extra) => extras.includes(e);
  return (
    <>
      {has('stone') && (
        <g filter="url(#bonsai-wash)">
          <ellipse cx="262" cy="319" rx="13" ry="7" fill="#9aa0a3" fillOpacity="0.9" />
          <ellipse cx="259" cy="317" rx="6" ry="3" fill="#c9cdcf" fillOpacity="0.8" />
        </g>
      )}
      {has('lantern') && (
        <g filter="url(#bonsai-wash)" fillOpacity="0.92">
          <rect x="40" y="366" width="34" height="8" rx="2" fill="#8f9392" />
          <rect x="51" y="336" width="12" height="31" fill="#a3a7a5" />
          <rect x="44" y="320" width="26" height="17" rx="2" fill="#b0b3b1" />
          <rect x="50" y="324" width="14" height="9" fill={night ? '#ffd66e' : '#6e6a62'} />
          <path d="M36 321 Q57 304 78 321 Z" fill="#8a8e8c" />
          <circle cx="57" cy="307" r="3.5" fill="#8a8e8c" />
        </g>
      )}
      {has('frog') && (
        <g filter="url(#bonsai-wash)">
          <ellipse cx="345" cy="368" rx="14" ry="9" fill="#78a85b" fillOpacity="0.92" />
          <circle cx="338" cy="359" r="4.5" fill="#86b467" />
          <circle cx="352" cy="359" r="4.5" fill="#86b467" />
          <circle cx="338" cy="358.5" r="1.8" fill="#2b2a24" />
          <circle cx="352" cy="358.5" r="1.8" fill="#2b2a24" />
          <path d="M339 368 q6 4 12 0" stroke="#3c5c2c" strokeWidth="1.2" fill="none" />
        </g>
      )}
      {has('giraffe') && <NightGiraffe x={300} y={322} width={30} height={36} />}
    </>
  );
}

/** Today's visitor, drawn where it's sitting. Its spot is also where the tap target goes. */
export function visitorSpot(s: State, v: Visitor): { x: number; y: number } {
  if (v === 'night_giraffe') return { x: 352, y: 196 };
  const pads = s.twigs.filter((t) => t.r > 0);
  const t = pads[Math.floor(rand(s.seed, dayOf(s.at), 9) * pads.length)] ?? s.twigs[0];
  const p = at(t);
  if (v === 'butterfly') return { x: Math.min(370, p.x + t.r + 16), y: p.y - t.r - 6 };
  return { x: p.x - t.r * 0.2, y: p.y - t.r * 0.55 };
}

function VisitorArt({ v, x, y }: { v: Visitor; x: number; y: number }) {
  switch (v) {
    case 'night_giraffe':
      return <NightGiraffe className="bonsai-peek" x={x - 46} y={y - 50} width={92} height={110} />;
    case 'ladybird':
      return (
        <g transform={`translate(${x} ${y})`}>
          <circle r="5" fill="#d8392b" />
          <circle cx="0" cy="-4.6" r="2.4" fill="#2a2522" />
          <path d="M0 -3 V5" stroke="#2a2522" strokeWidth="0.8" />
          <circle cx="-2.4" cy="0" r="1.1" fill="#2a2522" />
          <circle cx="2.3" cy="1.6" r="1.1" fill="#2a2522" />
        </g>
      );
    case 'butterfly':
      return (
        <g transform={`translate(${x} ${y})`}>
          <g className="bonsai-flap">
            <ellipse cx="-6" cy="-3" rx="6.5" ry="5" fill="#8fb8e0" fillOpacity="0.9" />
            <ellipse cx="6" cy="-3" rx="6.5" ry="5" fill="#8fb8e0" fillOpacity="0.9" />
            <ellipse cx="-4.5" cy="4" rx="4" ry="3.2" fill="#f2c96b" />
            <ellipse cx="4.5" cy="4" rx="4" ry="3.2" fill="#f2c96b" />
          </g>
          <rect x="-0.8" y="-6" width="1.6" height="12" rx="0.8" fill="#3a3330" />
        </g>
      );
    case 'bird':
    case 'robin':
      return (
        <g transform={`translate(${x} ${y - 6})`}>
          <path d="M-9 2 Q-15 -1 -15 4 Q-12 5 -8 4Z" fill={v === 'robin' ? '#7a5a3c' : '#6e8f4e'} />
          <ellipse cx="0" cy="0" rx="9" ry="7" fill={v === 'robin' ? '#8a6545' : '#8eb35f'} />
          <ellipse cx="3.5" cy="2" rx="5.5" ry="4.5" fill={v === 'robin' ? '#e2793d' : '#e9edd0'} />
          <circle cx="5" cy="-4" r="4.6" fill={v === 'robin' ? '#8a6545' : '#8eb35f'} />
          {v === 'bird' && <circle cx="6.2" cy="-4.3" r="2.1" fill="#fff" />}
          <circle cx="6.3" cy="-4.4" r="1.1" fill="#221d19" />
          <path d="M9.4 -4 L13 -3.2 L9.4 -2.4Z" fill="#d9a441" />
          <path d="M-1 7 v3 M2 7 v3" stroke="#6b4a33" strokeWidth="1" />
        </g>
      );
  }
}

/** Leaves, petals or snow drifting down, while it's that time of year. */
function Drifting({ s, month, leaves }: { s: State; month: number; leaves: Leaves }) {
  const snow = month === 11 || month <= 1;
  const falling = !snow && ((s.kind !== 'pine' && (month === 9 || month === 10)) || (s.kind === 'cherry' && month === 3));
  if (!snow && !falling) return null;
  const pads = s.twigs.filter((t) => t.r > 0);
  return (
    <g className="bonsai-drift" aria-hidden="true">
      {Array.from({ length: snow ? 9 : 4 }, (_, i) => {
        const from = snow ? { x: 30 + rand(s.seed, i, 70) * 340, y: -10 } : at(pads[i % Math.max(1, pads.length)] ?? s.twigs[0]);
        return (
          <g key={i} transform={`translate(${from.x} ${from.y})`}>
            <g className={snow ? 'bonsai-snow' : 'bonsai-leaf-fall'} style={{ animationDelay: `${i * (snow ? 1.3 : 2.7)}s` }}>
              {snow ? <circle r={1.6 + (i % 3) * 0.6} fill="#fff" opacity="0.9" /> : <ellipse rx="3.6" ry="2" fill={leaves.mid[i % leaves.mid.length]} />}
            </g>
          </g>
        );
      })}
    </g>
  );
}

/** Leaves (or petals) lying on the table, waiting to be swept. */
function Fallen({ s, leaves }: { s: State; leaves: Leaves }) {
  return (
    <g filter="url(#bonsai-ink)">
      {Array.from({ length: s.fallen }, (_, i) => {
        const left = i % 2 === 0;
        const x = left ? 30 + rand(s.seed, i, 80) * 70 : 300 + rand(s.seed, i, 80) * 75;
        const y = 380 + rand(s.seed, i, 81) * 40;
        const deg = rand(s.seed, i, 82) * 180;
        return <ellipse key={i} cx={x} cy={y} rx="4.4" ry="2.4" transform={`rotate(${deg} ${x} ${y})`} fill={leaves.mid[i % leaves.mid.length]} fillOpacity="0.9" />;
      })}
    </g>
  );
}

/** The watering can, pouring, while it's being watered. */
function Pouring() {
  return (
    <g aria-hidden="true">
      <g transform="translate(300 230) rotate(-28)" filter="url(#bonsai-wash)">
        <rect x="-26" y="-16" width="40" height="30" rx="6" fill="#7fa7b8" />
        <path d="M14 -6 L40 -20 L42 -16 L16 2Z" fill="#6c95a6" />
        <path d="M-26 -10 Q-40 -2 -26 8" stroke="#6c95a6" strokeWidth="4" fill="none" />
      </g>
      {Array.from({ length: 7 }, (_, i) => (
        <ellipse key={i} className="bonsai-drop" cx={318 - i * 9} cy={232 + (i % 3) * 6} rx="1.6" ry="3" fill="#7fb2d9" style={{ animationDelay: `${i * 0.14}s` }} />
      ))}
    </g>
  );
}

export interface SceneProps {
  s: State;
  now: number;
  visitor: Visitor | null;
  pouring: boolean;
  /** A shoot just trimmed, falling away. */
  snipped: { x: number; y: number } | null;
}

export function Scene({ s, now, visitor, pouring, snipped }: SceneProps) {
  const day = dayOf(now);
  const month = monthOf(day);
  const time = timeOf(now);
  const leaves = leavesFor(s.kind, month);
  const thirsty = s.water < THIRSTY;
  const sleeping = bare(s, day);
  const season = seasonOf(day);
  const accent = time === 'day' ? { spring: '#f6d3dc', summer: '#e3edbd', autumn: '#f3cf96', winter: '#e2e8f0' }[season] : time === 'night' ? '#d9d3ea' : '#f7e3a8';
  const spot = visitor ? visitorSpot(s, visitor) : null;
  return (
    <svg className="bonsai-art" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" focusable="false">
      <defs>
        <filter id="bonsai-wash" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="2" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="7" xChannelSelector="R" yChannelSelector="G" result="wobbly" />
          <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="5" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.55 1.12" result="grainy" />
          <feComposite in="wobbly" in2="grainy" operator="in" result="washed" />
          <feMorphology in="wobbly" operator="erode" radius="1.3" result="inner" />
          <feComposite in="wobbly" in2="inner" operator="out" result="rim" />
          <feGaussianBlur in="rim" stdDeviation="0.6" result="edge" />
          <feMerge>
            <feMergeNode in="washed" />
            <feMergeNode in="edge" />
          </feMerge>
        </filter>
        <filter id="bonsai-ink" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="4" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="bonsai-big" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="3" seed="9" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="46" xChannelSelector="R" yChannelSelector="G" result="wobbly" />
          <feGaussianBlur in="wobbly" stdDeviation="1.6" />
        </filter>
        <filter id="bonsai-soft">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id="bonsai-paper" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="8" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.35  0 0 0 0 0.27  0 0 0 0.3 -0.07" />
        </filter>
      </defs>

      <rect width={WIDTH} height={HEIGHT} fill="#f8f2e6" />
      <g filter="url(#bonsai-big)">
        <circle cx="200" cy="196" r="168" fill={skies[time]} opacity="0.6" />
      </g>
      <ellipse cx={time === 'night' ? 92 : 296} cy={time === 'night' ? 84 : 112} rx="84" ry="66" fill={accent} opacity={time === 'night' ? 0.35 : 0.5} filter="url(#bonsai-wash)" />
      <path d="M0 373 Q200 362 400 373 L400 440 L0 440 Z" fill="#cdb79a" opacity="0.5" filter="url(#bonsai-big)" />

      {visitor === 'night_giraffe' && spot && <VisitorArt v={visitor} {...spot} />}
      <Trunk s={s} ageDays={day - s.born} />
      {sleeping ? <BareTwigs s={s} /> : <Pads s={s} leaves={leaves} thirsty={thirsty} />}
      <Shoots s={s} leafy={!sleeping} month={month} thirsty={thirsty} />
      <PotAndSoil pot={s.pot} water={s.water} moss={s.extras.includes('moss')} />
      <Extras extras={s.extras} night={time === 'night'} />
      <Fallen s={s} leaves={leaves} />
      {visitor && visitor !== 'night_giraffe' && spot && <VisitorArt v={visitor} {...spot} />}
      {pouring && <Pouring />}
      {snipped && (
        <g transform={`translate(${snipped.x} ${snipped.y})`}>
          <g className="bonsai-snip">
            <path d="M0 0 l9 -7" stroke="#7aa053" strokeWidth="1.6" strokeLinecap="round" />
            <ellipse cx="6" cy="-6" rx="3.2" ry="1.6" fill="#9cc56b" />
          </g>
        </g>
      )}

      {time === 'night' && (
        <>
          <rect width={WIDTH} height={HEIGHT} fill="#2b3a6e" opacity="0.18" style={{ mixBlendMode: 'multiply' }} />
          <circle cx="78" cy="70" r="20" fill="#fdf3cf" opacity="0.95" filter="url(#bonsai-wash)" />
          {[
            [140, 40],
            [228, 58],
            [312, 34],
            [52, 140],
            [360, 120],
          ].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="1.4" fill="#fff8de" />
          ))}
        </>
      )}
      <Drifting s={s} month={month} leaves={leaves} />
      <rect width={WIDTH} height={HEIGHT} fill="#fff" filter="url(#bonsai-paper)" style={{ pointerEvents: 'none' }} />
    </svg>
  );
}
