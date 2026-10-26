// A bonsai that grows a little each day. Its soil dries out, it puts out new
// shoots, it changes with the seasons and drops its leaves in autumn. Nothing
// here dies: a thirsty tree stops growing and droops until it has a drink.
// What happens while nobody is looking is worked out from the date and the
// tree's seed, so it comes out the same every time it's opened.

import { bandOf, type Band } from '../bands';

export type Kind = 'maple' | 'pine' | 'cherry';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Pot = 'blue' | 'clay' | 'cream' | 'night';
export type Extra = 'moss' | 'stone' | 'giraffe' | 'lantern' | 'frog';

/**
 * A point on the tree: the trunk, a bend in a branch, or a leafy pad. Places
 * are measured from the bottom of the trunk, with up as minus.
 */
export interface Twig {
  id: number;
  /** The twig it grows from, or -1 for the bottom of the trunk. */
  p: number;
  x: number;
  y: number;
  /** How big its pad of leaves is; 0 for none. */
  r: number;
  /** How bushy trimming has made it, 0 to 4. */
  d: number;
}

/** A new shoot sticking out of a pad, waiting to be trimmed. */
export interface Shoot {
  id: number;
  /** The twig it grows from. */
  on: number;
  /** Which way it points, in radians: 0 is right, minus a half pi is up. */
  a: number;
  len: number;
  /** The day it appeared. */
  day: number;
}

export interface State {
  turn: 'gardener';
  kind: Kind;
  name: string;
  seed: number;
  band?: Band;
  /** The day it was planted, as a day number (see dayOf). */
  born: number;
  /** The last day it has grown up to. */
  day: number;
  /** How wet the soil is, from 0 (dust dry) to 1 (soaked), at `at`. */
  water: number;
  at: number;
  /** The day it was last fed. */
  fed?: number;
  twigs: Twig[];
  shoots: Shoot[];
  next: number;
  /** Leaves (or petals) on the table, to sweep up. */
  fallen: number;
  /** Days in a row it has been too dry to grow. */
  thirsty: number;
  /** How many days it's been looked after, which unlocks pots and things to put by it. */
  cared: number;
  caredOn: number;
  pot: Pot;
  extras: Extra[];
  /** Someone else is looking after it while the family is away. */
  away?: boolean;
}

export const DAY = 86_400_000;

/** Below this the tree is thirsty; above WET the soil doesn't need more. */
export const THIRSTY = 0.15;
export const DRY = 0.3;
export const WET = 0.8;
/** A shoot this long is worth trimming. */
export const TRIM_AT = 14;
const SHOOT_MAX = 42;
const MAX_SHOOTS = 8;
const MAX_TWIGS = 24;
/** Days between feeds. */
export const FEED_EVERY = 14;
/** Room for the tree in the picture, from the bottom of the trunk. */
export const BOUNDS = { left: -172, right: 172, top: -296, bottom: -12 };

export const kindNames: Record<Kind, string> = { maple: 'Maple', pine: 'Pine', cherry: 'Cherry blossom' };
/** "Momiji the maple". */
export const kindWords: Record<Kind, string> = { maple: 'maple', pine: 'pine', cherry: 'cherry tree' };
/** A Japanese name for each, which the family can change. */
export const suggestedNames: Record<Kind, string> = { maple: 'Momiji', pine: 'Matsu', cherry: 'Sakura' };
export const nameMeanings: Record<Kind, string> = {
  maple: 'Momiji means red autumn leaves in Japanese.',
  pine: 'Matsu means pine tree in Japanese.',
  cherry: 'Sakura means cherry blossom in Japanese.',
};

/** Today's day number on this device's calendar, counting from 1970. */
export function dayOf(t: number): number {
  return Math.floor((t - new Date(t).getTimezoneOffset() * 60_000) / DAY);
}

/** When a day starts here, roughly: midnight on this device's clock. */
export function startOf(day: number): number {
  return day * DAY + new Date(day * DAY).getTimezoneOffset() * 60_000;
}

/** The month a day falls in, 0 for January. */
export const monthOf = (day: number) => new Date(day * DAY).getUTCMonth();

/** Seasons at home in the UK. */
export function seasonOf(day: number): Season {
  const m = monthOf(day);
  return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
}

/** Whether it has lost its leaves for the winter. Pines keep theirs. */
export const bare = (s: Pick<State, 'kind'>, day: number) => s.kind !== 'pine' && seasonOf(day) === 'winter';

