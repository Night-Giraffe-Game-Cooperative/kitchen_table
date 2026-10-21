import { describe, expect, it } from 'vitest';
import { chooseSequence, evaluate } from './ai';
import type { Level } from './ai';
import { applyMove, diceFor, endTurn, initial, legalSequences, rollDice, winKind, winner } from './rules';
import type { Move, Position, Side } from './rules';

// Seeded generator (mulberry32) so games are repeatable.
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

interface Game {
  record: Move[][];
  final: Position;
  positions: Position[];
}

function playGame(levels: Record<Side, Level>, seed: number): Game {
  const random = seeded(seed);
  let pos = initial(random() < 0.5 ? 'w' : 'b');
  const record: Move[][] = [];
  const positions: Position[] = [];
  while (!winner(pos) && record.length < 1000) {
    positions.push(pos);
    const dice = diceFor(rollDice(random));
    const seq = chooseSequence(pos, dice, levels[pos.turn], random);
    const legal = legalSequences(pos, dice).map((s) => JSON.stringify(s));
    if (legal.length === 0) expect(seq).toEqual([]);
    else expect(legal).toContain(JSON.stringify(seq));
    for (const m of seq) pos = applyMove(pos, m);
    pos = endTurn(pos);
    record.push(seq);
  }
  return { record, final: pos, positions };
}

// Builds a position from the opening one with some checkers moved: [from, to] pairs, 'bar' allowed.
function opening(changes: Array<[number, number | 'bar']>, turn: Side = 'w'): Position {
  const pos = initial(turn);
  for (const [from, to] of changes) {
    const sign = Math.sign(pos.points[from]);
    pos.points[from] -= sign;
    if (to === 'bar') pos.bar[sign > 0 ? 'w' : 'b']++;
    else pos.points[to] += sign;
  }
  return pos;
}

const played = (pos: Position, seq: Move[]): Position => seq.reduce(applyMove, pos);
const moveSet = (seq: Move[]): string[] => seq.map((m) => `${m.from}>${m.to}`).sort();

