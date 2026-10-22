// Snakes and Ladders rules: the hand-made boards for each age band, rolling,
// hopping along the board, ladders and snakes, the exact finish, and whose
// turn comes next. The board lives in the game's state, so everyone sees the
// same one and a game keeps its board even if these change later.
import { nextSeat } from '../common';
import type { Band } from '../bands';

export interface Board {
  size: number;
  /** Squares in a row. The board winds: row one goes left to right, row two right to left, and so on. */
  cols: number;
  /** Ladders and snakes, from → to. Up is a ladder, down is a snake. */
  links: Record<string, number>;
  /** Whether you need the exact roll to land on the last square, bouncing back the extra. */
  exact: boolean;
}

export interface Roll {
  roll: number;
  from: number;
  /** Where the counter ended up, after any ladder or snake. */
  to: number;
  /** The ladder foot or snake head it landed on, if any. */
  via?: number;
  /** Which roll of the game this was, from 1, so a move's rolls can be played back in order. */
  n: number;
}

export interface State {
  turn: string;
  board: Board;
  /** Square each seat is on; everyone starts on 1. */
  pos: Record<string, number>;
  last: Record<string, Roll>;
  rolls: number;
  winner?: string;
  band?: Band;
}

/** The computer seat in a game against the Night Giraffe. */
export const GIRAFFE = 'giraffe';
export const FAMILY = 'family';

const links = (pairs: [number, number][]) => Object.fromEntries(pairs.map(([from, to]) => [String(from), to]));

/**
 * Hand-made boards. Younger boards are small with more ladders and short
 * snakes; older ones have more and longer snakes and need an exact finish.
 */
export const BOARDS: Record<Band, Board> = {
  // About 7 rolls each.
  '5-7': {
    size: 30,
    cols: 6,
    exact: false,
    links: links([
      [2, 14],
      [9, 22],
      [13, 25],
      [18, 29],
      [17, 7],
      [27, 21],
    ]),
  },
  // About 30 rolls each.
  '8-10': {
    size: 100,
    cols: 10,
    exact: false,
    links: links([
      [4, 25],
      [9, 31],
      [20, 38],
      [28, 54],
      [40, 59],
      [51, 72],
      [63, 81],
      [71, 92],
      [18, 3],
      [46, 26],
      [58, 37],
      [74, 53],
      [86, 66],
      [93, 73],
      [97, 78],
    ]),
  },
  // About 35 rolls each.
  '11-13': {
    size: 100,
    cols: 10,
    exact: false,
    links: links([
      [3, 22],
      [8, 29],
      [27, 46],
      [41, 63],
      [54, 75],
      [64, 83],
      [76, 95],
      [16, 5],
      [36, 17],
      [47, 32],
      [58, 38],
      [70, 49],
      [80, 60],
      [88, 68],
      [94, 74],
      [99, 62],
    ]),
  },
  // About 45 rolls each: the exact finish adds plenty. A snake near 100 would double that.
  '14+': {
    size: 100,
    cols: 10,
    exact: true,
    links: links([
      [3, 24],
      [9, 32],
      [40, 61],
      [45, 66],
      [53, 72],
      [77, 96],
      [14, 6],
      [31, 10],
      [36, 16],
      [48, 28],
      [59, 42],
      [64, 22],
      [79, 58],
      [86, 76],
      [91, 51],
      [93, 54],
    ]),
  },
};

export function boardFor(band: Band): Board {
  const b = BOARDS[band];
  return { ...b, links: { ...b.links } };
}

export const rowsOf = (b: Board) => Math.ceil(b.size / b.cols);

/** Where a square sits: column from the left and row from the bottom, both from 0. */
export function cellOf(b: Board, n: number): { col: number; row: number } {
  const row = Math.floor((n - 1) / b.cols);
  const i = (n - 1) % b.cols;
  return { row, col: row % 2 === 0 ? i : b.cols - 1 - i };
}

export function squareAt(b: Board, col: number, row: number): number {
  return row * b.cols + (row % 2 === 0 ? col : b.cols - 1 - col) + 1;
}

/** [from, to] pairs, lowest first. */
export function linkList(b: Board): [number, number][] {
  return Object.entries(b.links)
    .map(([from, to]) => [Number(from), to] as [number, number])
    .sort((x, y) => x[0] - y[0]);
}

export const ladders = (b: Board) => linkList(b).filter(([from, to]) => to > from);
export const snakes = (b: Board) => linkList(b).filter(([from, to]) => to < from);

