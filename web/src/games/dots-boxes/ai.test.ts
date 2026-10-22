import { describe, expect, it } from 'vitest';
import { anySafeLine, chooseLine, computerTurn, giveaway, partsOf, worth, type Level } from './ai';
import { across, boxesBeside, down, drawLine, isOver, lineCount, newBoard, scoresOf, sidesDrawn, type DotsState } from './rules';

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

/**
 * A board from a picture: + for dots, -- for a line across, | for a line
 * down. Every line in it is p1's, and so is every box it closes.
 */
function board(rows: string[], extra: Partial<DotsState> = {}): DotsState {
  const n = (rows.length - 1) / 2;
  const s = newBoard(n, extra);
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) if (rows[2 * r][3 * c + 1] === '-') s.lines[across(n, r, c)] = 'p1';
  for (let r = 0; r < n; r++) for (let c = 0; c <= n; c++) if (rows[2 * r + 1][3 * c] === '|') s.lines[down(n, r, c)] = 'p1';
  s.order = s.lines.flatMap((l, i) => (l ? [i] : []));
  s.boxes = s.boxes.map((_, b) => (sidesDrawn(n, s.lines, b) === 4 ? 'p1' : null));
  return s;
}

const TWO = ['p1', 'p2'];
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const choices = (s: DotsState, level: Level) => new Set(SEEDS.map((seed) => chooseLine(s.size, s.lines, level, seeded(seed))));

// One box (the top left) with three sides, and plenty of other lines.
const GIFT = board(['+--+  +  +', '|          ', '+--+  +  +', '          ', '+  +  +  +', '          ', '+  +  +  +']);
const TAKE = down(3, 0, 1);

// Each corner box has two sides, so eight lines would hand one over; eight others are safe.
const CORNERS = board(['+--+  +--+', '|        |', '+  +  +  +', '          ', '+  +  +  +', '|        |', '+--+  +--+']);
const unsafe = (s: DotsState, l: number) => boxesBeside(s.size, l).some((b) => sidesDrawn(s.size, s.lines, b) === 2);

// No safe lines left: a chain of 3 along the top, a chain of 5 snaking through the
// middle and down, and a single box in the bottom left corner.
const THREE_FIVE_ONE = board(['+--+--+--+', '          ', '+--+--+--+', '         |', '+--+--+  +', '   |     |', '+  +  +--+']);
const SINGLE = [down(3, 2, 0), across(3, 3, 0)];

// No safe lines left: a chain of 5 (top row, then down the right) and a chain of 4 (the rest).
const FIVE_FOUR = board(['+--+--+--+', '         |', '+--+--+  +', '      |  |', '+--+  +  +', '|     |  |', '+  +--+  +']);

/** The person (p1) draws a line, then it's the computer's (p2's) turn. */
function opened(s: DotsState, line: number, level: Level): DotsState {
  const next = drawLine({ ...s, turn: 'p1', level }, line, TWO)!.state;
  expect(next.turn).toBe('p2');
  return next;
}

describe('claiming boxes', () => {
  it('always takes a free box from 8 up', () => {
    for (const level of [2, 3, 4] as const) expect(choices(GIFT, level)).toEqual(new Set([TAKE]));
  });

  it('only sometimes takes one for the youngest', () => {
    const picked = SEEDS.map((seed) => chooseLine(3, GIFT.lines, 1, seeded(seed)));
    expect(picked).toContain(TAKE);
    expect(picked.filter((l) => l !== TAKE).length).toBeGreaterThan(10);
  });

  it('keeps going while it finishes boxes', () => {
    // The person opens the chain of 3 along the top; a steady computer eats all of it.
    const s = computerTurn(opened(THREE_FIVE_ONE, down(3, 0, 0), 2), TWO, seeded(3));
    expect(scoresOf(s, TWO).p2).toBe(3);
    expect(s.turn).toBe('p1');
  });
});

describe('third sides', () => {
  it('avoids drawing a third side while it can, from 11 up', () => {
    for (const level of [3, 4] as const) for (const l of choices(CORNERS, level)) expect(unsafe(CORNERS, l)).toBe(false);
  });

  it('may hand over a box at 8 to 10', () => {
    expect([...choices(CORNERS, 2)].some((l) => unsafe(CORNERS, l))).toBe(true);
  });

  it('knows when every line gives something away', () => {
    expect(anySafeLine(3, CORNERS.lines)).toBe(true);
    expect(anySafeLine(3, GIFT.lines)).toBe(true);
    expect(anySafeLine(3, THREE_FIVE_ONE.lines)).toBe(false);
  });
});