describe('chooseSequence', () => {
  for (const level of [1, 2, 3] as Level[]) {
    it(`plays a full game against itself at level ${level}`, () => {
      const game = playGame({ w: level, b: level }, 100 + level);
      expect(winner(game.final)).not.toBeNull();
      expect(winKind(game.final)).not.toBeNull();
    });

    it(`is deterministic with a seeded random at level ${level}`, () => {
      const a = playGame({ w: level, b: 3 }, 7);
      const b = playGame({ w: level, b: 3 }, 7);
      expect(a.record).toEqual(b.record);
      expect(a.final).toEqual(b.final);
    });
  }

  it('returns an empty list when nothing can move', () => {
    const pos: Position = {
      points: [-2, 0, 0, 0, 1, 5, 0, 3, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, -3, -2, -2, -2, -2, -2],
      bar: { w: 1, b: 0 },
      off: { w: 0, b: 0 },
      turn: 'w',
    };
    for (const level of [1, 2, 3] as Level[]) expect(chooseSequence(pos, [6, 5], level, seeded(1))).toEqual([]);
  });

  it('level 1 varies its play, level 3 does not', () => {
    const pos = initial();
    const gentle = new Set<string>();
    const tricky = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      gentle.add(JSON.stringify(moveSet(chooseSequence(pos, [4, 2], 1, seeded(seed)))));
      tricky.add(JSON.stringify(moveSet(chooseSequence(pos, [4, 2], 3, seeded(seed)))));
    }
    expect(gentle.size).toBeGreaterThan(2);
    expect(tricky.size).toBe(1);
  });

  it('level 3 makes the 5-point with an opening 3-1', () => {
    const seq = chooseSequence(initial(), [3, 1], 3, seeded(1));
    expect(moveSet(seq)).toEqual(['5>4', '7>4']);
  });

  it('level 3 points on a blot on its 5-point with 3-1', () => {
    // Black has split a back checker up to White's 5-point (index 4).
    const pos = opening([[0, 4]]);
    const seq = chooseSequence(pos, [3, 1], 3, seeded(1));
    expect(moveSet(seq)).toEqual(['5>4', '7>4']);
    const after = played(pos, seq);
    expect(after.bar.b).toBe(1);
    expect(after.points[4]).toBe(2);
  });

  it('level 3 hits and makes its bar point with 6-1', () => {
    // Black played 24/18 13/11, leaving a blot on White's bar point (index 6).
    const pos = opening([
      [0, 6],
      [11, 13],
    ]);
    const seq = chooseSequence(pos, [6, 1], 3, seeded(1));
    expect(moveSet(seq)).toEqual(['12>6', '7>6']);
    expect(played(pos, seq).bar.b).toBe(1);
  });

  it('level 3 hits a runner in its outfield', () => {
    // Black ran a back checker to White's 10-point (index 9).
    const pos = opening([[0, 9]]);
    for (const roll of [
      [2, 1],
      [3, 2],
      [4, 3],
    ]) {
      const seq = chooseSequence(pos, roll, 3, seeded(1));
      expect(played(pos, seq).bar.b, `roll ${roll}`).toBe(1);
    }
  });

  it('stronger levels beat weaker ones', () => {
    let wins2 = 0;
    let wins3 = 0;
    for (let seed = 1; seed <= 20; seed++) {
      // Swap colours every game.
      const strong: Side = seed % 2 ? 'w' : 'b';
      const against = (level: Level): Record<Side, Level> => (strong === 'w' ? { w: level, b: 1 } : { w: 1, b: level });
      if (winner(playGame(against(2), seed).final) === strong) wins2++;
      if (winner(playGame(against(3), seed).final) === strong) wins3++;
    }
    expect(wins2).toBeGreaterThanOrEqual(15);
    expect(wins3).toBeGreaterThanOrEqual(15);
    // 40 whole games: a few seconds normally, longer on a busy PC.
  }, 30_000);

  it('level 3 decides quickly', () => {
    const { positions } = playGame({ w: 2, b: 2 }, 11);
    const random = seeded(5);
    let slowest = 0;
    let total = 0;
    for (const pos of positions) {
      const dice = diceFor(rollDice(random));
      const start = performance.now();
      chooseSequence(pos, dice, 3, random);
      const ms = performance.now() - start;
      slowest = Math.max(slowest, ms);
      total += ms;
    }
    // Loose bounds (a few times what a desktop needs) so this only catches a real slowdown.
    expect(total / positions.length).toBeLessThan(40);
    expect(slowest).toBeLessThan(250);
  });
});

describe('evaluate', () => {
  it('is even in the opening position and symmetric between the sides', () => {
    expect(evaluate(initial(), 'w')).toBeCloseTo(0);
    const { positions } = playGame({ w: 2, b: 2 }, 3);
    for (const pos of positions) {
      expect(evaluate(pos, 'w')).toBeCloseTo(-evaluate(pos, 'b'));
    }
  });

  it('likes being ahead in a race and dislikes being on the bar', () => {
    const race = (whiteExtra: number): Position => ({
      points: [3 + whiteExtra, 3, 3, 3, 3 - whiteExtra, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -3, -3, -3, -3, -3],
      bar: { w: 0, b: 0 },
      off: { w: 0, b: 0 },
      turn: 'b',
    });
    expect(evaluate(race(2), 'w')).toBeGreaterThan(evaluate(race(0), 'w'));
    const hit = opening([[0, 'bar']]);
    expect(evaluate(hit, 'w')).toBeGreaterThan(0);
    expect(evaluate(hit, 'b')).toBeLessThan(0);
  });

  it('scores a finished game far above any position', () => {
    const won: Position = {
      points: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -5, -5, -5, 0, 0, 0],
      bar: { w: 0, b: 0 },
      off: { w: 15, b: 0 },
      turn: 'b',
    };
    expect(evaluate(won, 'w')).toBeGreaterThanOrEqual(1000);
    expect(evaluate(won, 'b')).toBeLessThanOrEqual(-1000);
  });
});
