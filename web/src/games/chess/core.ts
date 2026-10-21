// Internal make/unmake engine shared by rules.ts and ai.ts. It is not part of the public API: the UI only ever sees
// the immutable Position objects from rules.ts. Squares here are 0x88 indices (row 0 = rank 8, as in FEN order), so
// "has this ray left the board?" is a single bit test: (square & 0x88) !== 0.

import type { Kind, Move, Piece, Position } from './rules';

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
// Colour bit of a piece code: white pieces are 1..6, black pieces 9..14, empty squares 0.
export const WHITE = 0;
export const BLACK = 8;

const CASTLE_WK = 1;
const CASTLE_WQ = 2;
const CASTLE_BK = 4;
const CASTLE_BQ = 8;

// A move is one int: from | to << 7 | promotion kind << 14 | flags.
export const FLAG_EP = 1 << 17;
export const FLAG_CASTLE = 1 << 18;
export const FLAG_DOUBLE = 1 << 19;

export const KIND_CHARS = ' pnbrqk';

const KNIGHT_D = [-33, -31, -18, -14, 14, 18, 31, 33];
const KING_D = [-17, -16, -15, -1, 1, 15, 16, 17];
const DIAG_D = [-17, -15, 15, 17];
const ORTH_D = [-16, -1, 1, 16];

// Castling rights that survive a move touching each square: a king or rook leaving home, or a rook captured at home.
const CASTLE_KEEP = new Int8Array(128).fill(15);
CASTLE_KEEP[0x00] = 15 & ~CASTLE_BQ;
CASTLE_KEEP[0x07] = 15 & ~CASTLE_BK;
CASTLE_KEEP[0x04] = 15 & ~(CASTLE_BK | CASTLE_BQ);
CASTLE_KEEP[0x70] = 15 & ~CASTLE_WQ;
CASTLE_KEEP[0x77] = 15 & ~CASTLE_WK;
CASTLE_KEEP[0x74] = 15 & ~(CASTLE_WK | CASTLE_WQ);

export const to88 = (i: number): number => ((i >> 3) << 4) | (i & 7);
export const from88 = (s: number): number => ((s >> 4) << 3) | (s & 7);
export const moveFrom = (m: number): number => m & 127;
export const moveTo = (m: number): number => (m >> 7) & 127;
export const movePromo = (m: number): number => (m >> 14) & 7;

export function toMove(m: number): Move {
  const move: Move = { from: from88(m & 127), to: from88((m >> 7) & 127) };
  const promo = (m >> 14) & 7;
  if (promo) move.promotion = KIND_CHARS[promo] as Kind;
  return move;
}

export class Board {
  readonly sq = new Int8Array(128);
  turn = WHITE;
  castling = 0;
  ep = -1; // 0x88 en passant target, or -1
  halfmove = 0;
  fullmove = 1;
  readonly kings = new Int16Array([-1, -1]); // king squares, indexed by colour >> 3
  private readonly undo = new Int32Array(1024);
  private sp = 0;
  private scratch: Int32Array | null = null;

  load(pos: Position): this {
    const sq = this.sq;
    sq.fill(0);
    this.kings[0] = this.kings[1] = -1;
    for (let i = 0; i < 64; i++) {
      const p = pos.board[i];
      if (!p) continue;
      const s = to88(i);
      const colour = p.side === 'w' ? WHITE : BLACK;
      sq[s] = colour | KIND_CHARS.indexOf(p.kind);
      if (p.kind === 'k') this.kings[colour >> 3] = s;
    }
    this.turn = pos.turn === 'w' ? WHITE : BLACK;
    const c = pos.castling;
    this.castling =
      (c.includes('K') ? CASTLE_WK : 0) | (c.includes('Q') ? CASTLE_WQ : 0) |
      (c.includes('k') ? CASTLE_BK : 0) | (c.includes('q') ? CASTLE_BQ : 0);
    this.ep = pos.enPassant === null ? -1 : to88(pos.enPassant);
    this.halfmove = pos.halfmove;
    this.fullmove = pos.fullmove;
    this.sp = 0;
    return this;
  }

