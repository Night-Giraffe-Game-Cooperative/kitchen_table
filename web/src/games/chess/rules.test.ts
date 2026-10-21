import { describe, expect, it } from 'vitest';
import {
  START_FEN, captured, fileOf, fromSan, inCheck, isAttacked, isLegal, kingSquare, legalMoves, makeMove, material,
  movesFrom, outcome, parseFen, perft, rankOf, san, squareIndex, squareName, toFen,
} from './rules';
import type { Move, Position } from './rules';

const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const sq = squareIndex;
const mv = (from: string, to: string, promotion?: Move['promotion']): Move =>
  promotion ? { from: sq(from), to: sq(to), promotion } : { from: sq(from), to: sq(to) };

/** Plays SAN moves from a FEN, returning every position along the way (the first is the starting one). */
function play(fen: string, moves: string): Position[] {
  const line = [parseFen(fen)];
  for (const text of moves.split(/\s+/).filter(Boolean)) {
    const pos = line[line.length - 1];
    const move = fromSan(pos, text);
    if (!move) throw new Error(`Could not read '${text}' in ${toFen(pos)}`);
    line.push(makeMove(pos, move));
  }
  return line;
}
const last = <T>(xs: T[]): T => xs[xs.length - 1];

describe('perft', () => {
  const cases: [string, string, number[]][] = [
    ['start position', START_FEN, [20, 400, 8902, 197281]],
    ['Kiwipete', KIWIPETE, [48, 2039, 97862]],
    ['position 3 (en passant pins, rook endgame)', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['position 4 (promotions)', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ];
  for (const [name, fen, counts] of cases) {
    it(name, () => {
      const pos = parseFen(fen);
      counts.forEach((count, i) => expect(perft(pos, i + 1), `depth ${i + 1}`).toBe(count));
    });
  }

  it('depth 0 is one node', () => {
    expect(perft(parseFen(START_FEN), 0)).toBe(1);
  });
});

describe('squares', () => {
  it('names and indexes squares in FEN order', () => {
    expect(squareName(0)).toBe('a8');
    expect(squareName(7)).toBe('h8');
    expect(squareName(52)).toBe('e2');
    expect(squareName(63)).toBe('h1');
    expect(sq('e2')).toBe(52);
    expect(sq('a1')).toBe(56);
    expect(fileOf(52)).toBe(4);
    expect(rankOf(52)).toBe(2);
    expect(rankOf(0)).toBe(8);
    for (let i = 0; i < 64; i++) expect(sq(squareName(i))).toBe(i);
  });

  it('rejects bad squares', () => {
    expect(() => squareName(64)).toThrow();
    expect(() => squareName(-1)).toThrow();
    expect(() => sq('i9')).toThrow();
  });
});

describe('FEN', () => {
  it('parses the start position', () => {
    const pos = parseFen(START_FEN);
    expect(pos.board).toHaveLength(64);
    expect(pos.board[0]).toEqual({ side: 'b', kind: 'r' });
    expect(pos.board[4]).toEqual({ side: 'b', kind: 'k' });
    expect(pos.board[60]).toEqual({ side: 'w', kind: 'k' });
    expect(pos.board[35]).toBeNull();
    expect(pos).toMatchObject({ turn: 'w', castling: 'KQkq', enPassant: null, halfmove: 0, fullmove: 1 });
  });

  it('round trips', () => {
    for (const fen of [
      START_FEN,
      KIWIPETE,
      '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
      'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
      'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
      'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3',
      '4k3/8/8/8/8/8/8/4K3 b - - 99 120',
    ]) {
      expect(toFen(parseFen(fen))).toBe(fen);
    }
  });

  it('positions survive JSON', () => {
    const pos = parseFen(KIWIPETE);
    expect(JSON.parse(JSON.stringify(pos))).toEqual(pos);
  });

  it('fills in missing move counters', () => {
    expect(toFen(parseFen('4k3/8/8/8/8/8/8/4K3 w - -'))).toBe('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  });

  it('throws on malformed FEN', () => {
    for (const bad of [
      '',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1', // 7 ranks
      'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', // too wide
      'rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', // too narrow
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1', // side to move
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkx - 0 1', // castling
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e4 0 1', // en passant rank
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e3 0 1', // en passant rank for side to move
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - a 1', // clock
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQXBNR w KQkq - 0 1', // piece letter
      'rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1', // no black king
      'Pnbqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNBQKBNR w KQk - 0 1', // pawn on the last rank
    ]) {
      expect(() => parseFen(bad), bad).toThrow();
    }
  });
});

describe('moves', () => {
  it('lists moves from a square', () => {
    const pos = parseFen(START_FEN);
    expect(movesFrom(pos, sq('e2')).map((m) => squareName(m.to)).sort()).toEqual(['e3', 'e4']);
    expect(movesFrom(pos, sq('g1')).map((m) => squareName(m.to)).sort()).toEqual(['f3', 'h3']);
    expect(movesFrom(pos, sq('e1'))).toEqual([]);
    expect(movesFrom(pos, sq('e7'))).toEqual([]); // not black's turn
  });

  it('never mutates the position it is given', () => {
    const pos = parseFen(KIWIPETE);
    const before = JSON.stringify(pos);
    for (const move of legalMoves(pos)) {
      const next = makeMove(pos, move);
      san(pos, move);
      expect(next).not.toBe(pos);
      expect(next.board).not.toBe(pos.board);
    }
    outcome(pos);
    perft(pos, 2);
    expect(JSON.stringify(pos)).toBe(before);
  });

  it('expands promotions to q, r, b, n and defaults makeMove to a queen', () => {
    const pos = parseFen('8/4P3/8/8/8/8/k7/4K3 w - - 0 1');
    const promotions = movesFrom(pos, sq('e7'));
    expect(promotions.map((m) => m.promotion)).toEqual(['q', 'r', 'b', 'n']);
    expect(makeMove(pos, mv('e7', 'e8')).board[sq('e8')]).toEqual({ side: 'w', kind: 'q' });
    expect(makeMove(pos, mv('e7', 'e8', 'n')).board[sq('e8')]).toEqual({ side: 'w', kind: 'n' });
    expect(isLegal(pos, mv('e7', 'e8'))).toBe(true);
    expect(isLegal(pos, mv('e7', 'e8', 'k'))).toBe(false);
  });

  it('does not let the king castle out of, through or into check', () => {
    const base = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(isLegal(parseFen(base), mv('e1', 'g1'))).toBe(true);
    expect(isLegal(parseFen(base), mv('e1', 'c1'))).toBe(true);
    // out of check
    expect(isLegal(parseFen('r3k2r/8/8/8/4r3/8/8/R3K2R w KQkq - 0 1'), mv('e1', 'g1'))).toBe(false);
    // through check (f1 attacked)
    expect(isLegal(parseFen('r3k2r/8/8/8/5r2/8/8/R3K2R w KQkq - 0 1'), mv('e1', 'g1'))).toBe(false);
    // into check (g1 attacked)
    expect(isLegal(parseFen('r3k2r/8/8/8/6r1/8/8/R3K2R w KQkq - 0 1'), mv('e1', 'g1'))).toBe(false);
    // b1 attacked does not stop queen-side castling; d1 attacked does
    expect(isLegal(parseFen('r3k2r/8/8/8/1r6/8/8/R3K2R w KQkq - 0 1'), mv('e1', 'c1'))).toBe(true);
    expect(isLegal(parseFen('r3k2r/8/8/8/3r4/8/8/R3K2R w KQkq - 0 1'), mv('e1', 'c1'))).toBe(false);
    // pieces in the way
    expect(isLegal(parseFen('r3k2r/8/8/8/8/8/8/R2QK2R w KQkq - 0 1'), mv('e1', 'c1'))).toBe(false);
    // no right
    expect(isLegal(parseFen('r3k2r/8/8/8/8/8/8/R3K2R w Qkq - 0 1'), mv('e1', 'g1'))).toBe(false);
  });

  it('moves the rook when castling and updates rights', () => {
    const pos = makeMove(parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), mv('e1', 'g1'));
    expect(toFen(pos)).toBe('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');
    const long = makeMove(pos, mv('e8', 'c8'));
    expect(toFen(long)).toBe('2kr3r/8/8/8/8/8/8/R4RK1 w - - 2 2');
  });

  it('removes castling rights when a rook moves or is captured', () => {
    const pos = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(makeMove(pos, mv('h1', 'h2')).castling).toBe('Qkq');
    expect(makeMove(pos, mv('a1', 'a8')).castling).toBe('Kk'); // takes the a8 rook too
  });

  it('handles en passant, including the pinned case', () => {
    const pos = parseFen('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
    const after = makeMove(pos, mv('e5', 'f6'));
    expect(after.board[sq('f5')]).toBeNull();
    expect(after.board[sq('f6')]).toEqual({ side: 'w', kind: 'p' });
    expect(toFen(after)).toBe('rnbqkbnr/ppp1p1pp/5P2/3p4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3');
    // Taking en passant would take both pawns off the fifth rank and expose the king to the rook.
    const pinned = parseFen('8/8/8/KPp4r/8/8/8/7k w - c6 0 1');
    expect(isLegal(pinned, mv('b5', 'c6'))).toBe(false);
    expect(isLegal(parseFen('8/8/8/1Pp4r/K7/8/8/7k w - c6 0 1'), mv('b5', 'c6'))).toBe(true);
  });

  it('only records an en passant square when a capture is possible', () => {
    const start = parseFen(START_FEN);
    expect(makeMove(start, mv('e2', 'e4')).enPassant).toBeNull();
    const pos = parseFen('rnbqkbnr/ppp1pppp/8/8/3p4/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3');
    const after = makeMove(pos, mv('e2', 'e4'));
    expect(after.enPassant).toBe(sq('e3'));
    expect(toFen(after)).toBe('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3');
  });

  it('keeps the clocks', () => {
    let pos = parseFen(START_FEN);
    pos = makeMove(pos, mv('g1', 'f3'));
    expect([pos.halfmove, pos.fullmove]).toEqual([1, 1]);
    pos = makeMove(pos, mv('g8', 'f6'));
    expect([pos.halfmove, pos.fullmove]).toEqual([2, 2]);
    pos = makeMove(pos, mv('e2', 'e4'));
    expect([pos.halfmove, pos.fullmove]).toEqual([0, 2]);
    pos = makeMove(pos, mv('f6', 'e4'));
    expect([pos.halfmove, pos.fullmove]).toEqual([0, 3]);
  });

  it('throws when there is nothing to move', () => {
    expect(() => makeMove(parseFen(START_FEN), mv('e4', 'e5'))).toThrow();
  });
});

describe('check and attacks', () => {
  it('finds kings, checks and attacked squares', () => {
    const pos = parseFen(START_FEN);
    expect(kingSquare(pos, 'w')).toBe(sq('e1'));
    expect(kingSquare(pos, 'b')).toBe(sq('e8'));
    expect(inCheck(pos)).toBe(false);
    expect(isAttacked(pos, sq('f3'), 'w')).toBe(true);
    expect(isAttacked(pos, sq('e4'), 'w')).toBe(false);
    expect(isAttacked(pos, sq('f6'), 'b')).toBe(true);
    const checked = parseFen('4k3/8/8/8/8/8/8/R3K2r w - - 0 1');
    expect(inCheck(checked)).toBe(true);
    expect(inCheck(checked, 'w')).toBe(true);
    expect(inCheck(checked, 'b')).toBe(false);
  });
});

describe('SAN', () => {
  it('writes castling', () => {
    const pos = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(san(pos, mv('e1', 'g1'))).toBe('O-O');
    expect(san(pos, mv('e1', 'c1'))).toBe('O-O-O');
  });

  it('writes promotions with check and mate', () => {
    const pos = parseFen('k7/4P3/8/8/8/8/8/4K3 w - - 0 1');
    expect(san(pos, mv('e7', 'e8', 'q'))).toBe('e8=Q+');
    expect(san(pos, mv('e7', 'e8', 'r'))).toBe('e8=R+');
    expect(san(pos, mv('e7', 'e8', 'n'))).toBe('e8=N');
    const mate = parseFen('k7/4P3/1K6/8/8/8/8/8 w - - 0 1');
    expect(san(mate, mv('e7', 'e8', 'q'))).toBe('e8=Q#');
    const capture = parseFen('3r2k1/4P3/8/8/8/8/8/4K3 w - - 0 1');
    expect(san(capture, mv('e7', 'd8', 'q'))).toBe('exd8=Q+');
  });

  it('disambiguates by file, rank and square', () => {
    const knights = parseFen('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1');
    expect(san(knights, mv('b1', 'd2'))).toBe('Nbd2');
    expect(san(knights, mv('f1', 'd2'))).toBe('Nfd2');
    expect(san(knights, mv('f1', 'g3'))).toBe('Ng3');
    const rooks = parseFen('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1');
    expect(san(rooks, mv('a1', 'a3'))).toBe('R1a3');
    expect(san(rooks, mv('a5', 'a3'))).toBe('R5a3');
    const queens = parseFen('2k5/8/8/8/4Q2Q/8/K7/7Q w - - 0 1');
    expect(san(queens, mv('h4', 'e1'))).toBe('Qh4e1');
    expect(san(queens, mv('h1', 'e1'))).toBe('Q1e1');
    expect(san(queens, mv('e4', 'e1'))).toBe('Qee1');
    // A pinned knight does not count as a second candidate.
    const pinned = parseFen('4k3/4r3/8/8/8/8/4N3/1N2K3 w - - 0 1');
    expect(san(pinned, mv('b1', 'c3'))).toBe('Nc3');
  });

  it('writes pawn captures and en passant', () => {
    const pos = parseFen('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
    expect(san(pos, mv('e5', 'f6'))).toBe('exf6');
    expect(san(pos, mv('e5', 'e6'))).toBe('e6');
    expect(fromSan(pos, 'exf6')).toEqual(mv('e5', 'f6'));
    expect(fromSan(pos, 'exf6 e.p.')).toEqual(mv('e5', 'f6'));
    expect(fromSan(pos, 'exf6e.p.+')).toEqual(mv('e5', 'f6'));
  });

  it('throws for an illegal move', () => {
    expect(() => san(parseFen(START_FEN), mv('e2', 'e5'))).toThrow();
  });

  it('round trips a whole game (Morphy, the Opera Game)', () => {
    const game =
      'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 ' +
      'Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#';
    const tokens = game.split(' ');
    const line = play(START_FEN, game);
    tokens.forEach((token, i) => {
      const move = fromSan(line[i], token);
      expect(move).not.toBeNull();
      expect(san(line[i], move as Move)).toBe(token);
    });
    expect(outcome(last(line))).toEqual({ kind: 'checkmate', winner: 'w' });
    expect(toFen(last(line))).toBe('1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17');
  });

  it('reads SAN leniently', () => {
    const start = parseFen(START_FEN);
    expect(fromSan(start, 'e4')).toEqual(mv('e2', 'e4'));
    expect(fromSan(start, 'e2e4')).toEqual(mv('e2', 'e4'));
    expect(fromSan(start, 'e2-e4')).toEqual(mv('e2', 'e4'));
    expect(fromSan(start, 'Ng1-f3')).toEqual(mv('g1', 'f3'));
    expect(fromSan(start, 'g1f3')).toEqual(mv('g1', 'f3'));
    expect(fromSan(start, 'nf3')).toEqual(mv('g1', 'f3'));
    expect(fromSan(start, 'Nf3!?')).toEqual(mv('g1', 'f3'));
    expect(fromSan(start, 'e5')).toBeNull();
    expect(fromSan(start, 'Nd2')).toBeNull();
    expect(fromSan(start, 'hello')).toBeNull();
    const castle = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(fromSan(castle, '0-0')).toEqual(mv('e1', 'g1'));
    expect(fromSan(castle, 'O-O-O+')).toEqual(mv('e1', 'c1'));
    expect(fromSan(castle, 'e1g1')).toEqual(mv('e1', 'g1'));
    const promo = parseFen('k7/4P3/8/8/8/8/8/4K3 w - - 0 1');
    expect(fromSan(promo, 'e8=Q+')).toEqual(mv('e7', 'e8', 'q'));
    expect(fromSan(promo, 'e8N')).toEqual(mv('e7', 'e8', 'n'));
    expect(fromSan(promo, 'e7e8r')).toEqual(mv('e7', 'e8', 'r'));
    expect(fromSan(promo, 'e8')).toEqual(mv('e7', 'e8', 'q'));
    const knights = parseFen('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1');
    expect(fromSan(knights, 'Nd2')).toBeNull(); // ambiguous
    expect(fromSan(knights, 'Nbd2')).toEqual(mv('b1', 'd2'));
    const bishop = parseFen('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1');
    expect(fromSan(bishop, 'bd2')).toEqual(mv('c1', 'd2')); // no b-pawn, so 'b' must mean the bishop
  });
});

describe('outcome', () => {
  it("fool's mate is checkmate for black", () => {
    const line = play(START_FEN, 'f3 e5 g4 Qh4#');
    expect(outcome(last(line))).toEqual({ kind: 'checkmate', winner: 'b' });
    expect(inCheck(last(line))).toBe(true);
    expect(legalMoves(last(line))).toEqual([]);
  });

  it('knows stalemate', () => {
    const pos = parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(outcome(pos)).toEqual({ kind: 'stalemate' });
    expect(inCheck(pos)).toBe(false);
  });

  it('knows insufficient material', () => {
    expect(outcome(parseFen('8/8/8/4k3/8/8/8/4K3 w - - 0 1'))).toEqual({ kind: 'material' });
    expect(outcome(parseFen('8/8/8/4k3/8/8/8/2B1K3 w - - 0 1'))).toEqual({ kind: 'material' });
    expect(outcome(parseFen('8/8/8/4k3/8/8/8/1N2K3 b - - 0 1'))).toEqual({ kind: 'material' });
    // bishops on the same colour (c1 and f8 are both dark)
    expect(outcome(parseFen('5b2/8/8/4k3/8/8/8/2B1K3 w - - 0 1'))).toEqual({ kind: 'material' });
    // bishops on opposite colours, two knights, a pawn, a rook: play on
    expect(outcome(parseFen('2b5/8/8/4k3/8/8/8/2B1K3 w - - 0 1'))).toBeNull();
    expect(outcome(parseFen('8/8/8/4k3/8/8/8/1N2KN2 w - - 0 1'))).toBeNull();
    expect(outcome(parseFen('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1'))).toBeNull();
    expect(outcome(parseFen('8/8/8/4k3/8/8/8/R3K3 w - - 0 1'))).toBeNull();
    expect(outcome(parseFen('8/8/8/4k3/8/8/8/1NB1K3 w - - 0 1'))).toBeNull();
  });

  it('knows the fifty-move rule', () => {
    expect(outcome(parseFen('8/8/8/4k3/8/8/8/R3K3 w - - 100 80'))).toEqual({ kind: 'fifty' });
    expect(outcome(parseFen('8/8/8/4k3/8/8/8/R3K3 w - - 99 80'))).toBeNull();
    // but checkmate on the hundredth half-move still counts
    expect(outcome(parseFen('R3k3/8/4K3/8/8/8/8/8 b - - 100 80'))).toEqual({ kind: 'checkmate', winner: 'w' });
  });

  it('knows threefold repetition from the history', () => {
    const line = play(START_FEN, 'Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1 Ng8');
    const fens = line.map(toFen);
    expect(outcome(line[4], fens.slice(0, 4))).toBeNull(); // start position seen twice
    expect(outcome(line[8], fens.slice(0, 8))).toEqual({ kind: 'repetition' });
    // also fine if the caller's history already ends with the current position
    expect(outcome(line[8], fens.slice(0, 9))).toEqual({ kind: 'repetition' });
    expect(outcome(line[7], fens.slice(0, 8))).toBeNull(); // the position after Ng1 has only been seen twice
    expect(outcome(line[8])).toBeNull(); // no history, no repetition
  });
});

describe('material', () => {
  it('counts material and captured pieces', () => {
    const start = parseFen(START_FEN);
    expect(material(start)).toEqual({ w: 39, b: 39 });
    expect(captured(start)).toEqual({ w: [], b: [] });
    const line = play(START_FEN, 'e4 d5 exd5 Qxd5 Nc3 Qxg2 Bxg2');
    const pos = last(line);
    expect(material(pos)).toEqual({ w: 37, b: 29 });
    expect(captured(pos)).toEqual({ w: ['p', 'p'], b: ['q', 'p'] });
  });

  it('does not count promoted pawns as captured, and never goes negative', () => {
    // White has promoted twice (three queens, six pawns); both sides have lost both rooks.
    const pos = parseFen('1nbqkbn1/pppppppp/8/8/8/8/PPPPPP2/QNBQKBNQ w - - 0 1');
    expect(captured(pos)).toEqual({ w: ['r', 'r'], b: ['r', 'r'] });
    expect(material(pos).w).toBe(6 + 3 * 9 + 2 * 3 + 2 * 3);
  });
});
