import { describe, expect, it } from 'vitest';
import { chooseMove, evaluate } from './ai';
import type { Level } from './ai';
import {
  START_FEN, fromSan, isLegal, legalMoves, makeMove, parseFen, san, squareIndex, toFen,
} from './rules';
import type { Move, Position } from './rules';

const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

/** Small deterministic generator (mulberry32) so the AI's random choices repeat from run to run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function play(fen: string, moves: string): Position {
  let pos = parseFen(fen);
  for (const text of moves.split(' ')) pos = makeMove(pos, fromSan(pos, text) as Move);
  return pos;
}

/** The same position with the board turned round and the colours swapped. */
function mirror(pos: Position): Position {
  const board = pos.board.map((_, i) => {
    const p = pos.board[i ^ 56];
    return p && { side: p.side === 'w' ? ('b' as const) : ('w' as const), kind: p.kind };
  });
  const castling = [...pos.castling].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
  return {
    ...pos,
    board,
    turn: pos.turn === 'w' ? 'b' : 'w',
    castling: ['K', 'Q', 'k', 'q'].filter((c) => castling.includes(c)).join(''),
    enPassant: pos.enPassant === null ? null : pos.enPassant ^ 56,
  };
}

const sanOf = (pos: Position, level: Level, seed = 1): string | null => {
  const move = chooseMove(pos, level, seeded(seed));
  return move && san(pos, move);
};