  toPosition(): Position {
    const board: (Piece | null)[] = [];
    for (let i = 0; i < 64; i++) {
      const p = this.sq[to88(i)];
      board.push(p ? { side: p & BLACK ? 'b' : 'w', kind: KIND_CHARS[p & 7] as Kind } : null);
    }
    const c = this.castling;
    const castling =
      (c & CASTLE_WK ? 'K' : '') + (c & CASTLE_WQ ? 'Q' : '') + (c & CASTLE_BK ? 'k' : '') + (c & CASTLE_BQ ? 'q' : '');
    return {
      board,
      turn: this.turn === WHITE ? 'w' : 'b',
      castling,
      enPassant: this.ep < 0 ? null : from88(this.ep),
      halfmove: this.halfmove,
      fullmove: this.fullmove,
    };
  }

  attacked(s: number, by: number): boolean {
    const sq = this.sq;
    // A white pawn attacks diagonally upwards (towards row 0), so it attacks s from s + 15 or s + 17.
    if (by === WHITE) {
      if (!((s + 15) & 0x88) && sq[s + 15] === PAWN) return true;
      if (!((s + 17) & 0x88) && sq[s + 17] === PAWN) return true;
    } else {
      if (!((s - 15) & 0x88) && sq[s - 15] === (BLACK | PAWN)) return true;
      if (!((s - 17) & 0x88) && sq[s - 17] === (BLACK | PAWN)) return true;
    }
    const knight = by | KNIGHT;
    for (let i = 0; i < 8; i++) {
      const t = s + KNIGHT_D[i];
      if (!(t & 0x88) && sq[t] === knight) return true;
    }
    const king = by | KING;
    for (let i = 0; i < 8; i++) {
      const t = s + KING_D[i];
      if (!(t & 0x88) && sq[t] === king) return true;
    }
    const queen = by | QUEEN;
    const bishop = by | BISHOP;
    for (let i = 0; i < 4; i++) {
      const d = DIAG_D[i];
      for (let t = s + d; !(t & 0x88); t += d) {
        const p = sq[t];
        if (p) {
          if (p === bishop || p === queen) return true;
          break;
        }
      }
    }
    const rook = by | ROOK;
    for (let i = 0; i < 4; i++) {
      const d = ORTH_D[i];
      for (let t = s + d; !(t & 0x88); t += d) {
        const p = sq[t];
        if (p) {
          if (p === rook || p === queen) return true;
          break;
        }
      }
    }
    return false;
  }

  /** Is `side`'s king attacked? A board with no king for that side is never in check. */
  kingAttacked(side: number): boolean {
    const k = this.kings[side >> 3];
    return k >= 0 && this.attacked(k, side ^ BLACK);
  }

  inCheck(): boolean {
    return this.kingAttacked(this.turn);
  }

  /**
   * Writes pseudo-legal moves for the side to move into out[n..] and returns the new end. With quiets = false only
   * captures and queen promotions are produced (for quiescence search).
   */
  generate(out: Int32Array, n: number, quiets: boolean): number {
    const sq = this.sq;
    const us = this.turn;
    for (let s = 0; s < 128; s++) {
      if (s & 8) {
        s += 7;
        continue;
      }
      const p = sq[s];
      if (!p || (p & BLACK) !== us) continue;
      switch (p & 7) {
        case PAWN:
          n = this.pawnMoves(out, n, s, quiets);
          break;
        case KNIGHT:
          n = this.stepMoves(out, n, s, KNIGHT_D, quiets);
          break;
        case BISHOP:
          n = this.slideMoves(out, n, s, DIAG_D, quiets);
          break;
        case ROOK:
          n = this.slideMoves(out, n, s, ORTH_D, quiets);
          break;
        case QUEEN:
          n = this.slideMoves(out, n, s, KING_D, quiets);
          break;
        case KING:
          n = this.stepMoves(out, n, s, KING_D, quiets);
          if (quiets && this.castling) n = this.castleMoves(out, n, s);
          break;
      }
    }
    return n;
  }