/** The same number between 0 and 1 for the same inputs, every time. */
export function rand(...n: number[]): number {
  let h = 2166136261;
  for (const x of n) {
    h = Math.imul(h ^ Math.round(x * 1000), 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

/** How much the soil dries in a day: faster in summer, slower for younger players. */
export function dryRate(s: Pick<State, 'band'>, day: number): number {
  const season = { spring: 0.33, summer: 0.45, autumn: 0.28, winter: 0.18 }[seasonOf(day)];
  const band = { '5-7': 0.6, '8-10': 0.8, '11-13': 1, '14+': 1 }[bandOf(s)];
  return season * band;
}

/** How fast it grows on a day: lots in spring, a little in autumn, not at all in winter. */
export function pace(s: State, day: number): number {
  const m = monthOf(day);
  const season = seasonOf(day);
  let p = season === 'spring' ? 1 : season === 'summer' ? 0.8 : season === 'autumn' ? (m === 10 ? 0.15 : 0.35) : s.kind === 'pine' ? 0.08 : 0;
  if (s.fed != null && day - s.fed < FEED_EVERY + 7) p *= 1.5;
  return p;
}

/** How big a pad can get: trimming makes it bushier, so it can grow bigger. */
export const padMax = (s: Pick<State, 'kind'>, t: Twig) => (s.kind === 'pine' ? 34 : 31) + t.d * 4;

/** Where a shoot starts, at the edge of its pad, and where its tip is. */
export function shootEnds(t: Twig, sh: Pick<Shoot, 'a' | 'len'>): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = t.x + Math.cos(sh.a) * t.r * 0.85;
  const y0 = t.y + Math.sin(sh.a) * t.r * 0.55;
  return { x0, y0, x1: x0 + Math.cos(sh.a) * sh.len, y1: y0 + Math.sin(sh.a) * sh.len };
}

const inside = (x: number, y: number) => x >= BOUNDS.left && x <= BOUNDS.right && y >= BOUNDS.top && y <= BOUNDS.bottom;
/** Room for a new pad to grow, away from the edges. */
const roomy = (x: number, y: number) => Math.abs(x) <= BOUNDS.right - 36 && y >= BOUNDS.top + 30 && y <= -60;

/** The soil a little drier, up to a moment. Someone looking after it while the family's away keeps it damp. */
function dryTo(s: State, t: number): State {
  if (t <= s.at) return s;
  const water = s.away ? Math.max(s.water, 0.6) : Math.max(0, s.water - (dryRate(s, dayOf(s.at)) * (t - s.at)) / DAY);
  return { ...s, water, at: t };
}

/** Overnight, into `day`: pads fill out, shoots grow, and in autumn leaves fall. */
function grow(s: State, day: number): State {
  if (s.water < THIRSTY) {
    // Very thirsty for days: it drops a few leaves, but never many.
    const twigs = s.thirsty >= 4 ? s.twigs.map((t) => (t.r > 16 ? { ...t, r: Math.max(16, t.r - 0.5) } : t)) : s.twigs;
    return { ...s, day, thirsty: s.thirsty + 1, twigs };
  }
  const p = pace(s, day);
  let next = s.next;
  let twigs = s.twigs.map((t) => (t.r > 0 ? { ...t, r: Math.min(padMax(s, t), t.r + 0.5 * p) } : t));
  const byId = new Map(twigs.map((t) => [t.id, t]));
  let shoots: Shoot[] = [];
  for (const sh of s.shoots) {
    const t = byId.get(sh.on);
    if (!t) continue;
    let len = Math.min(SHOOT_MAX, sh.len + 6 * p);
    // Not past the edge of the picture, even as its pad grows.
    const tipAt = (l: number) => shootEnds(t, { a: sh.a, len: l });
    while (len > 4 && !inside(tipAt(len).x1, tipAt(len).y1)) len -= 2;
    const grown = { ...sh, len };
    // Left alone long enough, a shoot becomes a branch with a little pad of its own, if there's room for one.
    const tip = tipAt(len);
    if (grown.len >= SHOOT_MAX && day - sh.day >= 10 && twigs.length < MAX_TWIGS && roomy(tip.x1, tip.y1)) {
      const id = next++;
      const twig: Twig = { id, p: t.id, x: Math.round(tip.x1), y: Math.round(tip.y1), r: 12, d: 0 };
      twigs = [...twigs, twig];
      byId.set(id, twig);
      continue;
    }
    shoots.push(grown);
  }
  // New shoots, a couple at most on any pad.
  if (p > 0) {
    for (const t of twigs) {
      if (t.r <= 0 || shoots.length >= MAX_SHOOTS || shoots.filter((sh) => sh.on === t.id).length >= 2) continue;
      if (rand(s.seed, day, t.id, 1) >= 0.2 * p) continue;
      const parent = byId.get(t.p);
      const out = parent ? Math.atan2(t.y - parent.y, t.x - parent.x) : -Math.PI / 2;
      // Outwards from the branch, leaning up towards the light.
      const a = out * 0.65 + (-Math.PI / 2) * 0.35 + (rand(s.seed, day, t.id, 2) - 0.5) * 1.3;
      const sh: Shoot = { id: next++, on: t.id, a, len: 6, day };
      const tip = shootEnds(t, sh);
      if (inside(tip.x1, tip.y1)) shoots = [...shoots, sh];
    }
  }
  // Leaves come down in October and November, and cherry petals in April.
  const m = monthOf(day);
  const falls = (s.kind !== 'pine' && (m === 9 || m === 10)) || (s.kind === 'cherry' && m === 3);
  const fallen = falls && rand(s.seed, day, 3) < 0.75 ? Math.min(14, s.fallen + 1 + Math.floor(rand(s.seed, day, 4) * 2)) : s.fallen;
  return { ...s, day, twigs, shoots, next, fallen, thirsty: 0 };
}

/** The tree as it is now: every day since it was last looked at grown, and the soil dried to this moment. */
export function advance(s: State, now: number): State {
  const today = dayOf(now);
  let t = s;
  // Back after a very long time: only the last year or so matters.
  if (today - t.day > 400) t = { ...t, day: today - 400, at: Math.max(t.at, startOf(today - 400)) };
  while (t.day < today) {
    t = dryTo(t, startOf(t.day + 1));
    t = grow(t, t.day + 1);
  }
  return dryTo(t, now);
}

/** A young tree from the nursery, a little shaggy, with dry soil: the first jobs are a drink and a trim. */
export function plant(kind: Kind, name: string, now: number, seed: number, band?: Band): State {
  const j = (n: number, spread: number) => (rand(seed, n) - 0.5) * spread;
  const side = rand(seed, 99) < 0.5 ? -1 : 1;
  const wide = kind === 'pine' ? 1.2 : kind === 'cherry' ? 0.85 : 1;
  const lift = kind === 'cherry' ? 14 : kind === 'pine' ? -4 : 0;
  const t1 = { x: j(1, 24), y: -52 };
  const t2 = { x: t1.x + j(2, 36), y: -100 };
  const t3 = { x: t2.x + j(3, 28), y: -142 };
  const twigs: Twig[] = [
    { id: 0, p: -1, x: 0, y: 0, r: 0, d: 0 },
    { id: 1, p: 0, ...t1, r: 0, d: 0 },
    { id: 2, p: 1, ...t2, r: 0, d: 0 },
    { id: 3, p: 2, ...t3, r: 0, d: 0 },
    { id: 4, p: 3, x: t3.x + j(4, 18), y: -180 - j(5, 8), r: 26, d: 1 },
    { id: 5, p: 1, x: t1.x + side * (78 + j(6, 14)) * wide, y: t1.y - 16 - lift + j(7, 8), r: 27, d: 1 },
    { id: 6, p: 2, x: t2.x - side * (72 + j(8, 14)) * wide, y: t2.y - 14 - lift + j(9, 8), r: 25, d: 1 },
    { id: 7, p: 3, x: t3.x + side * (52 + j(10, 10)) * wide, y: t3.y - 10 - lift + j(11, 6), r: 21, d: 0 },
    { id: 8, p: 2, x: t2.x + side * 20, y: t2.y - 38, r: 17, d: 0 },
  ].map((t) => ({ ...t, x: Math.round(t.x), y: Math.round(t.y) }));
  const day = dayOf(now);
  const shoots: Shoot[] = [
    { id: 9, on: 5, a: side > 0 ? -0.5 : -2.64, len: 22, day: day - 6 },
    { id: 10, on: 4, a: -1.75 + j(12, 0.6), len: 18, day: day - 5 },
  ];
  return {
    turn: 'gardener',
    kind,
    name: name.trim().slice(0, 30) || suggestedNames[kind],
    seed,
    ...(band ? { band } : {}),
    born: day,
    day,
    water: 0.2,
    at: now,
    twigs,
    shoots,
    next: 11,
    fallen: 0,
    thirsty: 0,
    cared: 0,
    caredOn: -1,
    pot: 'blue',
    extras: [],
  };
}

/** Counts today as a day it was looked after. */
function care(s: State, now: number): State {
  const today = dayOf(now);
  return s.caredOn === today ? s : { ...s, cared: s.cared + 1, caredOn: today };
}

export type Done = { state: State; note: string } | { state: null; note: string };

export function water(s: State, now: number): Done {
  const t = advance(s, now);
  if (t.water >= WET) return { state: null, note: `The soil is still wet, so ${t.name} doesn't need more yet. Too much water is bad for the roots.` };
  const note = t.water < THIRSTY ? `Ahh, ${t.name} really needed that. Watch the leaves perk up.` : 'A good drink. The soil is nice and damp now.';
  return { state: care({ ...t, water: Math.min(1, t.water + 0.7), thirsty: 0 }, now), note };
}

export function trim(s: State, shootId: number, now: number): Done {
  const t = advance(s, now);
  const sh = t.shoots.find((x) => x.id === shootId);
  if (!sh) return { state: null, note: 'That shoot has gone already.' };
  // Trimming a shoot makes its pad bushier, which is the whole art of bonsai.
  const twigs = t.twigs.map((x) => (x.id === sh.on ? { ...x, d: Math.min(4, x.d + 1), r: Math.min(padMax(t, { ...x, d: Math.min(4, x.d + 1) }), x.r + 1) } : x));
  const left = t.shoots.filter((x) => x.id !== shootId);
  const long = left.filter((x) => x.len >= TRIM_AT).length;
  const note = long ? `Snip! ${long} more to trim.` : 'Snip! All neat and tidy. Trimming makes the leaves grow thicker.';
  return { state: care({ ...t, twigs, shoots: left }, now), note };
}

export function canFeed(s: State, now: number): 'yes' | 'winter' | 'soon' {
  const day = dayOf(now);
  if (seasonOf(day) === 'winter') return 'winter';
  return s.fed != null && day - s.fed < FEED_EVERY ? 'soon' : 'yes';
}

export function feed(s: State, now: number): Done {
  const t = advance(s, now);
  const can = canFeed(t, now);
  if (can === 'winter') return { state: null, note: `${t.name} is resting for the winter. Feed again in spring.` };
  if (can === 'soon') {
    const days = FEED_EVERY - (dayOf(now) - t.fed!);
    return { state: null, note: `${t.name} was fed not long ago. Feed again in ${days === 1 ? 'a day' : `${days} days`}.` };
  }
  return { state: care({ ...t, fed: dayOf(now) }, now), note: `Yum. Food helps ${t.name} grow over the next few weeks.` };
}

export function sweep(s: State, now: number): Done {
  const t = advance(s, now);
  if (!t.fallen) return { state: null, note: 'Nothing to sweep up.' };
  return { state: care({ ...t, fallen: 0 }, now), note: 'All swept up.' };
}

export function setAway(s: State, away: boolean, now: number): State {
  const t = advance(s, now);
  return away ? { ...t, away: true } : { ...t, away: undefined };
}

/** Pots and things to put by the tree, unlocked by days of looking after it. */
export const unlocks: { what: Pot | Extra; days: number; label: string }[] = [
  { what: 'moss', days: 2, label: 'Soft moss' },
  { what: 'clay', days: 3, label: 'Clay pot' },
  { what: 'stone', days: 5, label: 'A smooth stone' },
  { what: 'giraffe', days: 7, label: 'A tiny Night Giraffe' },
  { what: 'cream', days: 10, label: 'Cream pot' },
  { what: 'lantern', days: 14, label: 'A stone lantern' },
  { what: 'frog', days: 21, label: 'A little frog' },
  { what: 'night', days: 30, label: 'Midnight pot' },
];

export const POTS: Pot[] = ['blue', 'clay', 'cream', 'night'];
export const potNames: Record<Pot, string> = { blue: 'Blue pot', clay: 'Clay pot', cream: 'Cream pot', night: 'Midnight pot' };

export const unlocked = (s: Pick<State, 'cared'>, what: Pot | Extra) => what === 'blue' || unlocks.some((u) => u.what === what && s.cared >= u.days);

/** What became unlocked between two states, to say so. */
export const newlyUnlocked = (before: State, after: State) => unlocks.filter((u) => before.cared < u.days && after.cared >= u.days);

export function setPot(s: State, pot: Pot): State | null {
  return unlocked(s, pot) && s.pot !== pot ? { ...s, pot } : null;
}

export function toggleExtra(s: State, extra: Extra): State | null {
  if (!unlocked(s, extra)) return null;
  return { ...s, extras: s.extras.includes(extra) ? s.extras.filter((e) => e !== extra) : [...s.extras, extra] };
}

export type Job = 'water' | 'trim' | 'sweep' | 'feed';

/** The most useful thing to do next, which glows. */
export function nextJob(s: State, now: number): Job | null {
  if (s.away) return null;
  if (s.water < DRY) return 'water';
  if (s.shoots.some((x) => x.len >= TRIM_AT)) return 'trim';
  if (s.fallen >= 3) return 'sweep';
  if (canFeed(s, now) === 'yes') return 'feed';
  return null;
}

/** Whether it needs looking after enough to show under Your turn. */
export function needsYou(s: State): boolean {
  if (s.away) return false;
  return s.water < DRY || s.shoots.filter((x) => x.len >= TRIM_AT).length >= 3 || s.fallen >= 6;
}

/** A line about how it's doing. */
export function mood(s: State, now: number): string {
  const day = dayOf(now);
  if (s.away) return `Someone kind is looking after ${s.name} while you're away.`;
  if (s.water < THIRSTY) return s.thirsty >= 2 ? `${s.name} is very thirsty and has stopped growing.` : `${s.name} is thirsty. The soil is dry.`;
  if (s.water < DRY) return `The soil is getting dry. ${s.name} would like a drink soon.`;
  if (bare(s, day)) return `${s.name} is sleeping for the winter, and will wake up with new leaves in spring.`;
  const long = s.shoots.filter((x) => x.len >= TRIM_AT).length;
  if (long >= 3) return `${s.name} is getting shaggy: ${long} shoots to trim.`;
  const m = monthOf(day);
  if (s.kind === 'cherry' && (m === 2 || m === 3)) return `${s.name} is in blossom!`;
  if (s.kind === 'maple' && (m === 9 || m === 10)) return `${s.name}'s leaves have turned for autumn.`;
  return `${s.name} is happy.`;
}

/** How the soil feels, in words. */
export const soilWords = (w: number) => (w < THIRSTY ? 'Dry' : w < DRY ? 'Getting dry' : w < WET ? 'Damp' : 'Wet');

/** "12 days old", "1 day old", "Planted today". */
export function age(s: State, now: number): string {
  const n = dayOf(now) - s.born;
  return n <= 0 ? 'Planted today' : n === 1 ? '1 day old' : `${n} days old`;
}

export type Visitor = 'night_giraffe' | 'ladybird' | 'butterfly' | 'bird' | 'robin';

/** Who's visiting today, if anyone. The Night Giraffe comes some nights, to say goodnight. */
export function visitorFor(s: State, now: number): Visitor | null {
  const day = dayOf(now);
  const hour = new Date(now).getHours();
  if (hour >= 19 || hour < 6) return rand(s.seed, day, 7) < 0.6 ? 'night_giraffe' : null;
  const r = rand(s.seed, day, 8);
  switch (seasonOf(day)) {
    case 'spring':
    case 'summer':
      return r < 0.3 ? 'butterfly' : r < 0.55 ? 'ladybird' : r < 0.75 ? 'bird' : null;
    case 'autumn':
      return r < 0.25 ? 'robin' : r < 0.45 ? 'ladybird' : r < 0.6 ? 'bird' : null;
    case 'winter':
      return r < 0.45 ? 'robin' : null;
  }
}

export const visitorHello: Record<Visitor, (name: string) => string> = {
  night_giraffe: (name) => `The Night Giraffe popped by to see ${name}. Sweet dreams!`,
  ladybird: (name) => `A ladybird is having a rest on ${name}. Ladybirds eat the bugs that nibble leaves.`,
  butterfly: () => 'A butterfly! It fluttered off to find some flowers.',
  bird: (name) => `A little bird stopped on ${name} to sing.`,
  robin: () => 'A robin came to say hello. Robins sing all through the winter.',
};
