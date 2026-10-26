// Picture Puzzle rules. Together, everyone swaps pieces on one board. Against
// each other it's a race: everyone gets the same jumble on a board of their
// own, the fewest swaps wins, and on a tie the quicker puzzler wins. Your time
// runs from when you press Start to your last swap.
import { listNames, placings, seatOf, seatOrder, shuffle } from '../common';
import type { Band } from '../bands';

/** A shuffle where no piece starts in its own place. */
export function scramble(n: number, random = Math.random): number[] {
  const count = n * n;
  for (;;) {
    const t = shuffle(
      Array.from({ length: count }, (_, i) => i),
      random,
    );
    if (t.every((piece, place) => piece !== place)) return t;
  }
}

export function isSolved(tiles: number[]) {
  return tiles.every((piece, place) => piece === place);
}

/** The fewest swaps that could put the pieces back: one less than the size of each loop of misplaced pieces. */
export function fewestSwaps(tiles: number[]): number {
  const seen = new Array<boolean>(tiles.length).fill(false);
  let loops = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (seen[i]) continue;
    loops++;
    for (let j = i; !seen[j]; j = tiles[j]) seen[j] = true;
  }
  return tiles.length - loops;
}

/**
 * Puts a piece in a place, swapping it with the piece there. It goes by the
 * piece, not the space it was picked up from, so if someone else moved it in
 * the meantime it's still the piece you picked up that moves. Null if either
 * piece is already in its right place, which stays put.
 */
export function placePiece(tiles: number[], piece: number, to: number): number[] | null {
  const from = tiles.indexOf(piece);
  if (from < 0 || from === to || tiles[to] === undefined || from === piece || tiles[to] === to) return null;
  const next = [...tiles];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export interface RaceBoard {
  tiles: number[];
  swaps: number;
  began: number;
  ended?: number;
}

export interface RaceState {
  turn: 'anyone';
  media: { url: string; width: number; height: number };
  size: number;
  /** The same jumble for everyone. */
  start: number[];
  /** Seat -> that player's own board, once they press Start. */
  boards: Record<string, RaceBoard>;
  band?: Band;
}

export function newRace(media: RaceState['media'], size: number, random = Math.random): RaceState {
  return { turn: 'anyone', media, size, start: scramble(size, random), boards: {} };
}

export const hasFinished = (b: RaceBoard | undefined): b is RaceBoard & { ended: number } => b?.ended !== undefined;
export const timeTaken = (b: RaceBoard & { ended: number }) => Math.max(0, b.ended - b.began);

export function begin(s: RaceState, seat: string, now: number): RaceState | null {
  if (s.boards[seat]) return null;
  return { ...s, boards: { ...s.boards, [seat]: { tiles: [...s.start], swaps: 0, began: now } } };
}

/** Swaps two pieces on one player's own board; pieces already in place stay put. */
export function swap(s: RaceState, seat: string, a: number, b: number, now: number): RaceState | null {
  const board = s.boards[seat];
  if (!board || hasFinished(board) || a === b) return null;
  if (board.tiles[a] === undefined || board.tiles[b] === undefined || board.tiles[a] === a || board.tiles[b] === b) return null;
  const tiles = [...board.tiles];
  [tiles[a], tiles[b]] = [tiles[b], tiles[a]];
  const next: RaceBoard = { ...board, tiles, swaps: board.swaps + 1, ...(isSolved(tiles) ? { ended: now } : {}) };
  return { ...s, boards: { ...s.boards, [seat]: next } };
}

/** Whether every place is taken and everyone in one has finished. */
export function everyoneFinished(s: RaceState, seats: Record<string, unknown>): boolean {
  return seatOrder(seats).every((k) => typeof seats[k] === 'number' && hasFinished(s.boards[k]));
}

/** Whether the race is waiting on this player: their puzzle isn't started or isn't finished. */
export function waitsOn(s: RaceState, seats: Record<string, unknown>, me: number): boolean {
  const seat = seatOf(seats, me);
  return !!seat && !hasFinished(s.boards[seat]);
}

export interface Placing {
  seat: string;
  /** Null for someone who hadn't finished when the race ended. */
  place: number | null;
  swaps?: number;
  time?: number;
}

/** Finishers by fewest swaps, then quickest; everyone else after them. */
export function standings(s: RaceState, order: string[]): Placing[] {
  const done = order.filter((k) => hasFinished(s.boards[k]));
  const ranked = placings(done, (a, b) => {
    const x = s.boards[a] as RaceBoard & { ended: number };
    const y = s.boards[b] as RaceBoard & { ended: number };
    return x.swaps - y.swaps || timeTaken(x) - timeTaken(y);
  }).map(({ item, place }) => {
    const b = s.boards[item] as RaceBoard & { ended: number };
    return { seat: item, place, swaps: b.swaps, time: timeTaken(b) };
  });
  return [...ranked, ...order.filter((k) => !done.includes(k)).map((seat) => ({ seat, place: null }))];
}

/** "45 s", "3 min 20 s", "2 h 5 min". */
export function formatTime(ms: number): string {
  const secs = Math.max(1, Math.round(ms / 1000));
  if (secs < 60) return `${secs} s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return secs % 60 ? `${mins} min ${secs % 60} s` : `${mins} min`;
  const hours = Math.floor(mins / 60);
  return mins % 60 ? `${hours} h ${mins % 60} min` : `${hours} h`;
}

const swapsText = (n: number) => `${n} ${n === 1 ? 'swap' : 'swaps'}`;

/** The line posted to the chat when the race ends. */
export function raceSummary(s: RaceState, order: string[], name: (seat: string) => string): string {
  const rows = standings(s, order);
  const winners = rows.filter((r) => r.place === 1);
  if (!winners.length) return 'The picture race ended before anyone finished 🧩';
  const best = winners[0].swaps!;
  const runnerUp = rows.find((r) => r.place === 2);
  const names = listNames(winners.map((r) => name(r.seat)));
  let head = winners.length > 1 ? `${names} shared first place in the picture race with ${swapsText(best)}` : `${names} won the picture race with ${swapsText(best)}`;
  if (winners.length === 1 && runnerUp?.swaps === best) head += `, just quicker than ${name(runnerUp.seat)}`;
  const rest = rows
    .filter((r) => r.place !== 1 && !(winners.length === 1 && r === runnerUp && r.swaps === best))
    .map((r) => (r.place ? `${name(r.seat)} ${r.swaps}` : `${name(r.seat)} didn't finish`));
  const line = `${head} 🧩${rest.length ? ` (${rest.join(', ')})` : ''}`;
  return line.length <= 200 ? line : `${head} 🧩`.slice(0, 200);
}