  private pawnMoves(out: Int32Array, n: number, s: number, quiets: boolean): number {
    const sq = this.sq;
    const us = this.turn;
    const dir = us === WHITE ? -16 : 16;
    const lastRow = us === WHITE ? 0 : 7;
    const t = s + dir;
    if (!(t & 0x88) && !sq[t]) {
      if (t >> 4 === lastRow) n = addPromotions(out, n, s, t, quiets);
      else if (quiets) {
        out[n++] = s | (t << 7);
        if (s >> 4 === (us === WHITE ? 6 : 1) && !sq[t + dir]) out[n++] = s | ((t + dir) << 7) | FLAG_DOUBLE;
      }
    }
    for (let side = -1; side <= 1; side += 2) {
      const c = t + side;
      if (c & 0x88) continue;
      const q = sq[c];
      if (q) {
        if ((q & BLACK) === us) continue;
        if (c >> 4 === lastRow) n = addPromotions(out, n, s, c, quiets);
        else out[n++] = s | (c << 7);
      } else if (c === this.ep && sq[c - dir] === ((us ^ BLACK) | PAWN)) {
        // Whether this capture exposes our king (the pawn pair leaving a rank) is caught by the legality test.
        out[n++] = s | (c << 7) | FLAG_EP;
      }
    }
    return n;
  }

  private stepMoves(out: Int32Array, n: number, s: number, dirs: number[], quiets: boolean): number {
    const sq = this.sq;
    const us = this.turn;
    for (let i = 0; i < dirs.length; i++) {
      const t = s + dirs[i];
      if (t & 0x88) continue;
      const q = sq[t];
      if (q ? (q & BLACK) !== us : quiets) out[n++] = s | (t << 7);
    }
    return n;
  }