describe('evaluate', () => {
  it('is level at the start and symmetric between the colours', () => {
    expect(evaluate(parseFen(START_FEN))).toBe(0);
    for (const fen of [KIWIPETE, 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3']) {
      const pos = parseFen(fen);
      expect(evaluate(mirror(pos)) + evaluate(pos)).toBe(0);
    }
  });

  it('counts material in centipawns from the white side', () => {
    const noBlackQueen = parseFen('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(evaluate(noBlackQueen)).toBeGreaterThan(800);
    expect(evaluate(noBlackQueen)).toBeLessThan(1000);
    expect(evaluate(mirror(noBlackQueen))).toBeLessThan(-800);
  });

  it('prefers developed pieces and central pawns', () => {
    const start = parseFen(START_FEN);
    expect(evaluate(play(START_FEN, 'e4'))).toBeGreaterThan(evaluate(start));
    expect(evaluate(play(START_FEN, 'Nf3'))).toBeGreaterThan(evaluate(play(START_FEN, 'Nh3')));
  });
});

describe('chooseMove', () => {
  const mates: [string, string, string][] = [
    ['back rank', '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'Ra8#'],
    ["scholar's mate", toFen(play(START_FEN, 'e4 e5 Bc4 Nc6 Qh5 Nf6')), 'Qxf7#'],
    ["fool's mate, for black", toFen(play(START_FEN, 'f3 e5 g4')), 'Qh4#'],
    ['smothered', '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', 'Nf7#'],
  ];
  for (const level of [2, 3] as const) {
    for (const [name, fen, expected] of mates) {
      it(`level ${level} finds mate in one (${name})`, () => {
        expect(sanOf(parseFen(fen), level)).toBe(expected);
      });
    }

    it(`level ${level} takes a hanging queen`, () => {
      expect(sanOf(parseFen('4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1'), level)).toBe('Rxd5');
      expect(sanOf(parseFen('4k3/3r4/8/2n5/3Q4/8/8/4K3 b - - 0 1'), level)).toBe('Rxd4');
    });

    it(`level ${level} does not take a poisoned pawn with its queen`, () => {
      // Qxb7 would lose the queen to the rook on b8.
      const pos = parseFen('1r2k3/1p6/8/8/8/8/1Q6/4K3 w - - 0 1');
      expect(sanOf(pos, level)).not.toBe('Qxb7');
    });
  }

  it('returns null when there are no moves, at every level', () => {
    const mated = play(START_FEN, 'f3 e5 g4 Qh4#');
    const stalemate = parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    for (const level of [1, 2, 3] as const) {
      expect(chooseMove(mated, level, seeded(1))).toBeNull();
      expect(chooseMove(stalemate, level, seeded(1))).toBeNull();
    }
  });

  it('plays the only legal move straight away', () => {
    const pos = parseFen('k6R/8/2K5/8/8/8/8/8 b - - 0 1');
    expect(legalMoves(pos)).toHaveLength(1);
    for (const level of [1, 2, 3] as const) expect(sanOf(pos, level)).toBe('Ka7');
  });

  it('never mutates the position', () => {
    const pos = parseFen(KIWIPETE);
    const before = JSON.stringify(pos);
    for (const level of [1, 2] as const) chooseMove(pos, level, seeded(3));
    expect(JSON.stringify(pos)).toBe(before);
  });

  it('level 3 answers within about a second from the start and from Kiwipete', () => {
    for (const fen of [START_FEN, KIWIPETE]) {
      const pos = parseFen(fen);
      const started = performance.now();
      const move = chooseMove(pos, 3, seeded(7));
      const took = performance.now() - started;
      expect(move).not.toBeNull();
      expect(isLegal(pos, move as Move)).toBe(true);
      expect(took).toBeLessThan(1500);
    }
  });

  it('level 2 is repeatable with a seed but varies between seeds', () => {
    const start = parseFen(START_FEN);
    expect(sanOf(start, 2, 11)).toBe(sanOf(start, 2, 11));
    const openings = new Set(Array.from({ length: 12 }, (_, seed) => sanOf(start, 2, seed)));
    expect(openings.size).toBeGreaterThan(1);
  });

  it('steers away from repeating a position when given the game history', () => {
    // White is a queen up; the move it would normally play is made to look like a repetition.
    const pos = parseFen('8/8/3k4/8/8/8/3K4/7Q w - - 0 1');
    for (const level of [2, 3] as const) {
      const usual = chooseMove(pos, level, seeded(5)) as Move;
      const history = [toFen(makeMove(pos, usual))];
      const other = chooseMove(pos, level, seeded(5), history) as Move;
      expect(other).not.toEqual(usual);
      expect(isLegal(pos, other)).toBe(true);
    }
  });
});

describe('level 1', () => {
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1);

  it('returns a legal move', () => {
    const fens = [START_FEN, KIWIPETE, '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', '8/4P3/8/8/8/8/k7/4K3 w - - 0 1'];
    for (const fen of fens) {
      const pos = parseFen(fen);
      for (const seed of seeds.slice(0, 10)) {
        const move = chooseMove(pos, 1, seeded(seed));
        expect(move).not.toBeNull();
        expect(isLegal(pos, move as Move)).toBe(true);
      }
    }
  });

  it('spots a mate in one only some of the time', () => {
    const pos = parseFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    const found = seeds.filter((seed) => sanOf(pos, 1, seed) === 'Ra8#').length;
    expect(found).toBeGreaterThan(seeds.length * 0.3);
    expect(found).toBeLessThan(seeds.length * 0.9);
  });

  it('takes a free queen only some of the time', () => {
    const pos = parseFen('4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1');
    const taken = seeds.filter((seed) => sanOf(pos, 1, seed) === 'Rxd5').length;
    expect(taken).toBeGreaterThan(seeds.length * 0.3);
    expect(taken).toBeLessThan(seeds.length * 0.9);
  });

  it('mostly moves a piece out of danger', () => {
    // The pawn on d5 attacks the knight; any knight move saves it, any king move loses it.
    const pos = parseFen('4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1');
    const saved = seeds.filter((seed) => {
      const move = chooseMove(pos, 1, seeded(seed)) as Move;
      return move.from === squareIndex('e4');
    }).length;
    expect(saved).toBeGreaterThan(seeds.length * 0.8);
  });

  it('plays different games with different seeds', () => {
    const start = parseFen(START_FEN);
    const openings = new Set(seeds.slice(0, 12).map((seed) => sanOf(start, 1, seed)));
    expect(openings.size).toBeGreaterThan(4);
  });
});
