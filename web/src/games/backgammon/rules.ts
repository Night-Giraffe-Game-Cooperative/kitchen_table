// Backgammon rules engine (no doubling cube).
//
// points[i] > 0 means that many White checkers on point i, < 0 means Black checkers.
// White moves 23 -> 0, enters from the bar at 24 - die and bears off from 0..5.
// Black moves 0 -> 23, enters from the bar at die - 1 and bears off from 18..23.
// Every exported function is pure: positions are plain JSON objects and are never mutated.

export type Side = 'w' | 'b';

export interface Position {
  points: number[]; // length 24
  bar: { w: number; b: number };
  off: { w: number; b: number };
  turn: Side;
}

export interface Move {
  from: number | 'bar';
  to: number | 'off';
  die: number;
}

export interface Outcome {
  moves: Move[];
  position: Position; // the position after the moves; the turn is not switched
}

const CHECKERS = 15;

export function initial(turn: Side = 'w'): Position {
  const points: number[] = new Array<number>(24).fill(0);
  points[23] = 2;
  points[12] = 5;
  points[7] = 3;
  points[5] = 5;
  points[0] = -2;
  points[11] = -5;
  points[16] = -3;
  points[18] = -5;
  return { points, bar: { w: 0, b: 0 }, off: { w: 0, b: 0 }, turn };
}

export function rollDice(random: () => number = Math.random): [number, number] {
  const one = (): number => Math.min(6, Math.floor(random() * 6) + 1);
  return [one(), one()];
}

export function diceFor(roll: [number, number]): number[] {
  const [a, b] = roll;
  return a === b ? [a, a, a, a] : [a, b];
}

export function legalSequences(pos: Position, dice: number[]): Move[][] {
  return search(pos, dice).map((leaf) => leaf.moves);
}

// Like legalSequences, but also hands back the position each sequence reaches (used by the computer player).
export function legalOutcomes(pos: Position, dice: number[]): Outcome[] {
  return search(pos, dice).map((leaf) => ({ moves: leaf.moves, position: toPosition(leaf.board, pos.turn) }));
}

export function legalFirstMoves(pos: Position, dice: number[]): Move[] {
  if (isOver(pos)) return [];
  const board = toBoard(pos);
  const side = pos.turn;
  const memo = new Map<string, number>();
  const steps = stepsFor(board, side, dice);
  const depths = steps.map((m) => {
    const hit = play(board, side, m);
    const d = 1 + maxDepth(board, side, useDie(dice, m), memo);
    unplay(board, side, m, hit);
    return d;
  });
  const best = Math.max(0, ...depths);
  let moves = steps.filter((_, i) => depths[i] === best);
  // Only one die can be used at all: it must be the larger one when that is playable.
  if (best === 1) {
    const top = Math.max(...moves.map((m) => m.die));
    moves = moves.filter((m) => m.die === top);
  }
  return moves;
}

export function applyMove(pos: Position, move: Move): Position {
  const side = pos.turn;
  const board = toBoard(pos);
  if (!isLegalStep(board, side, move)) {
    throw new Error(`Illegal move for ${side}: ${JSON.stringify(move)}`);
  }
  play(board, side, move);
  return toPosition(board, side);
}

export function useDie(dice: number[], move: Move): number[] {
  const left = dice.slice();
  const i = left.indexOf(move.die);
  if (i >= 0) left.splice(i, 1);
  return left;
}

export function canMove(pos: Position, dice: number[]): boolean {
  return !isOver(pos) && stepsFor(toBoard(pos), pos.turn, dice).length > 0;
}

export function endTurn(pos: Position): Position {
  return { ...clone(pos), turn: other(pos.turn) };
}

export function pipCount(pos: Position, side: Side): number {
  let pips = pos.bar[side] * 25;
  for (let i = 0; i < 24; i++) {
    const n = pos.points[i];
    if (side === 'w' && n > 0) pips += n * (i + 1);
    if (side === 'b' && n < 0) pips += -n * (24 - i);
  }
  return pips;
}

export function canBearOff(pos: Position, side: Side): boolean {
  return allHome(toBoard(pos), side);
}

export function winner(pos: Position): Side | null {
  if (pos.off.w >= CHECKERS) return 'w';
  if (pos.off.b >= CHECKERS) return 'b';
  return null;
}

