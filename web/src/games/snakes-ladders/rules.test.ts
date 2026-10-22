import { describe, expect, it } from 'vitest';
import { BANDS, type Band } from '../bands';
import {
  BOARDS,
  FAMILY,
  GIRAFFE,
  advance,
  boardFor,
  bounced,
  describeRoll,
  cellOf,
  hopPath,
  ladders,
  latestRolls,
  linkList,
  newGame,
  problems,
  rollDie,
  rollTurn,
  rowsOf,
  sayRoll,
  snakes,
  squareAt,
  takeTurn,
  type Board,
  type State,
} from './rules';

// Seeded generator (mulberry32) so the long-running checks are repeatable.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random() that gives these die rolls in turn. */
function dice(...rolls: number[]): () => number {
  let i = 0;
  return () => (rolls[i++ % rolls.length] - 1) / 6 + 0.01;
}

const plain = (size: number, cols: number, links: Record<string, number> = {}, exact = false): Board => ({ size, cols, links, exact });

describe('the boards', () => {
  const shape: Record<Band, { size: number; cols: number; ladders: number; snakes: number; exact: boolean }> = {
    '5-7': { size: 30, cols: 6, ladders: 4, snakes: 2, exact: false },
    '8-10': { size: 100, cols: 10, ladders: 8, snakes: 7, exact: false },
    '11-13': { size: 100, cols: 10, ladders: 7, snakes: 9, exact: false },
    '14+': { size: 100, cols: 10, ladders: 6, snakes: 10, exact: true },
  };

  it.each(BANDS)('%s has the right size, ladders, snakes and finish', (band) => {
    const b = BOARDS[band];
    const want = shape[band];
    expect(b.size).toBe(want.size);
    expect(b.cols).toBe(want.cols);
    expect(rowsOf(b) * b.cols).toBe(b.size);
    expect(ladders(b)).toHaveLength(want.ladders);
    expect(snakes(b)).toHaveLength(want.snakes);
    expect(b.exact).toBe(want.exact);
  });

  it.each(BANDS)('%s is a fair board: nothing on the first or last square, no chains, one thing per square', (band) => {
    const b = BOARDS[band];
    expect(problems(b)).toEqual([]);
    const pairs = linkList(b);
    const starts = pairs.map(([from]) => from);
    const squares = pairs.flat();
    expect(starts).not.toContain(1);
    expect(starts).not.toContain(b.size);
    for (const [, to] of pairs) expect(starts).not.toContain(to);
    expect(new Set(squares).size).toBe(squares.length);
    for (const sq of squares) {
      expect(sq).toBeGreaterThanOrEqual(1);
      expect(sq).toBeLessThanOrEqual(b.size);
    }
  });

  it('ladders always climb a row or more and snakes always drop one, so they can be drawn', () => {
    for (const band of BANDS) {
      const b = BOARDS[band];
      for (const [from, to] of ladders(b)) expect(cellOf(b, to).row).toBeGreaterThan(cellOf(b, from).row);
      for (const [from, to] of snakes(b)) expect(cellOf(b, to).row).toBeLessThan(cellOf(b, from).row);
    }
  });

  it('gives the youngest short snakes and the oldest some long ones', () => {
    for (const [from, to] of snakes(BOARDS['5-7'])) expect(from - to).toBeLessThanOrEqual(10);
    expect(snakes(BOARDS['14+']).filter(([from, to]) => from - to >= 30).length).toBeGreaterThanOrEqual(3);
  });

  it('gets harder with age: more snakes and fewer ladders', () => {
    const counts = BANDS.slice(1).map((band) => [ladders(BOARDS[band]).length, snakes(BOARDS[band]).length]);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i][0]).toBeLessThanOrEqual(counts[i - 1][0]);
      expect(counts[i][1]).toBeGreaterThanOrEqual(counts[i - 1][1]);
    }
  });

  it('hands out a copy, so a game can never change the shared board', () => {
    const b = boardFor('8-10');
    b.links['2'] = 99;
    expect(BOARDS['8-10'].links['2']).toBeUndefined();
  });

  it('finds what is wrong with a bad board', () => {
    expect(problems(plain(30, 6, { 1: 10 }))).not.toEqual([]);
    expect(problems(plain(30, 6, { 30: 10 }))).not.toEqual([]);
    expect(problems(plain(30, 6, { 3: 15, 15: 27 }))).not.toEqual([]); // a ladder into a ladder
    expect(problems(plain(30, 6, { 3: 15, 20: 15 }))).not.toEqual([]); // two ending on one square
    expect(problems(plain(30, 6, { 3: 5 }))).not.toEqual([]); // stays on one row
    expect(problems(plain(30, 6, { 3: 40 }))).not.toEqual([]);
    expect(problems(plain(30, 6, { 3: 15, 20: 8 }))).toEqual([]);
  });
});

