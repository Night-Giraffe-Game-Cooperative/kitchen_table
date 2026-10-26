// The rules of Where's the Giraffe?: where the Night Giraffe hides in a photo,
// how far each guess lands from him, and which clues each age band gets.
// Spots are fractions of the photo (0 to 1 across and down); distances are in
// the photo's real proportions, measured in lengths of its shorter side.
import { bandOf, type Band } from '../bands';
import type { Picture } from '../photos';

export interface Spot {
  x: number;
  y: number;
}

export interface Guess extends Spot {
  by: number;
}

export interface State {
  /** 'hider' while he is being hidden, then 'anyone' while everyone else seeks. */
  turn: 'hider' | 'anyone';
  media: Picture;
  /** Where his head is; null until the hider chooses. */
  spot: Spot | null;
  /** The middle of the glow that shows the area he's in: near him, never right on him. */
  area: Spot | null;
  guesses: Guess[];
  foundBy: number | null;
  /** found, shown (someone asked to see him), or the server's stopped or idle. */
  ended?: string;
  band?: Band;
}

/** How close a guess must land to find him, in lengths of the photo's shorter side. */
export const RADIUS: Record<Band, number> = { '5-7': 0.14, '8-10': 0.1, '11-13': 0.075, '14+': 0.055 };

/** The glow is about this many times as wide as the space that finds him. */
export const AREA_TIMES = 3;

/** Guesses before a seeker may ask to see where he is. */
export const SHOW_AFTER = 10;

/** words: "Warmer!" and "Colder" and hot or cold dots. heat: hot or cold dots only. none: "Not there". */
export type ClueLevel = 'words' | 'heat' | 'none';

const LEVEL: Record<Band, ClueLevel> = { '5-7': 'words', '8-10': 'words', '11-13': 'heat', '14+': 'none' };
const AREA_AFTER: Record<Band, number | null> = { '5-7': 8, '8-10': 15, '11-13': null, '14+': null };