export function winKind(pos: Position): 'single' | 'gammon' | 'backgammon' | null {
  const win = winner(pos);
  if (!win) return null;
  const loser = other(win);
  if (pos.off[loser] > 0) return 'single';
  // A gammon becomes a backgammon when the loser still has a checker on the bar or in the winner's home board.
  const home = win === 'w' ? [0, 5] : [18, 23];
  let stuck = pos.bar[loser] > 0;
  for (let i = home[0]; i <= home[1]; i++) {
    if (owner(pos, i) === loser) stuck = true;
  }
  return stuck ? 'backgammon' : 'gammon';
}

export function owner(pos: Position, point: number): Side | null {
  const n = pos.points[point] ?? 0;
  return n > 0 ? 'w' : n < 0 ? 'b' : null;
}

export function count(pos: Position, point: number): number {
  return Math.abs(pos.points[point] ?? 0);
}

export function destination(pos: Position, from: number | 'bar', die: number, side: Side): number | 'off' | null {
  return landing(toBoard(pos), side, from, die);
}

// ---------------------------------------------------------------------------------------------------------------
// Internals. Search works on a flat mutable copy of the position (never on the caller's object):
// indices 0..23 are the points, then White's bar, Black's bar, White's borne-off and Black's borne-off counts.

type Board = number[];

const W_BAR = 24;
const B_BAR = 25;
const W_OFF = 26;
const B_OFF = 27;

interface Leaf {
  moves: Move[];
  board: Board;
}

function other(side: Side): Side {
  return side === 'w' ? 'b' : 'w';
}

function clone(pos: Position): Position {
  return { points: pos.points.slice(), bar: { ...pos.bar }, off: { ...pos.off }, turn: pos.turn };
}

function isOver(pos: Position): boolean {
  return winner(pos) !== null;
}

function toBoard(pos: Position): Board {
  return [...pos.points, pos.bar.w, pos.bar.b, pos.off.w, pos.off.b];
}

function toPosition(board: Board, turn: Side): Position {
  return {
    points: board.slice(0, 24),
    bar: { w: board[W_BAR], b: board[B_BAR] },
    off: { w: board[W_OFF], b: board[B_OFF] },
    turn,
  };
}

function keyOf(board: Board): string {
  let key = '';
  for (let i = 0; i < 28; i++) key += String.fromCharCode(board[i] + 80);
  return key;
}

// Bearing off is allowed only when all 15 checkers are in the home board or already borne off.
function allHome(board: Board, side: Side): boolean {
  let home = 0;
  if (side === 'w') {
    for (let i = 0; i <= 5; i++) if (board[i] > 0) home += board[i];
    return home + board[W_OFF] === CHECKERS;
  }
  for (let i = 18; i <= 23; i++) if (board[i] < 0) home -= board[i];
  return home + board[B_OFF] === CHECKERS;
}

// Where a checker lands, ignoring blocking; null when it would leave the board but may not bear off.
function landing(board: Board, side: Side, from: number | 'bar', die: number): number | 'off' | null {
  if (from === 'bar') return side === 'w' ? 24 - die : die - 1;
  const to = side === 'w' ? from - die : from + die;
  if (to >= 0 && to <= 23) return to;
  if (!allHome(board, side)) return null;
  if (to === -1 || to === 24) return 'off';
  // A die higher than needed may bear off only the rearmost checker: none may sit further from home.
  if (side === 'w') {
    for (let i = from + 1; i <= 5; i++) if (board[i] > 0) return null;
  } else {
    for (let i = 18; i < from; i++) if (board[i] < 0) return null;
  }
  return 'off';
}

function blocked(board: Board, side: Side, point: number): boolean {
  return side === 'w' ? board[point] <= -2 : board[point] >= 2;
}

// Every single legal move for one die value, ignoring what the other dice could do.
function stepsForDie(board: Board, side: Side, die: number, out: Move[]): void {
  const sign = side === 'w' ? 1 : -1;
  // A checker on the bar must enter before any other checker may move.
  if (board[side === 'w' ? W_BAR : B_BAR] > 0) {
    const to = side === 'w' ? 24 - die : die - 1;
    if (!blocked(board, side, to)) out.push({ from: 'bar', to, die });
    return;
  }
  // Walk from the back of the board towards home, so the most natural sequence is found first.
  for (let k = 0; k < 24; k++) {
    const from = side === 'w' ? 23 - k : k;
    if (board[from] * sign <= 0) continue;
    const to = landing(board, side, from, die);
    if (to === null) continue;
    if (to === 'off' || !blocked(board, side, to)) out.push({ from, to, die });
  }
}

