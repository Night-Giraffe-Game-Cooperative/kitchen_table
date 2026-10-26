// Story Chain against each other. Players take turns writing a line each, so
// everyone writes the same number. When the story is done, everyone in the
// chat (players and anyone reading along) gives a star to each line they love,
// though never their own. The writer whose lines collect the most stars wins,
// and the line with the most stars is the best line.
import { leaders, listNames, nextSeat, placings, seatOf } from '../common';
import type { Band } from '../bands';

export interface Line {
  u: number;
  text: string;
}

export interface StoryVersus {
  /** The writer's seat; 'anyone' once it's time for stars. */
  turn: string;
  starter: string;
  lines: Line[];
  /** Lines in all: `each` for every player. */
  length: number;
  each: number;
  phase: 'writing' | 'stars';
  /** Line number -> people who gave it a star. */
  stars: Record<string, number[]>;
  /** People who have finished giving stars. */
  done: number[];
  band?: Band;
}

export function newStory(starter: string, each: number, order: string[]): StoryVersus {
  return { turn: order[0], starter, lines: [], length: each * order.length, each, phase: 'writing', stars: {}, done: [] };
}

/** A line from the player whose turn it is. The last line opens the stars. */
export function addLine(s: StoryVersus, order: string[], seat: string, u: number, text: string): StoryVersus | null {
  const line = text.trim().replace(/\s+/g, ' ');
  if (s.phase !== 'writing' || s.turn !== seat || !line) return null;
  const lines = [...s.lines, { u, text: line }];
  if (lines.length >= s.length) return { ...s, lines, phase: 'stars', turn: 'anyone' };
  return { ...s, lines, turn: nextSeat(order, seat) };
}

export function canStar(s: StoryVersus, line: number, voter: number): boolean {
  return s.phase === 'stars' && !!s.lines[line] && s.lines[line].u !== voter;
}

/** Gives a line a star, or takes it back. */
export function toggleStar(s: StoryVersus, line: number, voter: number): StoryVersus | null {
  if (!canStar(s, line, voter)) return null;
  const list = s.stars[line] ?? [];
  const next = list.includes(voter) ? list.filter((v) => v !== voter) : [...list, voter];
  return { ...s, stars: { ...s.stars, [line]: next } };
}

export function markDone(s: StoryVersus, voter: number): StoryVersus | null {
  if (s.phase !== 'stars' || s.done.includes(voter)) return null;
  return { ...s, done: [...s.done, voter] };
}

/** Whether every player has given their stars. */
export function everyoneStarred(s: StoryVersus, players: number[]): boolean {
  return players.every((id) => s.done.includes(id));
}

/**
 * Whether the story is waiting on this person: to write the next line, or,
 * once it's written, to give their stars. Stars time has no seat's turn, so
 * without this it wouldn't show under "Your turn" for anyone.
 */
export function waitsOn(s: StoryVersus, seats: Record<string, unknown>, me: number): boolean {
  if (s.phase === 'writing') return seats[s.turn] === me;
  return !!seatOf(seats, me) && !s.done.includes(me);
}

export const starsFor = (s: StoryVersus, line: number) => (s.stars[line] ?? []).length;

/** Stars each writer collected. */
export function totals(s: StoryVersus, players: number[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(players.map((id) => [id, 0]));
  s.lines.forEach((l, i) => (out[l.u] = (out[l.u] ?? 0) + starsFor(s, i)));
  return out;
}

export function standings(s: StoryVersus, players: number[]) {
  const t = totals(s, players);
  return placings(players, (a, b) => t[b] - t[a]).map(({ item, place }) => ({ id: item, place, stars: t[item] }));
}

/** The writers with the most stars; nobody if no stars were given. */
export function starWinners(s: StoryVersus, players: number[]): number[] {
  const t = totals(s, players);
  if (!Object.values(t).some((n) => n > 0)) return [];
  return leaders(t, players.map(String)).map(Number);
}

/** The line or lines with the most stars, if any has one. */
export function bestLines(s: StoryVersus): number[] {
  const counts = s.lines.map((_, i) => starsFor(s, i));
  const top = Math.max(0, ...counts);
  return top > 0 ? counts.flatMap((n, i) => (n === top ? [i] : [])) : [];
}

export const starsText = (n: number) => `${n} ${n === 1 ? 'star' : 'stars'}`;

/** The line posted to the chat at the end. */
export function storySummary(s: StoryVersus, players: number[], name: (id: number) => string): string {
  const winners = starWinners(s, players);
  if (!winners.length) return `${listNames(players.map(name))} finished a story: "${clip(s.starter, 120)}"`;
  const t = totals(s, players);
  const head =
    winners.length === 1
      ? `${name(winners[0])}'s lines got the most stars in Story Chain (${starsText(t[winners[0]])}) 🌟`
      : `${listNames(winners.map(name))} shared the most stars in Story Chain 🌟`;
  const best = bestLines(s)[0];
  if (best === undefined) return head;
  const by = ` Best line, by ${name(s.lines[best].u)}: "`;
  const room = 200 - head.length - by.length - 1;
  return room >= 20 ? `${head}${by}${clip(s.lines[best].text, room)}"` : head;
}

function clip(text: string, max: number) {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}