/** What's wrong with a board, if anything: for the tests, and for boards from saved games. */
export function problems(b: Board): string[] {
  const out: string[] = [];
  if (b.size % b.cols !== 0) out.push(`${b.size} squares don't fill rows of ${b.cols}`);
  const pairs = linkList(b);
  const starts = new Set(pairs.map(([from]) => from));
  const used = new Map<number, number>();
  for (const [from, to] of pairs) {
    if (!Number.isInteger(from) || from <= 1 || from >= b.size) out.push(`${from} is the first or last square, or off the board`);
    if (!Number.isInteger(to) || to < 1 || to > b.size) out.push(`${from} goes off the board to ${to}`);
    if (to === from) out.push(`${from} goes nowhere`);
    if (starts.has(to)) out.push(`${from} → ${to} leads straight into another`);
    if (cellOf(b, from).row === cellOf(b, to).row) out.push(`${from} → ${to} stays on one row`);
    for (const sq of [from, to]) used.set(sq, (used.get(sq) ?? 0) + 1);
  }
  for (const [sq, n] of used) if (n > 1) out.push(`${sq} has more than one ladder or snake`);
  return out;
}

export function rollDie(random = Math.random): number {
  return Math.min(6, Math.floor(random() * 6) + 1);
}

/** Every square the counter hops onto, in order. Past the end it stops there, or bounces back on an exact board. */
export function hopPath(b: Board, from: number, roll: number): number[] {
  const out: number[] = [];
  let at = from;
  let dir = 1;
  for (let i = 0; i < roll; i++) {
    if (at >= b.size) {
      if (!b.exact) break;
      dir = -1;
    }
    at += dir;
    out.push(at);
  }
  return out;
}

/** Whether a roll went past the end and came back. */
export function bounced(b: Board, r: Pick<Roll, 'from' | 'roll'>): boolean {
  return b.exact && r.from + r.roll > b.size;
}

/** Where a roll takes a counter. */
export function advance(b: Board, from: number, roll: number): Omit<Roll, 'n'> {
  const path = hopPath(b, from, roll);
  const land = path.length ? path[path.length - 1] : from;
  const link = b.links[String(land)];
  return link ? { roll, from, to: link, via: land } : { roll, from, to: land };
}

export function newGame(board: Board, order: string[]): State {
  return { turn: order[0], board, pos: Object.fromEntries(order.map((s) => [s, 1])), last: {}, rolls: 0 };
}

/** One roll for the seat whose turn it is; null if it isn't their turn or the game is over. */
export function takeTurn(s: State, order: string[], seat: string, roll: number): State | null {
  if (s.winner || s.turn !== seat || !order.includes(seat) || !Number.isInteger(roll) || roll < 1 || roll > 6) return null;
  const r: Roll = { ...advance(s.board, s.pos[seat] ?? 1, roll), n: s.rolls + 1 };
  const won = r.to === s.board.size;
  return {
    ...s,
    pos: { ...s.pos, [seat]: r.to },
    last: { ...s.last, [seat]: r },
    rolls: r.n,
    turn: won ? seat : nextSeat(order, seat),
    ...(won ? { winner: seat } : {}),
  };
}

/**
 * The seat whose turn it is rolls, and any computer seats after it roll
 * straight away, all in one move: a computer seat can never save a move of
 * its own.
 */
export function rollTurn(s: State, seats: Record<string, unknown>, order: string[], seat: string, random = Math.random): State | null {
  let next = takeTurn(s, order, seat, rollDie(random));
  for (let i = 0; next && !next.winner && seats[next.turn] === 'computer' && i < order.length; i++) {
    next = takeTurn(next, order, next.turn, rollDie(random));
  }
  return next;
}

/** The rolls in the most recent move, in order: a person's roll and the Night Giraffe's straight after it. */
export function latestRolls(s: State): { seat: string; roll: Roll }[] {
  const all = Object.entries(s.last)
    .map(([seat, roll]) => ({ seat, roll }))
    .sort((a, b) => a.roll.n - b.roll.n);
  const newest = all[all.length - 1];
  if (!newest) return [];
  const before = all[all.length - 2];
  return newest.seat === GIRAFFE && before && before.roll.n === newest.roll.n - 1 ? [before, newest] : [newest];
}

/** "You rolled a 4 and moved from 12 to 16. A ladder took you up to 34!" `name` is "You", "Mia", "The family" or "The Night Giraffe". */
export function describeRoll(name: string, r: Roll, b: Board): string {
  const them = name === 'You' ? 'you' : name.replace(/^The /, 'the ');
  const land = r.via ?? r.to;
  const moved = bounced(b, r) ? `moved from ${r.from} to ${b.size}, then bounced back to ${land}` : `moved from ${r.from} to ${land}`;
  const link = !r.via ? '' : r.to > r.via ? ` A ladder took ${them} up to ${r.to}!` : ` A snake took ${them} down to ${r.to}.`;
  return `${name} rolled a ${r.roll} and ${moved}.${link}`;
}

/** The few words said beside the die after a roll, if anything special happened. */
export function sayRoll(r: Roll, b: Board): { text: string; kind: 'up' | 'down' | 'bounce' | 'end' } | null {
  if (r.via) return r.to > r.via ? { text: `A ladder! Up to ${r.to}`, kind: 'up' } : { text: `Oh no, a snake! Down to ${r.to}`, kind: 'down' };
  if (r.to === b.size) return { text: `${b.size}! All the way to the top`, kind: 'end' };
  if (bounced(b, r)) return { text: `Too many! Back to ${r.to}`, kind: 'bounce' };
  return null;
}