// Single legal moves for each distinct die value, larger dice first.
function stepsFor(board: Board, side: Side, dice: number[]): Move[] {
  const out: Move[] = [];
  const values: number[] = [];
  for (const die of dice) if (!values.includes(die)) values.push(die);
  values.sort((a, b) => b - a);
  for (const die of values) stepsForDie(board, side, die, out);
  return out;
}

function isLegalStep(board: Board, side: Side, move: Move): boolean {
  const steps: Move[] = [];
  stepsForDie(board, side, move.die, steps);
  return steps.some((m) => m.from === move.from && m.to === move.to);
}

// Moves one checker in place; returns whether it hit a blot, so the move can be undone.
function play(board: Board, side: Side, move: Move): boolean {
  const sign = side === 'w' ? 1 : -1;
  if (move.from === 'bar') board[side === 'w' ? W_BAR : B_BAR]--;
  else board[move.from] -= sign;
  if (move.to === 'off') {
    board[side === 'w' ? W_OFF : B_OFF]++;
    return false;
  }
  if (board[move.to] === -sign) {
    // Hitting a blot sends the opposing checker to its bar.
    board[move.to] = sign;
    board[side === 'w' ? B_BAR : W_BAR]++;
    return true;
  }
  board[move.to] += sign;
  return false;
}

function unplay(board: Board, side: Side, move: Move, hit: boolean): void {
  const sign = side === 'w' ? 1 : -1;
  if (move.to === 'off') board[side === 'w' ? W_OFF : B_OFF]--;
  else if (hit) {
    board[move.to] = -sign;
    board[side === 'w' ? B_BAR : W_BAR]--;
  } else board[move.to] -= sign;
  if (move.from === 'bar') board[side === 'w' ? W_BAR : B_BAR]++;
  else board[move.from] += sign;
}

// The most dice that can be used from here (memoised on position and remaining dice).
function maxDepth(board: Board, side: Side, dice: number[], memo: Map<string, number>): number {
  if (dice.length === 0) return 0;
  const key = keyOf(board) + dice.join('');
  const known = memo.get(key);
  if (known !== undefined) return known;
  let best = 0;
  for (const m of stepsFor(board, side, dice)) {
    const hit = play(board, side, m);
    const d = 1 + maxDepth(board, side, useDie(dice, m), memo);
    unplay(board, side, m, hit);
    if (d > best) best = d;
    if (best === dice.length) break;
  }
  memo.set(key, best);
  return best;
}

// How far back a move starts: the bar is furthest back (25), then each side's 24-point down to its 1-point.
function rank(side: Side, from: number | 'bar'): number {
  if (from === 'bar') return 25;
  return side === 'w' ? from + 1 : 24 - from;
}

// Depth-first search for the sequences that use the most dice. Any legal sequence can be replayed with its
// rearmost checkers moved first (moving a back checker never blocks or un-blocks a later move, and only makes
// bearing off easier), so only that order is searched; sequences reaching the same position are then merged.
function search(pos: Position, dice: number[]): Leaf[] {
  if (isOver(pos)) return [];
  const side = pos.turn;
  const board = toBoard(pos);
  const path: Move[] = [];
  let leaves: Leaf[] = [];
  let best = 0;
  const walk = (left: number[], limit: number): void => {
    let moved = false;
    for (const m of stepsFor(board, side, left)) {
      const r = rank(side, m.from);
      if (r > limit) continue;
      moved = true;
      const hit = play(board, side, m);
      path.push(m);
      walk(useDie(left, m), r);
      path.pop();
      unplay(board, side, m, hit);
    }
    // A dead end (possibly only in this order) shorter than the best so far is dropped straight away.
    if (moved || path.length === 0 || path.length < best) return;
    if (path.length > best) {
      best = path.length;
      leaves = [];
    }
    leaves.push({ moves: path.slice(), board: board.slice() });
  };
  walk(dice, 25);
  // A player must use both dice if any sequence allows it (handled by keeping only the longest sequences).
  // If only one die can be used, the larger one must be played when it can be.
  if (best === 1) {
    const top = Math.max(...leaves.map((leaf) => leaf.moves[0].die));
    leaves = leaves.filter((leaf) => leaf.moves[0].die === top);
  }
  const unique = new Map<string, Leaf>();
  for (const leaf of leaves) {
    const key = keyOf(leaf.board);
    if (!unique.has(key)) unique.set(key, leaf);
  }
  return [...unique.values()];
}
