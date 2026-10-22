import { describe, expect, it } from 'vitest';
import { WIN_SCORE, bestColumn, chooseColumn, evaluate, type Level } from './ai';
import { boardOf, outcome, playColumn, turnOf, winningColumns } from './rules';

/** Small deterministic generator (mulberry32) so the computer's random choices repeat from run to run. */
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

/** Plays a whole game between two levels and says who won. */
function match(red: Level, yellow: Level, seed: number): 'red' | 'yellow' | 'draw' {
  const random = seeded(seed);
  let moves: number[] = [];
  for (let over = outcome(moves); !over; over = outcome(moves)) {
    const col = chooseColumn(moves, turnOf(moves) === 'red' ? red : yellow, random);
    moves = playColumn(moves, col!)!;
  }
  const over = outcome(moves)!;
  return over.kind === 'four' ? over.winner : 'draw';
}

// Red to move in each.
const RED_WINS_ACROSS = [0, 0, 1, 1, 2, 2]; // red can finish the bottom row in column 3
const RED_WINS_UP = [0, 1, 0, 1, 0, 2]; // red has three up column 0
// Red has (0,0), (1,1) and (2,2), so column 3 wins on a slant; yellow has three across the bottom and wants column 4.
const WIN_OR_BLOCK = [0, 1, 1, 2, 2, 3, 2, 3, 3, 6];
const BLOCK_UP = [0, 6, 1, 6, 5, 6]; // yellow has three up column 6
const BLOCK_ACROSS = [0, 1, 5, 2, 0, 3]; // yellow has three across the bottom, needing column 4
// Yellow has three across the second row, waiting on the space above column 3's first.
const GIFT = [0, 0, 1, 1, 6, 2, 5, 2];
// Red can make an open three along the bottom (column 1 or 4), and yellow can only block one end.
const DOUBLE_THREAT = [3, 3, 2, 2];

describe('every level', () => {
  it('has nothing to choose once the game is over', () => {
    for (const level of [1, 2, 3, 4] as const) {
      expect(chooseColumn([0, 0, 1, 1, 2, 2, 3], level)).toBeNull();
    }
  });

  it('never picks a full column', () => {
    // Column 3 is full; the rest are empty.
    const moves = [3, 3, 3, 3, 3, 3];
    for (const level of [1, 2, 3, 4] as const) {
      for (let seed = 1; seed <= 20; seed++) expect(chooseColumn(moves, level, seeded(seed))).not.toBe(3);
    }
  });

  it('plays a whole game without a wrong move', () => {
    for (const [red, yellow] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 1],
    ] as const) {
      expect(['red', 'yellow', 'draw']).toContain(match(red, yellow, red * 10 + yellow));
    }
  });
});

describe('gentle (5 to 7)', () => {
  it('takes a win only about half the time', () => {
    const random = seeded(7);
    let wins = 0;
    for (let i = 0; i < 400; i++) if (chooseColumn(RED_WINS_ACROSS, 1, random) === 3) wins++;
    expect(wins / 400).toBeGreaterThan(0.35);
    expect(wins / 400).toBeLessThan(0.65);
  });

  it('never blocks on purpose', () => {
    const random = seeded(8);
    let blocks = 0;
    for (let i = 0; i < 400; i++) if (chooseColumn(BLOCK_UP, 1, random) === 6) blocks++;
    // Column 6 is the one it likes least, so it only lands there now and then, by luck.
    expect(blocks / 400).toBeLessThan(0.15);
  });

  it('likes the middle best', () => {
    const random = seeded(9);
    const counts = Array<number>(7).fill(0);
    for (let i = 0; i < 700; i++) counts[chooseColumn([], 1, random)!]++;
    expect(counts[3]).toBeGreaterThan(counts[0] * 2);
    expect(counts[3]).toBeGreaterThan(counts[6] * 2);
    expect(Math.min(...counts)).toBeGreaterThan(0);
  });
});