describe('the squares', () => {
  const b = plain(30, 6);

  it('start bottom left and wind back and forth up the board', () => {
    expect(cellOf(b, 1)).toEqual({ col: 0, row: 0 });
    expect(cellOf(b, 6)).toEqual({ col: 5, row: 0 });
    expect(cellOf(b, 7)).toEqual({ col: 5, row: 1 });
    expect(cellOf(b, 12)).toEqual({ col: 0, row: 1 });
    expect(cellOf(b, 13)).toEqual({ col: 0, row: 2 });
    expect(cellOf(b, 30)).toEqual({ col: 5, row: 4 });
  });

  it('can be found from where they are', () => {
    for (let n = 1; n <= 100; n++) {
      const big = plain(100, 10);
      const { col, row } = cellOf(big, n);
      expect(squareAt(big, col, row)).toBe(n);
    }
  });
});

describe('moving', () => {
  const b = plain(30, 6, { 3: 15, 16: 10 });

  it('hops forward one square at a time', () => {
    expect(hopPath(b, 1, 4)).toEqual([2, 3, 4, 5]);
    expect(advance(b, 1, 4)).toEqual({ roll: 4, from: 1, to: 5 });
  });

  it('climbs a ladder from its foot', () => {
    expect(advance(b, 1, 2)).toEqual({ roll: 2, from: 1, to: 15, via: 3 });
  });

  it("slides down a snake from its head", () => {
    expect(advance(b, 12, 4)).toEqual({ roll: 4, from: 12, to: 10, via: 16 });
  });

  it('passing over a ladder or snake does nothing', () => {
    expect(advance(b, 2, 3).to).toBe(5);
    expect(advance(b, 14, 4).to).toBe(18);
  });

  it('finishes with any roll that reaches the end when the finish is not exact', () => {
    expect(hopPath(b, 28, 5)).toEqual([29, 30]);
    expect(advance(b, 28, 5)).toEqual({ roll: 5, from: 28, to: 30 });
    expect(bounced(b, { from: 28, roll: 5 })).toBe(false);
  });

  describe('with an exact finish', () => {
    const exact = plain(100, 10, { 98: 61 }, true);

    it('needs the exact roll to land on the last square', () => {
      expect(advance(exact, 97, 3)).toEqual({ roll: 3, from: 97, to: 100 });
      expect(bounced(exact, { from: 97, roll: 3 })).toBe(false);
    });

    it('bounces back the extra', () => {
      expect(hopPath(exact, 96, 6)).toEqual([97, 98, 99, 100, 99, 98]);
      expect(advance(exact, 97, 5)).toEqual({ roll: 5, from: 97, to: 61, via: 98 });
      expect(advance(exact, 99, 4)).toEqual({ roll: 4, from: 99, to: 97 });
      expect(bounced(exact, { from: 99, roll: 4 })).toBe(true);
    });
  });

  it('rolls a die from 1 to 6', () => {
    expect(rollDie(() => 0)).toBe(1);
    expect(rollDie(() => 0.9999999)).toBe(6);
    const random = seeded(3);
    const seen = new Set(Array.from({ length: 200 }, () => rollDie(random)));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('turns', () => {
  const b = plain(30, 6, { 3: 15, 16: 10 });
  const order = ['p1', 'p2', 'p3'];

  it('starts everyone on square 1 with the first player to roll', () => {
    const s = newGame(b, order);
    expect(s).toMatchObject({ turn: 'p1', pos: { p1: 1, p2: 1, p3: 1 }, rolls: 0, last: {} });
  });

  it('goes round the players in order, and a 6 gives no extra go', () => {
    let s: State | null = newGame(b, order);
    s = takeTurn(s, order, 'p1', 6);
    expect(s?.turn).toBe('p2');
    s = takeTurn(s!, order, 'p2', 1);
    expect(s?.turn).toBe('p3');
    s = takeTurn(s!, order, 'p3', 3);
    expect(s?.turn).toBe('p1');
    expect(s?.pos).toEqual({ p1: 7, p2: 2, p3: 4 });
    expect(s?.rolls).toBe(3);
  });

  it('remembers each seat’s last roll and which roll of the game it was', () => {
    const s = takeTurn(takeTurn(newGame(b, order), order, 'p1', 2)!, order, 'p2', 4)!;
    expect(s.last.p1).toEqual({ roll: 2, from: 1, to: 15, via: 3, n: 1 });
    expect(s.last.p2).toEqual({ roll: 4, from: 1, to: 5, n: 2 });
  });

  it("won't roll for the wrong seat, a seat not playing, or a roll that isn't a die", () => {
    const s = newGame(b, order);
    expect(takeTurn(s, order, 'p2', 3)).toBeNull();
    expect(takeTurn({ ...s, turn: 'p9' }, order, 'p9', 3)).toBeNull();
    expect(takeTurn(s, order, 'p1', 0)).toBeNull();
    expect(takeTurn(s, order, 'p1', 7)).toBeNull();
    expect(takeTurn(s, order, 'p1', 2.5)).toBeNull();
  });

  it('ends the game when someone reaches the last square', () => {
    const s: State = { ...newGame(b, order), turn: 'p2', pos: { p1: 20, p2: 27, p3: 5 } };
    const won = takeTurn(s, order, 'p2', 4)!;
    expect(won.winner).toBe('p2');
    expect(won.pos.p2).toBe(30);
    expect(takeTurn(won, order, won.turn, 3)).toBeNull();
    expect(takeTurn({ ...won, turn: 'p3' }, order, 'p3', 3)).toBeNull();
  });
});

describe('against the Night Giraffe', () => {
  const b = plain(30, 6, { 3: 15, 16: 10 });
  const order = [FAMILY, GIRAFFE];
  const seats = { [FAMILY]: 'team', [GIRAFFE]: 'computer' };

  it('the giraffe rolls straight after the family, in the same move', () => {
    const s = rollTurn(newGame(b, order), seats, order, FAMILY, dice(4, 2))!;
    expect(s.pos).toEqual({ [FAMILY]: 5, [GIRAFFE]: 15 });
    expect(s.turn).toBe(FAMILY);
    expect(s.rolls).toBe(2);
    expect(s.last[FAMILY]).toMatchObject({ roll: 4, n: 1 });
    expect(s.last[GIRAFFE]).toMatchObject({ roll: 2, via: 3, n: 2 });
    expect(latestRolls(s).map((r) => r.seat)).toEqual([FAMILY, GIRAFFE]);
  });

  it("never leaves the turn with the giraffe, who can't save a move", () => {
    let s: State | null = newGame(b, order);
    const random = seeded(7);
    for (let i = 0; i < 200 && s && !s.winner; i++) {
      s = rollTurn(s, seats, order, FAMILY, random);
      if (s && !s.winner) expect(s.turn).toBe(FAMILY);
    }
    expect(s?.winner).toBeDefined();
  });

  it("doesn't roll for the giraffe once the family has won", () => {
    const s: State = { ...newGame(b, order), pos: { [FAMILY]: 28, [GIRAFFE]: 29 } };
    const won = rollTurn(s, seats, order, FAMILY, dice(2, 1))!;
    expect(won.winner).toBe(FAMILY);
    expect(won.pos[GIRAFFE]).toBe(29);
    expect(won.rolls).toBe(1);
    expect(latestRolls(won).map((r) => r.seat)).toEqual([FAMILY]);
  });

  it('the giraffe can win', () => {
    const s: State = { ...newGame(b, order), pos: { [FAMILY]: 4, [GIRAFFE]: 29 } };
    const lost = rollTurn(s, seats, order, FAMILY, dice(1, 1))!;
    expect(lost.winner).toBe(GIRAFFE);
    expect(lost.pos).toEqual({ [FAMILY]: 5, [GIRAFFE]: 30 });
  });

  it("only the seat whose turn it is can roll", () => {
    expect(rollTurn(newGame(b, order), seats, order, GIRAFFE, dice(3))).toBeNull();
  });
});

describe('a whole game', () => {
  it.each(BANDS)('always ends on the %s board', (band) => {
    const random = seeded(band.length * 97 + 11);
    const order = ['p1', 'p2', 'p3'];
    for (let game = 0; game < 200; game++) {
      let s: State | null = newGame(boardFor(band), order);
      let rolls = 0;
      while (s && !s.winner && rolls < 3000) {
        s = rollTurn(s, {}, order, s.turn, random);
        rolls++;
      }
      expect(s?.winner).toBeDefined();
      expect(s!.pos[s!.winner!]).toBe(s!.board.size);
      for (const seat of order) expect(s!.pos[seat]).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('the words', () => {
  const b = plain(100, 10, { 16: 34, 47: 26, 98: 61 }, true);

  it('read out a roll for the live status line', () => {
    expect(describeRoll('You', { roll: 4, from: 12, to: 34, via: 16, n: 1 }, b)).toBe('You rolled a 4 and moved from 12 to 16. A ladder took you up to 34!');
    expect(describeRoll('Mia', { roll: 3, from: 44, to: 26, via: 47, n: 2 }, b)).toBe('Mia rolled a 3 and moved from 44 to 47. A snake took Mia down to 26.');
    expect(describeRoll('The Night Giraffe', { roll: 2, from: 7, to: 9, n: 3 }, b)).toBe('The Night Giraffe rolled a 2 and moved from 7 to 9.');
    expect(describeRoll('The family', { roll: 5, from: 97, to: 61, via: 98, n: 4 }, b)).toBe(
      'The family rolled a 5 and moved from 97 to 100, then bounced back to 98. A snake took the family down to 61.',
    );
  });

  it('say what happened in a few words', () => {
    expect(sayRoll({ roll: 4, from: 12, to: 34, via: 16, n: 1 }, b)).toEqual({ text: 'A ladder! Up to 34', kind: 'up' });
    expect(sayRoll({ roll: 3, from: 44, to: 26, via: 47, n: 1 }, b)?.kind).toBe('down');
    expect(sayRoll({ roll: 4, from: 99, to: 97, n: 1 }, b)).toEqual({ text: 'Too many! Back to 97', kind: 'bounce' });
    expect(sayRoll({ roll: 3, from: 97, to: 100, n: 1 }, b)?.kind).toBe('end');
    expect(sayRoll({ roll: 2, from: 7, to: 9, n: 1 }, b)).toBeNull();
  });
});
