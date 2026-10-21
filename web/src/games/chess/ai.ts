// Computer opponent. Level 1 is a beginner that looks one move ahead and plays loosely; levels 2 and 3 are
// alpha-beta searches over the make/unmake board in core.ts, with quiescence on captures so they don't stop
// counting in the middle of an exchange. Search buffers are allocated once and reused between calls.

import {
  BISHOP, BLACK, Board, FLAG_EP, KING, PAWN, QUEEN, WHITE, from88, moveFrom, movePromo, moveTo, toMove,
} from './core';
import { toFen } from './rules';
import type { Move, Position } from './rules';

export type Level = 1 | 2 | 3; // 1 = gentle (young children can win), 2 = steady, 3 = tricky

// ---------------------------------------------------------------------------------------------------------------
// Evaluation

const VALUE = [0, 100, 320, 330, 500, 900, 0];
const PHASE = [0, 0, 1, 1, 2, 4, 0]; // 24 = all pieces on the board, 0 = bare kings and pawns

// Piece-square tables from White's side, a8 first (Tomasz Michniewski's "simplified evaluation function").
// prettier-ignore
const TABLES: number[][] = [
  [],
  [ // pawn
      0,   0,   0,   0,   0,   0,   0,   0,
     50,  50,  50,  50,  50,  50,  50,  50,
     10,  10,  20,  30,  30,  20,  10,  10,
      5,   5,  10,  25,  25,  10,   5,   5,
      0,   0,   0,  20,  20,   0,   0,   0,
      5,  -5, -10,   0,   0, -10,  -5,   5,
      5,  10,  10, -20, -20,  10,  10,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  [ // knight
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  [ // bishop
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  [ // rook
      0,   0,   0,   0,   0,   0,   0,   0,
      5,  10,  10,  10,  10,  10,  10,   5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
      0,   0,   0,   5,   5,   0,   0,   0,
  ],
  [ // queen
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,   5,   5,   5,   0, -10,
     -5,   0,   5,   5,   5,   5,   0,  -5,
      0,   0,   5,   5,   5,   5,   0,  -5,
    -10,   5,   5,   5,   5,   5,   0, -10,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20,
  ],
];
// prettier-ignore
const KING_MIDDLE = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
   20,  20,   0,   0,   0,   0,  20,  20,
   20,  30,  10,   0,   0,  10,  30,  20,
];
// prettier-ignore
const KING_END = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10,   0,   0, -10, -20, -30,
  -30, -10,  20,  30,  30,  20, -10, -30,
  -30, -10,  30,  40,  40,  30, -10, -30,
  -30, -10,  30,  40,  40,  30, -10, -30,
  -30, -10,  20,  30,  30,  20, -10, -30,
  -30, -30,   0,   0,   0,   0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

// Signed value + table score for every piece code (0..14) on every 0x88 square, so evaluation is one lookup per
// piece. Black reads White's table upside down (64-index ^ 56) and counts negative.
const PST = new Int16Array(16 * 128);
const KING_MG = new Int16Array(2 * 128);
const KING_EG = new Int16Array(2 * 128);
for (let s = 0; s < 128; s++) {
  if (s & 0x88) continue;
  const i = from88(s);
  for (let kind = PAWN; kind <= QUEEN; kind++) {
    PST[(kind << 7) | s] = VALUE[kind] + TABLES[kind][i];
    PST[((BLACK | kind) << 7) | s] = -(VALUE[kind] + TABLES[kind][i ^ 56]);
  }
  KING_MG[s] = KING_MIDDLE[i];
  KING_EG[s] = KING_END[i];
  KING_MG[128 + s] = -KING_MIDDLE[i ^ 56];
  KING_EG[128 + s] = -KING_END[i ^ 56];
}

const centreDistance = (s: number): number =>
  Math.max(3 - (s & 7), (s & 7) - 4) + Math.max(3 - (s >> 4), (s >> 4) - 4);
const kingDistance = (a: number, b: number): number => Math.abs((a & 7) - (b & 7)) + Math.abs((a >> 4) - (b >> 4));

/** Centipawns from White's point of view. */
function evalBoard(b: Board): number {
  const sq = b.sq;
  let score = 0;
  let phase = 0;
  let whiteMaterial = 0;
  let blackMaterial = 0;
  let whiteBishops = 0;
  let blackBishops = 0;
  for (let s = 0; s < 128; s++) {
    if (s & 8) {
      s += 7;
      continue;
    }
    const p = sq[s];
    if (!p) continue;
    const kind = p & 7;
    if (kind === KING) continue;
    score += PST[(p << 7) | s];
    phase += PHASE[kind];
    if (p & BLACK) {
      blackMaterial += VALUE[kind];
      if (kind === BISHOP) blackBishops++;
    } else {
      whiteMaterial += VALUE[kind];
      if (kind === BISHOP) whiteBishops++;
    }
  }
  if (phase > 24) phase = 24;
  const wk = b.kings[0];
  const bk = b.kings[1];
  // Kings shelter in the middlegame and walk to the centre in the endgame; blend the two by how much is left.
  if (wk >= 0) score += ((KING_MG[wk] * phase + KING_EG[wk] * (24 - phase)) / 24) | 0;
  if (bk >= 0) score += ((KING_MG[128 + bk] * phase + KING_EG[128 + bk] * (24 - phase)) / 24) | 0;
  // A king stuck on the d, e or f file with no castling rights left is a target while pieces remain (the tables
  // alone would happily walk it to e2). Castling bits: 3 = white's K and Q, 12 = black's k and q.
  if (wk >= 0 && !(b.castling & 3) && (wk & 7) >= 3 && (wk & 7) <= 5) score -= phase * 2;
  if (bk >= 0 && !(b.castling & 12) && (bk & 7) >= 3 && (bk & 7) <= 5) score += phase * 2;
  if (whiteBishops >= 2) score += 30;
  if (blackBishops >= 2) score -= 30;
  // When one side is well ahead in a thin endgame, push the other king to the edge and bring the kings together,
  // so the stronger side actually finishes the game instead of wandering.
  const lead = whiteMaterial - blackMaterial;
  if (phase <= 12 && wk >= 0 && bk >= 0 && (lead >= 300 || lead <= -300)) {
    const bonus = 10 * centreDistance(lead > 0 ? bk : wk) + 4 * (14 - kingDistance(wk, bk));
    score += lead > 0 ? bonus : -bonus;
  }
  return score;
}

export function evaluate(pos: Position): number {
  return evalBoard(new Board().load(pos));
}

// ---------------------------------------------------------------------------------------------------------------
// Search state, shared by every call (chooseMove is synchronous, so there is never more than one search running).

const MAX_PLY = 64;
const MATE = 30000;
const INF = 32000;
const IS_MATE = MATE - 2 * MAX_PLY;

let moveBuf: Int32Array;
let orderBuf: Int32Array;
let killers: Int32Array;
let history: Int32Array;
let pvTable: Int32Array;
let pvLength: Int32Array;
let pvPrevious: Int32Array;
let board: Board;
let nodes = 0;
let deadline = 0;
let stopped = false;

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

function setUp(pos: Position): void {
  if (!moveBuf) {
    moveBuf = new Int32Array(MAX_PLY * 256);
    orderBuf = new Int32Array(MAX_PLY * 256);
    killers = new Int32Array(MAX_PLY * 2);
    history = new Int32Array(64 * 64);
    pvTable = new Int32Array(MAX_PLY * MAX_PLY);
    pvLength = new Int32Array(MAX_PLY + 1);
    pvPrevious = new Int32Array(MAX_PLY);
    board = new Board();
  }
  board.load(pos);
  killers.fill(0);
  history.fill(0);
  pvPrevious.fill(0);
  nodes = 0;
  stopped = false;
}

const relativeEval = (): number => (board.turn === WHITE ? evalBoard(board) : -evalBoard(board));
const historyIndex = (m: number): number => (from88(moveFrom(m)) << 6) | from88(moveTo(m));
const victimOf = (m: number): number => (m & FLAG_EP ? PAWN : board.sq[moveTo(m)] & 7);

function timeUp(): boolean {
  if ((++nodes & 1023) === 0 && now() >= deadline) stopped = true;
  return stopped;
}

// Move ordering: last iteration's principal variation, then captures by most valuable victim / least valuable
// attacker, queen promotions, killer moves, then quiet moves by how often they caused cut-offs.
function scoreMoves(start: number, end: number, ply: number): void {
  const sq = board.sq;
  const pv = pvPrevious[ply];
  for (let i = start; i < end; i++) {
    const m = moveBuf[i];
    const victim = victimOf(m);
    let score: number;
    if (m === pv) score = 2_000_000;
    else if (victim) score = 1_000_000 + victim * 16 - (sq[moveFrom(m)] & 7) + (movePromo(m) === QUEEN ? 8 : 0);
    else if (movePromo(m) === QUEEN) score = 950_000;
    else if (movePromo(m)) score = -1;
    else if (m === killers[ply * 2]) score = 900_000;
    else if (m === killers[ply * 2 + 1]) score = 899_000;
    else score = Math.min(history[historyIndex(m)], 800_000);
    orderBuf[i] = score;
  }
}

// Selection sort one step at a time: cheap when a cut-off comes early, which is the common case.
function pickNext(i: number, end: number): number {
  let best = i;
  for (let j = i + 1; j < end; j++) if (orderBuf[j] > orderBuf[best]) best = j;
  if (best !== i) {
    const m = moveBuf[i];
    moveBuf[i] = moveBuf[best];
    moveBuf[best] = m;
    const o = orderBuf[i];
    orderBuf[i] = orderBuf[best];
    orderBuf[best] = o;
  }
  return moveBuf[i];
}

function quiesce(alpha: number, beta: number, ply: number, base: number): number {
  if (timeUp()) return 0;
  const standPat = relativeEval();
  if (standPat >= beta || ply >= MAX_PLY - 1) return standPat;
  if (standPat > alpha) alpha = standPat;
  const end = board.generate(moveBuf, base, false);
  scoreMoves(base, end, ply);
  let best = standPat;
  for (let i = base; i < end; i++) {
    const m = pickNext(i, end);
    // Delta pruning: skip a capture that could not lift us to alpha even if the piece came for free.
    if (!movePromo(m) && standPat + VALUE[victimOf(m)] + 200 <= alpha) continue;
    if (!board.tryMake(m)) continue;
    const score = -quiesce(-beta, -alpha, ply + 1, end);
    board.unmake(m);
    if (stopped) return 0;
    if (score > best) {
      best = score;
      if (score > alpha) {
        if (score >= beta) return score;
        alpha = score;
      }
    }
  }
  return best;
}

function search(depth: number, alpha: number, beta: number, ply: number, base: number): number {
  pvLength[ply] = ply;
  if (timeUp()) return 0;
  if (board.halfmove >= 100) return 0;
  const inCheck = board.inCheck();
  // Look one move further when in check, so the search never stops to evaluate a position with a check pending.
  if (inCheck && ply < MAX_PLY / 2) depth++;
  if (depth <= 0) return quiesce(alpha, beta, ply, base);
  if (ply >= MAX_PLY - 1) return relativeEval();

  const end = board.generate(moveBuf, base, true);
  scoreMoves(base, end, ply);
  let legal = 0;
  let best = -INF;
  for (let i = base; i < end; i++) {
    const m = pickNext(i, end);
    const quiet = !victimOf(m) && !movePromo(m);
    if (!board.tryMake(m)) continue;
    legal++;
    // Principal variation search: the first move gets a full window, the rest a null window that is only
    // widened when a move turns out better than expected.
    let score: number;
    if (legal === 1) {
      score = -search(depth - 1, -beta, -alpha, ply + 1, end);
    } else {
      score = -search(depth - 1, -alpha - 1, -alpha, ply + 1, end);
      if (score > alpha && score < beta && !stopped) score = -search(depth - 1, -beta, -alpha, ply + 1, end);
    }
    board.unmake(m);
    if (stopped) return 0;
    if (score > best) {
      best = score;
      if (score > alpha) {
        alpha = score;
        const row = ply * MAX_PLY;
        const child = row + MAX_PLY;
        pvTable[row + ply] = m;
        for (let j = ply + 1; j < pvLength[ply + 1]; j++) pvTable[row + j] = pvTable[child + j];
        pvLength[ply] = Math.max(pvLength[ply + 1], ply + 1);
        if (score >= beta) {
          if (quiet) {
            if (killers[ply * 2] !== m) {
              killers[ply * 2 + 1] = killers[ply * 2];
              killers[ply * 2] = m;
            }
            history[historyIndex(m)] += depth * depth;
          }
          break;
        }
      }
    }
  }
  if (!legal) return inCheck ? -MATE + ply : 0;
  return best;
}

const repetitionKey = (fen: string): string => fen.trim().split(/\s+/).slice(0, 4).join(' ');

/** For each root move, whether it returns to a position already seen in this game. */
function repeats(moves: number[], history: string[] | undefined): boolean[] {
  if (!history || !history.length) return moves.map(() => false);
  const seen = new Set(history.map(repetitionKey));
  return moves.map((m) => {
    board.make(m);
    const key = repetitionKey(toFen(board.toPosition()));
    board.unmake(m);
    return seen.has(key);
  });
}

/**
 * Iterative deepening at the root. With margin > 0, every root move scoring within `margin` of the best gets an
 * exact score, and one of them is chosen at random (never when a mate has been found). A root move back into a
 * position from the game history scores as a draw, so a winning side doesn't shuffle into threefold repetition.
 */
function searchRoot(
  moves: number[], maxDepth: number, timeMs: number, margin: number, random: () => number, history?: string[],
): number {
  // Shuffle first so moves that score exactly the same are picked in a different order each game.
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [moves[i], moves[j]] = [moves[j], moves[i]];
  }
  const n = moves.length;
  for (let i = 0; i < n; i++) moveBuf[i] = moves[i];
  scoreMoves(0, n, 0);
  const repeated = repeats(moves, history);
  const order = moves.map((m, i) => ({ m, score: orderBuf[i], repeated: repeated[i] }));
  order.sort((a, b) => b.score - a.score); // stable, so ties keep their shuffled order

  deadline = now() + timeMs;
  let bestMove = order[0].m;
  let bestScore = -INF;
  let finished: typeof order = [];

  for (let depth = 1; depth <= maxDepth; depth++) {
    let iterationBest = -INF;
    let iterationMove = 0;
    let completed = 0;
    for (let i = 0; i < n; i++) {
      const entry = order[i];
      board.make(entry.m);
      let score: number;
      if (entry.repeated) {
        score = 0;
        pvLength[1] = 1;
      } else if (i === 0) {
        score = -search(depth - 1, -INF, INF, 1, 0);
      } else {
        // Anything that can't come within `margin` of the best so far only needs a bound, not an exact score.
        const floor = iterationBest - (margin ? margin + 1 : 0);
        score = -search(depth - 1, -floor - 1, -floor, 1, 0);
        if (score > floor && !stopped) score = -search(depth - 1, -INF, -floor, 1, 0);
      }
      board.unmake(entry.m);
      if (stopped) break;
      entry.score = score;
      completed++;
      if (score > iterationBest) {
        iterationBest = score;
        iterationMove = entry.m;
        pvPrevious[0] = entry.m;
        for (let j = 1; j < pvLength[1]; j++) pvPrevious[j] = pvTable[MAX_PLY + j];
        pvPrevious.fill(0, Math.max(1, pvLength[1]));
      }
    }
    if (stopped) {
      // The previous best move is always searched first, so anything that beat it in this unfinished iteration
      // was searched fully and is a safe improvement.
      if (completed > 0 && iterationBest > -INF) {
        bestMove = iterationMove;
        bestScore = iterationBest;
        finished = [];
      }
      break;
    }
    order.sort((a, b) => b.score - a.score);
    bestMove = order[0].m;
    bestScore = order[0].score;
    finished = order.slice();
    if (bestScore >= IS_MATE || now() >= deadline) break;
  }

  if (margin && finished.length && Math.abs(bestScore) < IS_MATE) {
    const close = finished.filter((e) => e.score >= bestScore - margin);
    return close[Math.min(close.length - 1, Math.floor(random() * close.length))].m;
  }
  return bestMove;
}

// ---------------------------------------------------------------------------------------------------------------
// Level 1: a beginner who looks one move ahead.

/** What a capture wins if the capturing piece can then be taken back for nothing more. */
function captureGain(m: number): number {
  const victim = VALUE[victimOf(m)];
  if (!victim) return 0;
  const attacker = VALUE[board.sq[moveFrom(m)] & 7];
  const them = board.turn ^ BLACK;
  board.make(m);
  const defended = board.attacked(moveTo(m), them);
  board.unmake(m);
  return victim - (defended ? attacker : 0);
}

/** Material our move wins, minus the most the opponent can then grab straight back. */
function oneMoveNet(m: number): number {
  let net = captureGain(m);
  if (movePromo(m)) net += VALUE[movePromo(m)] - VALUE[PAWN];
  board.make(m);
  const end = board.generate(moveBuf, 0, false);
  let threat = 0;
  for (let i = 0; i < end; i++) {
    const reply = moveBuf[i];
    if (!victimOf(reply) || !board.tryMake(reply)) continue;
    board.unmake(reply);
    threat = Math.max(threat, captureGain(reply));
  }
  board.unmake(m);
  return net - threat;
}

function givesMate(m: number): boolean {
  board.make(m);
  const mate = board.inCheck() && !board.hasLegalMove();
  board.unmake(m);
  return mate;
}

function beginnerMove(moves: number[], random: () => number): number {
  const pick = <T>(xs: T[]): T => xs[Math.min(xs.length - 1, Math.floor(random() * xs.length))];
  // About half the time it notices a mate in one or a queen it can take for free, and always takes it.
  if (random() < 0.5) {
    const mate = moves.find(givesMate);
    if (mate !== undefined) return mate;
    const queen = moves.find((m) => victimOf(m) === QUEEN && captureGain(m) > 0);
    if (queen !== undefined) return queen;
  }
  // Now and then it simply doesn't look.
  if (random() < 0.1) return pick(moves);
  // Otherwise any move that doesn't hang more than a pawn (or, if everything loses something, close to the least
  // bad) is as good as any other to a beginner.
  const nets = moves.map(oneMoveNet);
  const floor = Math.min(0, Math.max(...nets)) - VALUE[PAWN];
  return pick(moves.filter((_, i) => nets[i] >= floor));
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * The computer's move, or null when there is none. `history` is optional and takes the same earlier-position FENs
 * as outcome(); with it, levels 2 and 3 steer away from repeating positions when they are ahead.
 */
export function chooseMove(
  pos: Position, level: Level, random: () => number = Math.random, history?: string[],
): Move | null {
  setUp(pos);
  const moves = board.legalMoves();
  if (!moves.length) return null;
  if (moves.length === 1) return toMove(moves[0]);
  if (level <= 1) return toMove(beginnerMove(moves, random));
  if (level === 2) return toMove(searchRoot(moves, 3, 600, 20, random, history));
  return toMove(searchRoot(moves, 5, 700, 0, random, history));
}