describe('steady and up', () => {
  for (const level of [2, 3, 4] as const) {
    it(`level ${level} always takes a win: across, up and on a slant`, () => {
      for (let seed = 1; seed <= 10; seed++) {
        expect(chooseColumn(RED_WINS_ACROSS, level, seeded(seed))).toBe(3);
        expect(chooseColumn(RED_WINS_UP, level, seeded(seed))).toBe(0);
        expect(chooseColumn(WIN_OR_BLOCK, level, seeded(seed))).toBe(3);
      }
    });

    it(`level ${level} always blocks a four`, () => {
      expect(winningColumns(boardOf(BLOCK_UP), 'yellow')).toEqual([6]);
      expect(winningColumns(boardOf(BLOCK_ACROSS), 'yellow')).toEqual([4]);
      for (let seed = 1; seed <= 10; seed++) {
        expect(chooseColumn(BLOCK_UP, level, seeded(seed))).toBe(6);
        expect(chooseColumn(BLOCK_ACROSS, level, seeded(seed))).toBe(4);
      }
    });

    it(`level ${level} doesn't fill the space under one where the other side could make four`, () => {
      for (let seed = 1; seed <= 20; seed++) expect(chooseColumn(GIFT, level, seeded(seed))).not.toBe(3);
    });
  }

  it('steady beats gentle most of the time', () => {
    let won = 0;
    for (let seed = 1; seed <= 20; seed++) {
      if (match(2, 1, seed) === 'red') won++;
      if (match(1, 2, seed + 100) === 'yellow') won++;
    }
    expect(won).toBeGreaterThanOrEqual(32);
  });
});

describe('tricky and strong', () => {
  for (const level of [3, 4] as const) {
    it(`level ${level} sets up two threats at once`, () => {
      for (let seed = 1; seed <= 5; seed++) expect([1, 4]).toContain(chooseColumn(DOUBLE_THREAT, level, seeded(seed)));
    });
  }

  it('strong opens in the middle', () => {
    expect(chooseColumn([], 4)).toBe(3);
  });

  it('strong beats steady, going first or second', () => {
    for (let seed = 1; seed <= 3; seed++) {
      expect(match(4, 2, seed)).toBe('red');
      expect(match(2, 4, seed)).toBe('yellow');
    }
  });

  it('tricky beats steady more often than not', () => {
    let won = 0;
    for (let seed = 1; seed <= 6; seed++) {
      if (match(3, 2, seed) === 'red') won++;
      if (match(2, 3, seed) === 'yellow') won++;
    }
    expect(won).toBeGreaterThanOrEqual(8);
  });

  it('strong answers in well under a second and a half', () => {
    const positions = [[], [3], [3, 3], [3, 2, 3, 3, 4, 4, 2, 5], [3, 3, 3, 3, 2, 4, 2, 2, 4, 1], [2, 4, 3, 3, 4, 2, 5, 1, 1, 5, 0, 6]];
    for (const moves of positions) {
      const started = performance.now();
      const col = chooseColumn(moves, 4);
      const took = performance.now() - started;
      expect(col).not.toBeNull();
      expect(took).toBeLessThan(1500);
    }
  });

  it('stops thinking when its time is up, and still answers', () => {
    const col = chooseColumn([3, 3], 4, Math.random, 0);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(col).toBeLessThan(7);
  });
});

describe('the search', () => {
  it('scores a four next move as a win, and two of theirs as a loss', () => {
    expect(evaluate(RED_WINS_ACROSS, 1)).toBeGreaterThan(WIN_SCORE - 10);
    // After red's open three, yellow can only block one end.
    expect(evaluate([3, 3, 2, 2, 4], 2)).toBeLessThan(-(WIN_SCORE - 10));
  });

  it('gives the same hint every time', () => {
    const first = bestColumn([3, 3, 4]);
    for (let i = 0; i < 3; i++) expect(bestColumn([3, 3, 4])).toBe(first);
    expect(bestColumn(DOUBLE_THREAT)).toSatisfy((c: number) => c === 1 || c === 4);
  });
});