/** The clues for a band. Learn mode gives the 8–10 clues (words, colours, the glow after 15) at any age. */
export function cluesFor(band: Band, learn: boolean): { level: ClueLevel; areaAfter: number | null } {
  if (!learn) return { level: LEVEL[band], areaAfter: AREA_AFTER[band] };
  return { level: 'words', areaAfter: AREA_AFTER[band] ?? 15 };
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A spot kept inside the photo, rounded so the saved game stays small. */
export const spotAt = (x: number, y: number): Spot => ({ x: round(clamp01(x)), y: round(clamp01(y)) });

/** The distance between two spots in the photo's real shape, in lengths of its shorter side. */
export function distance(a: Spot, b: Spot, media: Pick<Picture, 'width' | 'height'>): number {
  const short = Math.min(media.width, media.height);
  return Math.hypot(((a.x - b.x) * media.width) / short, ((a.y - b.y) * media.height) / short);
}

export const isFound = (at: Spot, spot: Spot, media: Picture, band: Band) => distance(at, spot, media) <= RADIUS[band];

/** 0 cold, 1 cool, 2 warm, 3 hot, 4 very hot: how close a guess is, in steps of the band's radius. */
export type Heat = 0 | 1 | 2 | 3 | 4;

export function heatOf(d: number, radius: number): Heat {
  const k = d / radius;
  if (k <= 2) return 4;
  if (k <= 3.5) return 3;
  if (k <= 5.5) return 2;
  if (k <= 8) return 1;
  return 0;
}

export const HEAT: { name: string; symbol: string }[] = [
  { name: 'Cold', symbol: '❄️' },
  { name: 'Cool', symbol: '🌧️' },
  { name: 'Warm', symbol: '🌤️' },
  { name: 'Hot', symbol: '☀️' },
  { name: 'Very hot!', symbol: '🔥' },
];

export type Trend = 'warmer' | 'colder' | 'same';

/** Closer or further than the guess before, with a little give so a tiny step counts as the same. */
export function trendOf(d: number, before: number, radius: number): Trend {
  const give = radius * 0.15;
  if (d < before - give) return 'warmer';
  if (d > before + give) return 'colder';
  return 'same';
}

export interface Clue {
  found: boolean;
  /** Null when the band gives no clues. */
  heat: Heat | null;
  /** Compared with the guess before; null for the first guess, or when the band has no words. */
  trend: Trend | null;
  /** What the guess says: "Warmer!", "Cold", "Not there". */
  word: string;
}

const TREND_WORD: Record<Trend, string> = { warmer: 'Warmer!', colder: 'Colder', same: 'About the same' };

/** The clue each guess gives, in order. Each one is compared with the guess just before it, whoever made it. */
export function cluesOf(state: Pick<State, 'guesses' | 'spot' | 'media'>, band: Band, level: ClueLevel): Clue[] {
  const spot = state.spot;
  if (!spot) return [];
  const r = RADIUS[band];
  const ds = state.guesses.map((g) => distance(g, spot, state.media));
  return ds.map((d, i) => {
    if (d <= r) return { found: true, heat: 4, trend: null, word: 'Found him!' };
    if (level === 'none') return { found: false, heat: null, trend: null, word: 'Not there' };
    const heat = heatOf(d, r);
    if (level === 'heat' || i === 0 || heat === 4) return { found: false, heat, trend: null, word: HEAT[heat].name };
    const trend = trendOf(d, ds[i - 1], r);
    return { found: false, heat, trend, word: TREND_WORD[trend] };
  });
}

/**
 * The middle of the glow that shows his area. It sits between a third and
 * three fifths of the glow's radius away from him, in a random direction,
 * so he's always inside it but never right in the middle. Turned back
 * towards the photo when it would land off the edge.
 */
export function areaAround(spot: Spot, media: Picture, band: Band, random = Math.random): Spot {
  const reach = AREA_TIMES * RADIUS[band];
  const d = reach * (0.34 + 0.26 * random());
  const angle = random() * 2 * Math.PI;
  const short = Math.min(media.width, media.height);
  let dx = (d * Math.cos(angle) * short) / media.width;
  let dy = (d * Math.sin(angle) * short) / media.height;
  if (spot.x + dx < 0 || spot.x + dx > 1) dx = -dx;
  if (spot.y + dy < 0 || spot.y + dy > 1) dy = -dy;
  return spotAt(spot.x + dx, spot.y + dy);
}

export function fresh(media: Picture, band?: Band): State {
  return { turn: 'hider', media, spot: null, area: null, guesses: [], foundBy: null, ...(band ? { band } : {}) };
}

/** Hides him: the seeking starts. Null if he's already hidden. */
export function hide(state: State, at: Spot, random = Math.random): State | null {
  if (state.turn !== 'hider' || state.spot || state.ended) return null;
  const spot = spotAt(at.x, at.y);
  return { ...state, turn: 'anyone', spot, area: areaAround(spot, state.media, bandOf(state), random) };
}

/** One guess. Null if it can't be made: he isn't hidden yet, he's been found, or it's the hider guessing. */
export function guess(state: State, at: Spot, by: number, hider: unknown): { state: State; found: boolean } | null {
  if (state.turn !== 'anyone' || !state.spot || state.ended || state.foundBy != null || by === hider) return null;
  const g: Guess = { ...spotAt(at.x, at.y), by };
  const found = isFound(g, state.spot, state.media, bandOf(state));
  const next: State = { ...state, guesses: [...state.guesses, g] };
  return { state: found ? { ...next, foundBy: by, ended: 'found' } : next, found };
}

/**
 * Whether the game is waiting on this person, so it shows under Your turn:
 * the hider until he's hidden, then each seeker until they've had a guess.
 */
export function waitsFor(state: State, hider: unknown, me: number): boolean {
  if (state.ended || state.foundBy != null) return false;
  if (state.turn === 'hider') return hider === me;
  // Used for the Games list too, so careful with a saved game missing its guesses.
  return !!state.spot && hider !== me && !(state.guesses ?? []).some((g) => g.by === me);
}

/** Whether a seeker may ask to see where he is. */
export const canShow = (state: State) => state.turn === 'anyone' && !!state.spot && !state.ended && state.guesses.length >= SHOW_AFTER;

/** Whether the glow showing his area is out yet. */
export const areaShown = (state: State, areaAfter: number | null) => !!state.area && areaAfter !== null && state.guesses.length >= areaAfter;

export const guessesText = (n: number) => `${n} ${n === 1 ? 'guess' : 'guesses'}`;

/** "Mia found the Night Giraffe after 7 guesses" */
export function foundSummary(name: string, guesses: number): string {
  return guesses === 1 ? `${name} found the Night Giraffe with the very first guess` : `${name} found the Night Giraffe after ${guesses} guesses`;
}

export const NOBODY = 'Nobody found the Night Giraffe this time';

/** Moves the crosshair for an arrow key, the same real distance across or down; null for any other key. */
export function nudge(p: Spot, key: string, media: Picture, big = false): Spot | null {
  const short = Math.min(media.width, media.height);
  const step = big ? 0.1 : 0.025;
  const dx = (step * short) / media.width;
  const dy = (step * short) / media.height;
  const moves: Record<string, [number, number]> = { ArrowLeft: [-dx, 0], ArrowRight: [dx, 0], ArrowUp: [0, -dy], ArrowDown: [0, dy] };
  const m = moves[key];
  return m ? spotAt(p.x + m[0], p.y + m[1]) : null;
}

/** Where a spot is, in words: "near the top, on the left". */
export function placeWords(p: Spot): string {
  const across = p.x < 0.2 ? 'far left' : p.x < 0.4 ? 'left' : p.x <= 0.6 ? 'middle' : p.x <= 0.8 ? 'right' : 'far right';
  const down = p.y < 0.2 ? 'at the top' : p.y < 0.4 ? 'near the top' : p.y <= 0.6 ? 'halfway down' : p.y <= 0.8 ? 'near the bottom' : 'at the bottom';
  return across === 'middle' ? `${down}, in the middle` : `${down}, on the ${across}`;
}

/** A length in shorter sides as a percentage of the photo's width, for placing things on it. */
export const widthPct = (units: number, media: Picture) => (units * Math.min(media.width, media.height) * 100) / media.width;
