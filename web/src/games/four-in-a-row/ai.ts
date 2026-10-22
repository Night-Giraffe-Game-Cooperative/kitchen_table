// The computer player. Gentle (5–7) plays mostly at random with a liking for
// the middle, takes a win only about half the time and never blocks on
// purpose. Steady (8–10) always takes a win and blocks a four, and otherwise
// scores the shape each column makes. Tricky (11–13) and strong (14+) search
// ahead with negamax and alpha-beta, 5 and 8 moves deep, middle columns first,
// over a board that counts every line of four as counters land, so a move and
// its score update in a few steps. The strong one also remembers positions it
// has seen and stops deepening when its time is up, to answer within a second
// on a tablet.
import { COLS, ROWS, isColumn } from './rules';

export type Level = 1 | 2 | 3 | 4; // 1 = gentle (young children can win), 2 = steady, 3 = tricky, 4 = strong

const N = COLS * ROWS;
/** The middle first: the best moves are usually there, and searching them first prunes more. */
const ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN = 1_000_000;
const NEAR_WIN = WIN - 1000;
const INF = 2 * WIN;

// Every line of four on the board (69 of them) as cell numbers, col * ROWS + row,
// and the lines through each cell, flattened for speed.
const LINES: number[][] = [];
for (let c = 0; c < COLS; c++) {
  for (let r = 0; r < ROWS; r++) {
    for (const [dc, dr] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ]) {
      const ec = c + 3 * dc;
      const er = r + 3 * dr;
      if (ec < 0 || ec >= COLS || er < 0 || er >= ROWS) continue;
      LINES.push([0, 1, 2, 3].map((k) => (c + k * dc) * ROWS + r + k * dr));
    }
  }
}
const THROUGH_START = new Int16Array(N + 1);
const THROUGH = new Int16Array(LINES.length * 4);
{
  const through: number[][] = Array.from({ length: N }, () => []);
  LINES.forEach((line, i) => line.forEach((cell) => through[cell].push(i)));
  let at = 0;
  for (let cell = 0; cell < N; cell++) {
    THROUGH_START[cell] = at;
    for (const l of through[cell]) THROUGH[at++] = l;
  }
  THROUGH_START[N] = at;
}

/**
 * What a line is worth, red minus yellow, by how many of each are in it
 * (index red * 5 + yellow). A line with both colours can never be four.
 */
const SHAPE = [0, 1, 4, 32, 5000];
const LINE_VALUE = new Int32Array(25);
for (let red = 0; red <= 4; red++) {
  for (let yellow = 0; yellow <= 4; yellow++) LINE_VALUE[red * 5 + yellow] = red && yellow ? 0 : red ? SHAPE[red] : -SHAPE[yellow];
}

/** Small fixed random generator (mulberry32), so the position keys are the same every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
const KEY_A = new Int32Array(2 * N);
const KEY_B = new Int32Array(2 * N);
{
  const next = seeded(0xf0e1);
  for (let i = 0; i < 2 * N; i++) {
    KEY_A[i] = next() | 0;
    KEY_B[i] = next() | 0;
  }
}

/** A board that keeps count of each line of four as counters are added and taken away. */
class Board {
  cells = new Int8Array(N); // 0 empty, 1 red, 2 yellow
  heights = new Int8Array(COLS);
  red = new Int8Array(LINES.length);
  yellow = new Int8Array(LINES.length);
  /** Every line's value added up, red minus yellow. */
  score = 0;
  filled = 0;
  keyA = 0;
  keyB = 0;

  /** 0 for red to move, 1 for yellow. */
  get turn(): number {
    return this.filled & 1;
  }

  canPlay(c: number): boolean {
    return this.heights[c] < ROWS;
  }

  /** Whether a counter of `side` in this empty cell would complete a line. */
  completes(cell: number, side: number): boolean {
    const counts = side === 0 ? this.red : this.yellow;
    for (let i = THROUGH_START[cell], end = THROUGH_START[cell + 1]; i < end; i++) if (counts[THROUGH[i]] === 3) return true;
    return false;
  }

  /** Whether `side` would make four by dropping in column c now. */
  winsIn(c: number, side: number): boolean {
    const h = this.heights[c];
    return h < ROWS && this.completes(c * ROWS + h, side);
  }

  /** Whether the space above column c's next one would make four for `side`. */
  winsAbove(c: number, side: number): boolean {
    const h = this.heights[c] + 1;
    return h < ROWS && this.completes(c * ROWS + h, side);
  }

  play(c: number) {
    const side = this.filled & 1;
    const cell = c * ROWS + this.heights[c]++;
    this.cells[cell] = side + 1;
    const red = this.red;
    const yellow = this.yellow;
    for (let i = THROUGH_START[cell], end = THROUGH_START[cell + 1]; i < end; i++) {
      const l = THROUGH[i];
      const before = LINE_VALUE[red[l] * 5 + yellow[l]];
      if (side === 0) red[l]++;
      else yellow[l]++;
      this.score += LINE_VALUE[red[l] * 5 + yellow[l]] - before;
    }
    this.filled++;
    this.keyA ^= KEY_A[side * N + cell];
    this.keyB ^= KEY_B[side * N + cell];
  }