describe('chains', () => {
  it('counts what a line gives away along a chain', () => {
    expect(giveaway(3, THREE_FIVE_ONE.lines, across(3, 3, 0))).toBe(1);
    expect(giveaway(3, THREE_FIVE_ONE.lines, down(3, 0, 1))).toBe(3);
    expect(giveaway(3, THREE_FIVE_ONE.lines, down(3, 1, 0))).toBe(5);
    // A line that finishes a box gives nothing: the same player goes again.
    expect(giveaway(3, GIFT.lines, TAKE)).toBe(0);
    expect(giveaway(3, CORNERS.lines, across(3, 0, 1))).toBe(0);
  });

  it('sees the chains and loops on the board', () => {
    expect(partsOf(3, THREE_FIVE_ONE.lines)).toEqual({ chains: [3, 5, 1], loops: [] });
    expect(partsOf(3, FIVE_FOUR.lines)).toEqual({ chains: [5, 4], loops: [] });
    // Boxes with fewer than two sides join things up, so it isn't that simple.
    expect(partsOf(3, CORNERS.lines)).toBeNull();
    // A loop of 8 round the middle box, which is already claimed.
    const loop = board(['+--+--+--+', '|        |', '+  +--+  +', '|  |  |  |', '+  +--+  +', '|        |', '+--+--+--+']);
    expect(partsOf(3, loop.lines)).toEqual({ chains: [], loops: [8] });
  });

  it('works out who comes out ahead', () => {
    expect(worth([])).toBe(0);
    expect(worth([1])).toBe(-1);
    expect(worth([3])).toBe(-3);
    // Open the single box, and the other side has to open the chain of 3.
    expect(worth([1, 3])).toBe(2);
    // Open the loop first: the other side takes 4 and opens the chain, or hands all 4 back.
    expect(worth([4], [4])).toBe(0);
  });

  it('gives away the shortest chain at 14 and up', () => {
    for (const l of choices(THREE_FIVE_ONE, 4)) expect(SINGLE).toContain(l);
  });

  it("doesn't count chains at 11 to 13", () => {
    expect([...choices(THREE_FIVE_ONE, 3)].some((l) => !SINGLE.includes(l))).toBe(true);
  });

  it("opens a chain of 2 in the middle, so it can't be handed back", () => {
    // A chain of 2 in the top left corner (boxes 0 and 3) and a chain of 7 winding through the rest.
    const s = board(['+  +--+--+', '|  |     |', '+  +  +  +', '   |  |  |', '+--+  +  +', '|     |  |', '+  +--+  +']);
    expect(partsOf(3, s.lines)).toEqual({ chains: [2, 7], loops: [] });
    expect(choices(s, 4)).toEqual(new Set([across(3, 1, 0)]));
  });
});

describe('keeping control', () => {
  it('leaves the last two boxes of a chain when that wins the next one', () => {
    // The person opens the chain of 4. A strong computer takes 2, then draws the far end.
    const s = computerTurn(opened(FIVE_FOUR, down(3, 1, 0), 4), TWO, seeded(1));
    expect(s.order.slice(-3)).toEqual([down(3, 1, 1), across(3, 2, 1), across(3, 3, 0)]);
    expect(scoresOf(s, TWO)).toEqual({ p1: 0, p2: 2 });
    expect(s.turn).toBe('p1');
    // The person takes both boxes with one line, then has to open the chain of 5.
    const both = drawLine(s, down(3, 2, 1), TWO)!;
    expect(both.claimed).toHaveLength(2);
    const after = computerTurn(drawLine(both.state, down(3, 0, 0), TWO)!.state, TWO, seeded(1));
    expect(isOver(after)).toBe(true);
    expect(scoresOf(after, TWO)).toEqual({ p1: 2, p2: 7 });
  });

  it('a tricky computer just takes the lot', () => {
    const s = computerTurn(opened(FIVE_FOUR, down(3, 1, 0), 3), TWO, seeded(1));
    expect(scoresOf(s, TWO).p2).toBe(4);
  });

  it('takes them all when a short chain is left to hand back', () => {
    const s = computerTurn(opened(THREE_FIVE_ONE, down(3, 0, 0), 4), TWO, seeded(2));
    expect(scoresOf(s, TWO).p2).toBe(3);
    expect(SINGLE).toContain(s.order[s.order.length - 1]);
    expect(s.turn).toBe('p1');
  });
});

describe('whole games', () => {
  it('plays to the end at every level and size, quickly', () => {
    for (const level of [1, 2, 3, 4] as const) {
      for (const n of [3, 6]) {
        let s: DotsState = newBoard(n, { level });
        const random = seeded(level * 10 + n);
        const started = performance.now();
        // The computer plays both sides.
        while (!isOver(s)) s = computerTurn(s, TWO, random);
        expect(performance.now() - started).toBeLessThan(1500);
        expect(s.order).toHaveLength(lineCount(n));
        const scores = scoresOf(s, TWO);
        expect(scores.p1 + scores.p2).toBe(n * n);
      }
    }
  });

  it('a strong computer beats a steady one more often than not', () => {
    let strong = 0;
    for (let g = 0; g < 20; g++) {
      const random = seeded(100 + g);
      let s: DotsState = newBoard(4, { turn: g % 2 ? 'p1' : 'p2' });
      while (!isOver(s)) s = computerTurn({ ...s, level: s.turn === 'p1' ? 4 : 2 }, TWO, random);
      const scores = scoresOf(s, TWO);
      if (scores.p1 > scores.p2) strong++;
    }
    expect(strong).toBeGreaterThan(14);
  });
});
