// Chess rules: FEN, legal moves, SAN, game outcomes. Every exported function is pure: positions are plain
// JSON-serialisable objects and are never mutated. The fast mutable engine behind them lives in core.ts.

import {
  BLACK, Board, FLAG_CASTLE, FLAG_DOUBLE, FLAG_EP, KIND_CHARS, KING, PAWN, QUEEN, WHITE, moveFrom, movePromo, moveTo,
  to88, toMove,
} from './core';

export type Side = 'w' | 'b';
export type Kind = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export interface Piece { side: Side; kind: Kind }
export interface Position {
  board: (Piece | null)[]; // 64 squares; index 0 = a8, 7 = h8, 56 = a1, 63 = h1 (FEN order)
  turn: Side;
  castling: string; // subset of 'KQkq' in that order, or '' when none
  enPassant: number | null; // en passant target square index, or null
  halfmove: number;
  fullmove: number;
}
export interface Move { from: number; to: number; promotion?: Kind }
export type Outcome =
  | { kind: 'checkmate'; winner: Side }
  | { kind: 'stalemate' }
  | { kind: 'fifty' }
  | { kind: 'material' } // insufficient material: K v K, K+B v K, K+N v K, K+B v K+B same colour bishops
  | { kind: 'repetition' } // threefold, judged from the history passed in
  | null;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILES = 'abcdefgh';
const SAN_LETTERS = '  NBRQK';
const VALUES: Record<Kind, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNT: Record<Kind, number> = { q: 1, r: 2, b: 2, n: 2, p: 8, k: 1 };
const CAPTURE_ORDER: Kind[] = ['q', 'r', 'b', 'n', 'p'];

// ---------------------------------------------------------------------------------------------------------------
// Squares

export function fileOf(i: number): number {
  return i & 7;
}

export function rankOf(i: number): number {
  return 8 - (i >> 3);
}

export function squareName(i: number): string {
  if (!Number.isInteger(i) || i < 0 || i > 63) throw new RangeError(`Not a square index: ${i}`);
  return FILES[i & 7] + (8 - (i >> 3));
}

export function squareIndex(name: string): number {
  const m = /^([a-h])([1-8])$/.exec(name.trim().toLowerCase());
  if (!m) throw new RangeError(`Not a square name: ${name}`);
  return (8 - Number(m[2])) * 8 + FILES.indexOf(m[1]);
}

const name88 = (s: number): string => FILES[s & 7] + (8 - (s >> 4));

// ---------------------------------------------------------------------------------------------------------------
// FEN

export function parseFen(fen: string): Position {
  const fail = (why: string): never => {
    throw new Error(`Bad FEN (${why}): ${fen}`);
  };
  if (typeof fen !== 'string') fail('not a string');
  const fields = fen.trim().split(/\s+/);
  // The two move counters are often left off hand-written FENs, so they default to 0 and 1.
  if (fields.length < 4 || fields.length > 6) fail('expected 6 fields');
  const [placement, turn, castling, ep, half = '0', full = '1'] = fields;

  const rows = placement.split('/');
  if (rows.length !== 8) fail('expected 8 ranks');
  const board: (Piece | null)[] = [];
  const kings = { w: 0, b: 0 };
  rows.forEach((row, r) => {
    let width = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        width += Number(ch);
        for (let k = 0; k < Number(ch); k++) board.push(null);
        continue;
      }
      const kind = ch.toLowerCase() as Kind;
      if (!'pnbrqk'.includes(kind)) fail(`unknown piece '${ch}'`);
      const side: Side = ch === kind ? 'b' : 'w';
      if (kind === 'p' && (r === 0 || r === 7)) fail('pawn on the first or last rank');
      if (kind === 'k') kings[side]++;
      board.push({ side, kind });
      width++;
    }
    if (width !== 8) fail(`rank ${8 - r} does not have 8 squares`);
  });
  if (kings.w !== 1 || kings.b !== 1) fail('each side needs exactly one king');

  if (turn !== 'w' && turn !== 'b') fail('side to move must be w or b');

  if (castling !== '-' && (!/^[KQkq]{1,4}$/.test(castling) || new Set(castling).size !== castling.length)) {
    fail('castling field');
  }
  const rights = castling === '-' ? '' : [...'KQkq'].filter((c) => castling.includes(c)).join('');

  let enPassant: number | null = null;
  if (ep !== '-') {
    if (!/^[a-h][36]$/.test(ep)) fail('en passant square');
    if (ep[1] !== (turn === 'w' ? '6' : '3')) fail('en passant square on the wrong rank for the side to move');
    enPassant = squareIndex(ep);
  }

  if (!/^\d+$/.test(half) || !/^\d+$/.test(full)) fail('move counters');
  return {
    board,
    turn: turn as Side,
    castling: rights,
    enPassant,
    halfmove: Number(half),
    fullmove: Math.max(1, Number(full)),
  };
}