  undo(c: number) {
    const cell = c * ROWS + --this.heights[c];
    const side = this.cells[cell] - 1;
    this.cells[cell] = 0;
    const red = this.red;
    const yellow = this.yellow;
    for (let i = THROUGH_START[cell], end = THROUGH_START[cell + 1]; i < end; i++) {
      const l = THROUGH[i];
      const before = LINE_VALUE[red[l] * 5 + yellow[l]];
      if (side === 0) red[l]--;
      else yellow[l]--;
      this.score += LINE_VALUE[red[l] * 5 + yellow[l]] - before;
    }
    this.filled--;
    this.keyA ^= KEY_A[side * N + cell];
    this.keyB ^= KEY_B[side * N + cell];
  }

  /** The shape score for the side to move. */
  value(): number {
    return this.filled & 1 ? -this.score : this.score;
  }

  /** Whether some line already has four. */
  hasFour(): boolean {
    for (let l = 0; l < LINES.length; l++) if (this.red[l] === 4 || this.yellow[l] === 4) return true;
    return false;
  }
}

/** The board after these moves, or null if they don't make sense. */
function boardFrom(moves: readonly number[]): Board | null {
  const b = new Board();
  for (const c of moves) {
    if (!isColumn(c) || !b.canPlay(c)) return null;
    b.play(c);
  }
  return b;
}

const legal = (b: Board) => ORDER.filter((c) => b.canPlay(c));

// ---------------------------------------------------------------------------------------------------------------
// Search

// Positions already searched: one slot per key, made once and cleared for each search.
const TT_SIZE = 1 << 18;
const TT_MASK = TT_SIZE - 1;
const EXACT = 1;
const LOWER = 2;
const UPPER = 3;
let tt: { key: Int32Array; value: Int32Array; depth: Int8Array; flag: Int8Array; move: Int8Array } | null = null;

function table() {
  tt ??= { key: new Int32Array(TT_SIZE), value: new Int32Array(TT_SIZE), depth: new Int8Array(TT_SIZE), flag: new Int8Array(TT_SIZE), move: new Int8Array(TT_SIZE) };
  return tt;
}

// Wins are stored counted from the position itself, so they read right at any depth.
const toTable = (v: number, ply: number) => (v > NEAR_WIN ? v + ply : v < -NEAR_WIN ? v - ply : v);
const fromTable = (v: number, ply: number) => (v > NEAR_WIN ? v - ply : v < -NEAR_WIN ? v + ply : v);

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

class OutOfTime extends Error {}

interface Search {
  deadline: number;
  nodes: number;
}

/** The value of the position for the side to move, looking `depth` moves ahead. */
function negamax(b: Board, depth: number, alpha: number, beta: number, ply: number, s: Search): number {
  if ((++s.nodes & 1023) === 0 && now() > s.deadline) throw new OutOfTime();
  const me = b.filled & 1;
  const them = me ^ 1;
  // A four now ends it.
  for (let c = 0; c < COLS; c++) if (b.winsIn(c, me)) return WIN - ply - 1;
  // With one space left and no four to make there, it's a draw.
  if (b.filled >= N - 1) return 0;
  // Their four next go has to be blocked, and two of them can't both be.
  let forced = -1;
  for (let c = 0; c < COLS; c++) {
    if (!b.winsIn(c, them)) continue;
    if (forced >= 0) return -(WIN - ply - 2);
    forced = c;
  }
  if (depth <= 0) return b.value();

  const t = table();
  const slot = b.keyA & TT_MASK;
  let hashed = -1;
  if (t.flag[slot] && t.key[slot] === b.keyB) {
    hashed = t.move[slot];
    if (t.depth[slot] >= depth) {
      const v = fromTable(t.value[slot], ply);
      const f = t.flag[slot];
      if (f === EXACT || (f === LOWER && v >= beta) || (f === UPPER && v <= alpha)) return v;
    }
  }

  const alphaBefore = alpha;
  let best = -INF;
  let bestMove = -1;
  for (let i = -1; i < COLS; i++) {
    const c = i < 0 ? (forced >= 0 ? forced : hashed) : ORDER[i];
    if (c < 0 || (i >= 0 && (forced >= 0 || c === hashed)) || !b.canPlay(c)) continue;
    let v: number;
    // Filling the space under one of their fours lets them drop on top and win.
    if (b.winsAbove(c, them)) v = -(WIN - ply - 2);
    else {
      b.play(c);
      v = -negamax(b, depth - 1, -beta, -alpha, ply + 1, s);
      b.undo(c);
    }
    if (v > best) {
      best = v;
      bestMove = c;
    }
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }

  t.key[slot] = b.keyB;
  t.value[slot] = toTable(best, ply);
  t.depth[slot] = depth;
  t.flag[slot] = best <= alphaBefore ? UPPER : best >= beta ? LOWER : EXACT;
  t.move[slot] = bestMove;
  return best;
}

/**
 * Searches deeper and deeper up to `depth`, keeping the last search that
 * finished in time. Picks at random among the moves within `margin` of the
 * best, so the computer doesn't play the same game every time.
 */