  private slideMoves(out: Int32Array, n: number, s: number, dirs: number[], quiets: boolean): number {
    const sq = this.sq;
    const us = this.turn;
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      for (let t = s + d; !(t & 0x88); t += d) {
        const q = sq[t];
        if (!q) {
          if (quiets) out[n++] = s | (t << 7);
          continue;
        }
        if ((q & BLACK) !== us) out[n++] = s | (t << 7);
        break;
      }
    }
    return n;
  }

  // The king may not castle out of or through check. Landing in check is caught by the normal legality test.
  private castleMoves(out: Int32Array, n: number, s: number): number {
    const sq = this.sq;
    const us = this.turn;
    const them = us ^ BLACK;
    const home = us === WHITE ? 0x74 : 0x04;
    if (s !== home) return n;
    const kingSide = us === WHITE ? CASTLE_WK : CASTLE_BK;
    const queenSide = us === WHITE ? CASTLE_WQ : CASTLE_BQ;
    const rook = us | ROOK;
    if (
      (this.castling & kingSide) && !sq[s + 1] && !sq[s + 2] && sq[s + 3] === rook &&
      !this.attacked(s, them) && !this.attacked(s + 1, them)
    ) {
      out[n++] = s | ((s + 2) << 7) | FLAG_CASTLE;
    }
    // Queen side: b1/b8 must be empty but may be attacked, since the king never crosses it.
    if (
      (this.castling & queenSide) && !sq[s - 1] && !sq[s - 2] && !sq[s - 3] && sq[s - 4] === rook &&
      !this.attacked(s, them) && !this.attacked(s - 1, them)
    ) {
      out[n++] = s | ((s - 2) << 7) | FLAG_CASTLE;
    }
    return n;
  }

  make(m: number): void {
    const sq = this.sq;
    const from = m & 127;
    const to = (m >> 7) & 127;
    const us = this.turn;
    const piece = sq[from];
    const captured = sq[to];
    this.undo[this.sp++] = captured | (this.castling << 8) | ((this.ep + 1) << 12);
    this.undo[this.sp++] = this.halfmove;
    sq[to] = piece;
    sq[from] = 0;
    this.ep = -1;
    if (m & FLAG_EP) {
      sq[us === WHITE ? to + 16 : to - 16] = 0;
    } else if (m & FLAG_CASTLE) {
      if (to > from) {
        sq[from + 1] = sq[from + 3];
        sq[from + 3] = 0;
      } else {
        sq[from - 1] = sq[from - 4];
        sq[from - 4] = 0;
      }
    }
    const promo = (m >> 14) & 7;
    if (promo) sq[to] = us | promo;
    const kind = piece & 7;
    if (kind === KING) {
      this.kings[us >> 3] = to;
    } else if (m & FLAG_DOUBLE) {
      // Only record an en passant square when an enemy pawn stands ready to take, so that positions which are
      // otherwise identical compare equal for threefold repetition.
      const enemyPawn = (us ^ BLACK) | PAWN;
      if ((!((to - 1) & 0x88) && sq[to - 1] === enemyPawn) || (!((to + 1) & 0x88) && sq[to + 1] === enemyPawn)) {
        this.ep = (from + to) >> 1;
      }
    }
    this.castling &= CASTLE_KEEP[from] & CASTLE_KEEP[to];
    this.halfmove = kind === PAWN || captured ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.turn = us ^ BLACK;
  }

  unmake(m: number): void {
    const sq = this.sq;
    const from = m & 127;
    const to = (m >> 7) & 127;
    const them = this.turn;
    const us = them ^ BLACK;
    this.turn = us;
    if (us === BLACK) this.fullmove--;
    this.halfmove = this.undo[--this.sp];
    const info = this.undo[--this.sp];
    this.castling = (info >> 8) & 15;
    this.ep = ((info >> 12) & 255) - 1;
    const piece = (m >> 14) & 7 ? us | PAWN : sq[to];
    sq[from] = piece;
    sq[to] = info & 255;
    if (m & FLAG_EP) {
      sq[us === WHITE ? to + 16 : to - 16] = them | PAWN;
    } else if (m & FLAG_CASTLE) {
      if (to > from) {
        sq[from + 3] = sq[from + 1];
        sq[from + 1] = 0;
      } else {
        sq[from - 4] = sq[from - 1];
        sq[from - 1] = 0;
      }
    }
    if ((piece & 7) === KING) this.kings[us >> 3] = from;
  }

  /** Makes m if it is legal and returns true; otherwise leaves the board unchanged and returns false. */
  tryMake(m: number): boolean {
    const us = this.turn;
    this.make(m);
    if (this.kingAttacked(us)) {
      this.unmake(m);
      return false;
    }
    return true;
  }

  private buffer(): Int32Array {
    return (this.scratch ??= new Int32Array(512));
  }

  legalMoves(): number[] {
    const buf = this.buffer();
    const end = this.generate(buf, 0, true);
    const moves: number[] = [];
    for (let i = 0; i < end; i++) {
      const m = buf[i];
      if (this.tryMake(m)) {
        this.unmake(m);
        moves.push(m);
      }
    }
    return moves;
  }

  hasLegalMove(): boolean {
    const buf = this.buffer();
    const end = this.generate(buf, 0, true);
    for (let i = 0; i < end; i++) {
      if (this.tryMake(buf[i])) {
        this.unmake(buf[i]);
        return true;
      }
    }
    return false;
  }

  /** Leaf count to `depth` plies. `buf` holds every ply's move list back to back, starting at `base`. */
  perft(depth: number, buf: Int32Array, base: number): number {
    const end = this.generate(buf, base, true);
    let total = 0;
    for (let i = base; i < end; i++) {
      const m = buf[i];
      if (!this.tryMake(m)) continue;
      total += depth > 1 ? this.perft(depth - 1, buf, end) : 1;
      this.unmake(m);
    }
    return total;
  }
}

function addPromotions(out: Int32Array, n: number, from: number, to: number, all: boolean): number {
  const base = from | (to << 7);
  out[n++] = base | (QUEEN << 14);
  if (all) {
    out[n++] = base | (ROOK << 14);
    out[n++] = base | (BISHOP << 14);
    out[n++] = base | (KNIGHT << 14);
  }
  return n;
}