export function toFen(pos: Position): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pos.board[r * 8 + f];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      row += p.side === 'w' ? p.kind.toUpperCase() : p.kind;
    }
    rows.push(empty ? row + empty : row);
  }
  const ep = pos.enPassant === null ? '-' : squareName(pos.enPassant);
  return `${rows.join('/')} ${pos.turn} ${pos.castling || '-'} ${ep} ${pos.halfmove} ${pos.fullmove}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Moves

const boardOf = (pos: Position): Board => new Board().load(pos);
const colourOf = (side: Side): number => (side === 'w' ? WHITE : BLACK);

// The legal internal move matching `move`. A missing promotion means queen; a promotion given on a move that
// isn't one is ignored.
function findMove(legal: number[], move: Move): number {
  const from = to88(move.from);
  const to = to88(move.to);
  const wanted = move.promotion ? KIND_CHARS.indexOf(move.promotion) : QUEEN;
  for (const m of legal) {
    if (moveFrom(m) !== from || moveTo(m) !== to) continue;
    const promo = movePromo(m);
    if (!promo || promo === wanted) return m;
  }
  return -1;
}

export function legalMoves(pos: Position): Move[] {
  return boardOf(pos).legalMoves().map(toMove);
}

export function movesFrom(pos: Position, from: number): Move[] {
  const s = to88(from);
  return boardOf(pos).legalMoves().filter((m) => moveFrom(m) === s).map(toMove);
}

export function isLegal(pos: Position, move: Move): boolean {
  return findMove(boardOf(pos).legalMoves(), move) >= 0;
}

export function makeMove(pos: Position, move: Move): Position {
  const board = boardOf(pos);
  const from = to88(move.from);
  const to = to88(move.to);
  const piece = board.sq[from];
  if (!piece || (from & 0x88) !== 0 || (to & 0x88) !== 0) throw new Error(`No piece to move on square ${move.from}`);
  let m = from | (to << 7);
  const kind = piece & 7;
  if (kind === KING && Math.abs((to & 7) - (from & 7)) === 2) {
    m |= FLAG_CASTLE;
  } else if (kind === PAWN) {
    if (to === board.ep && (to & 7) !== (from & 7) && !board.sq[to]) m |= FLAG_EP;
    else if (Math.abs(to - from) === 32) m |= FLAG_DOUBLE;
    if (to >> 4 === 0 || to >> 4 === 7) {
      const promo = move.promotion ? 'nbrq'.indexOf(move.promotion) : -1;
      m |= (promo < 0 ? QUEEN : KIND_CHARS.indexOf(move.promotion as Kind)) << 14;
    }
  }
  board.make(m);
  return board.toPosition();
}

export function inCheck(pos: Position, side: Side = pos.turn): boolean {
  return boardOf(pos).kingAttacked(colourOf(side));
}

export function kingSquare(pos: Position, side: Side): number {
  return pos.board.findIndex((p) => p !== null && p.side === side && p.kind === 'k');
}

export function isAttacked(pos: Position, square: number, by: Side): boolean {
  return boardOf(pos).attacked(to88(square), colourOf(by));
}

export function perft(pos: Position, depth: number): number {
  if (depth <= 0) return 1;
  return boardOf(pos).perft(depth, new Int32Array(512 * depth), 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Outcomes

function insufficientMaterial(pos: Position): boolean {
  let minors = 0;
  let knights = 0;
  let bishopColours = 0; // bit 1: a bishop on a light square, bit 2: on a dark square
  for (let i = 0; i < 64; i++) {
    const p = pos.board[i];
    if (!p || p.kind === 'k') continue;
    if (p.kind === 'n') knights++;
    else if (p.kind === 'b') bishopColours |= ((i & 7) + (i >> 3)) & 1 ? 2 : 1;
    else return false; // any pawn, rook or queen can still mate
    minors++;
  }
  if (minors === 0) return true;
  if (knights === 1 && minors === 1) return true;
  // Any number of bishops, all on the same colour of square, can never mate.
  return knights === 0 && bishopColours !== 3;
}

const repetitionKey = (fen: string): string => fen.trim().split(/\s+/).slice(0, 4).join(' ');

export function outcome(pos: Position, history: string[] = []): Outcome {
  const board = boardOf(pos);
  if (!board.hasLegalMove()) {
    return board.inCheck() ? { kind: 'checkmate', winner: pos.turn === 'w' ? 'b' : 'w' } : { kind: 'stalemate' };
  }
  if (insufficientMaterial(pos)) return { kind: 'material' };
  if (pos.halfmove >= 100) return { kind: 'fifty' };
  if (history.length >= 2) {
    const key = repetitionKey(toFen(pos));
    // A move always changes the side to move, so a last entry equal to this position must be this position
    // itself (the caller included it); don't count it twice.
    const last = history.length - (repetitionKey(history[history.length - 1]) === key ? 1 : 0);
    let seen = 1;
    for (let i = 0; i < last; i++) if (repetitionKey(history[i]) === key) seen++;
    if (seen >= 3) return { kind: 'repetition' };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Standard algebraic notation

function sanOf(board: Board, m: number, legal: number[]): string {
  const from = moveFrom(m);
  const to = moveTo(m);
  const piece = board.sq[from];
  const kind = piece & 7;
  let text: string;
  if (m & FLAG_CASTLE) {
    text = to > from ? 'O-O' : 'O-O-O';
  } else {
    const capture = board.sq[to] !== 0 || (m & FLAG_EP) !== 0;
    if (kind === PAWN) {
      text = (capture ? FILES[from & 7] + 'x' : '') + name88(to);
      const promo = movePromo(m);
      if (promo) text += '=' + SAN_LETTERS[promo];
    } else {
      text = SAN_LETTERS[kind];
      let ambiguous = false;
      let sameFile = false;
      let sameRank = false;
      for (const o of legal) {
        const of = moveFrom(o);
        if (of === from || moveTo(o) !== to || board.sq[of] !== piece) continue;
        ambiguous = true;
        if ((of & 7) === (from & 7)) sameFile = true;
        if (of >> 4 === from >> 4) sameRank = true;
      }
      if (ambiguous) {
        const name = name88(from);
        text += !sameFile ? name[0] : !sameRank ? name[1] : name;
      }
      text += (capture ? 'x' : '') + name88(to);
    }
  }
  board.make(m);
  if (board.inCheck()) text += board.hasLegalMove() ? '+' : '#';
  board.unmake(m);
  return text;
}

export function san(pos: Position, move: Move): string {
  const board = boardOf(pos);
  const legal = board.legalMoves();
  const m = findMove(legal, move);
  if (m < 0) throw new Error(`Illegal move ${squareName(move.from)}${squareName(move.to)} in ${toFen(pos)}`);
  return sanOf(board, m, legal);
}

const SAN_RE = /^([PNBRQK])?([a-h])?([1-8])?[x:-]?([a-h][1-8])(?:=?\(?([NBRQ])\)?)?$/;

/**
 * Reads SAN leniently: check marks, annotations and 'e.p.' are ignored, captures need no 'x', castling may be
 * written with zeros, promotions may omit '=' (a missing promotion piece means queen), piece letters other than
 * 'b' may be lowercase, and coordinate moves such as 'e2e4' or 'e7e8q' work too. Returns null when the text
 * matches no legal move or more than one.
 */
export function fromSan(pos: Position, text: string): Move | null {
  const board = boardOf(pos);
  const legal = board.legalMoves();
  let t = text.replace(/\s+/g, '').replace(/[+#!?]/g, '').replace(/e\.?p\.?$/i, '');

  const castle = /^([O0o])-?\1(-?\1)?$/.exec(t);
  if (castle) {
    const kingSide = !castle[2];
    const m = legal.find((x) => (x & FLAG_CASTLE) !== 0 && moveTo(x) > moveFrom(x) === kingSide);
    return m === undefined ? null : toMove(m);
  }

  // A lowercase piece letter is read as a piece, except 'b', which is a file unless nothing else fits.
  if (/^[nrqk]/.test(t)) t = t[0].toUpperCase() + t.slice(1);
  // Lowercase promotion pieces ('e8q') are fine too.
  t = t.replace(/([a-h][18]=?\(?)([nbrq])(\)?)$/, (_, head: string, p: string, end: string) =>
    head + p.toUpperCase() + end);
  const found = matchSan(board, legal, t);
  if (found === null && t[0] === 'b') return matchSan(board, legal, 'B' + t.slice(1));
  return found;
}

function matchSan(board: Board, legal: number[], t: string): Move | null {
  const parts = SAN_RE.exec(t);
  if (!parts) return null;
  const [, letter, file, rank, target, promoLetter] = parts;
  const to = to88(squareIndex(target));
  const kind = !letter ? 0 : letter === 'P' ? PAWN : SAN_LETTERS.indexOf(letter);
  const promo = promoLetter ? SAN_LETTERS.indexOf(promoLetter) : 0;
  const matches = legal.filter((m) => {
    const from = moveFrom(m);
    if (moveTo(m) !== to) return false;
    const pieceKind = board.sq[from] & 7;
    // With no piece letter it is a pawn move, unless a full from-square was given (coordinate notation).
    if (kind ? pieceKind !== kind : !(file && rank) && pieceKind !== PAWN) return false;
    if (file && FILES[from & 7] !== file) return false;
    if (rank && String(8 - (from >> 4)) !== rank) return false;
    const mp = movePromo(m);
    return mp ? mp === (promo || QUEEN) : !promo;
  });
  return matches.length === 1 ? toMove(matches[0]) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Material

export function material(pos: Position): { w: number; b: number } {
  const total = { w: 0, b: 0 };
  for (const p of pos.board) if (p) total[p.side] += VALUES[p.kind];
  return total;
}

/**
 * Pieces each side has lost, compared with the starting set, sorted q r b n p. Extra pieces beyond the starting
 * count must have come from promotions, so each one is taken to account for a missing pawn that was not captured.
 */
export function captured(pos: Position): { w: Kind[]; b: Kind[] } {
  const result: { w: Kind[]; b: Kind[] } = { w: [], b: [] };
  for (const side of ['w', 'b'] as const) {
    const count: Record<Kind, number> = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
    for (const p of pos.board) if (p && p.side === side) count[p.kind]++;
    let promoted = 0;
    for (const kind of ['q', 'r', 'b', 'n'] as const) promoted += Math.max(0, count[kind] - START_COUNT[kind]);
    for (const kind of CAPTURE_ORDER) {
      const have = kind === 'p' ? count.p + promoted : count[kind];
      for (let i = have; i < START_COUNT[kind]; i++) result[side].push(kind);
    }
  }
  return result;
}