function searchRoot(b: Board, depth: number, margin: number, random: () => number, budgetMs: number): number {
  const moves = legal(b);
  const t = table();
  t.flag.fill(0);
  const s: Search = { deadline: now() + budgetMs, nodes: 0 };
  let choice = moves[0];
  let first = moves[0];
  for (let d = 1; d <= depth; d++) {
    const scored: [number, number][] = [];
    let best = -INF;
    try {
      for (const c of [first, ...moves.filter((m) => m !== first)]) {
        // Exact values for anything within the margin of the best so far; worse moves only need to be shown worse.
        const floor = best === -INF ? -INF : best - margin - 1;
        let v: number;
        if (b.winsAbove(c, b.turn ^ 1)) v = -(WIN - 2);
        else {
          b.play(c);
          v = -negamax(b, d - 1, -INF, -floor, 1, s);
          b.undo(c);
        }
        scored.push([c, v]);
        if (v > best) best = v;
      }
    } catch (e) {
      if (e instanceof OutOfTime) break;
      throw e;
    }
    // Never a slower win or a loss when something better is there.
    const close = scored.filter(([, v]) => (best > NEAR_WIN ? v === best : v >= best - margin));
    choice = close[Math.min(close.length - 1, Math.floor(random() * close.length))][0];
    first = scored.reduce((a, x) => (x[1] > a[1] ? x : a))[0];
    if (best > NEAR_WIN || best < -NEAR_WIN) break;
  }
  return choice;
}

// ---------------------------------------------------------------------------------------------------------------
// The players

/** How much the gentle player likes each column: mostly the middle. */
const LIKING = [1, 2, 3, 4, 3, 2, 1];

function gentle(b: Board, random: () => number): number {
  const me = b.turn;
  const wins = legal(b).filter((c) => b.winsIn(c, me));
  // Takes a win only about half the time, so young players get second chances.
  if (wins.length && random() < 0.5) return wins[0];
  const others = legal(b).filter((c) => !wins.includes(c));
  const pool = others.length ? others : legal(b);
  // Picks by liking alone: it never looks at the other side's lines, so it only blocks by luck.
  const total = pool.reduce((n, c) => n + LIKING[c], 0);
  let roll = random() * total;
  for (const c of pool) {
    roll -= LIKING[c];
    if (roll < 0) return c;
  }
  return pool[pool.length - 1];
}

function steady(b: Board, random: () => number): number {
  const me = b.turn;
  const them = me ^ 1;
  const moves = legal(b);
  const win = moves.find((c) => b.winsIn(c, me));
  if (win !== undefined) return win;
  const block = moves.find((c) => b.winsIn(c, them));
  if (block !== undefined) return block;
  // Otherwise the shape each column makes, a little shaken up.
  let best = moves[0];
  let bestScore = -INF;
  for (const c of moves) {
    b.play(c);
    let v = -b.value();
    b.undo(c);
    if (b.winsAbove(c, them)) v -= 500;
    v += random() * 6;
    if (v > bestScore) {
      bestScore = v;
      best = c;
    }
  }
  return best;
}

/** How long the searching players may think, in milliseconds. */
const BUDGET: Record<Level, number> = { 1: 0, 2: 0, 3: 1500, 4: 800 };

/**
 * The computer's column for the side to move after `moves`, or null when the
 * game is over. `random` is there so tests can repeat a game exactly.
 */
export function chooseColumn(moves: readonly number[], level: Level, random: () => number = Math.random, budgetMs = BUDGET[level]): number | null {
  const b = boardFrom(moves);
  if (!b || b.hasFour() || b.filled === N) return null;
  if (level === 1) return gentle(b, random);
  if (level === 2) return steady(b, random);
  const me = b.turn;
  const moveList = legal(b);
  const win = moveList.find((c) => b.winsIn(c, me));
  if (win !== undefined) return win;
  const block = moveList.find((c) => b.winsIn(c, me ^ 1));
  if (block !== undefined) return block;
  if (moveList.length === 1) return moveList[0];
  return level === 3 ? searchRoot(b, 5, 3, random, budgetMs) : searchRoot(b, 8, 0, random, budgetMs);
}

/** The best column the computer can find, for a hint: the same every time. */
export function bestColumn(moves: readonly number[]): number | null {
  const b = boardFrom(moves);
  if (!b || b.hasFour() || b.filled === N) return null;
  const me = b.turn;
  const moveList = legal(b);
  const win = moveList.find((c) => b.winsIn(c, me));
  if (win !== undefined) return win;
  const block = moveList.find((c) => b.winsIn(c, me ^ 1));
  if (block !== undefined) return block;
  return searchRoot(b, 7, 0, () => 0, 400);
}

/** The searching players' value of a position for the side to move, for tests. */
export function evaluate(moves: readonly number[], depth = 0): number {
  const b = boardFrom(moves);
  if (!b) throw new Error('Not a position');
  table().flag.fill(0);
  return negamax(b, depth, -INF, INF, 0, { deadline: Infinity, nodes: 0 });
}

export const WIN_SCORE = WIN;
