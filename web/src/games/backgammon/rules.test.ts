import { describe, expect, it } from 'vitest';
import {
  applyMove,
  canBearOff,
  canMove,
  count,
  destination,
  diceFor,
  endTurn,
  initial,
  legalFirstMoves,
  legalOutcomes,
  legalSequences,
  owner,
  pipCount,
  rollDice,
  useDie,
  winKind,
  winner,
} from './rules';
import type { Move, Position, Side } from './rules';

// Seeded generator (mulberry32) so the property tests are repeatable.
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

interface Spec {
  w?: Record<number, number>;
  b?: Record<number, number>;
  bar?: { w?: number; b?: number };
  off?: { w?: number; b?: number };
  turn?: Side;
}

const BLACK_HOME = { 23: 15 };
const WHITE_HOME = { 0: 15 };

// Builds a position from the checkers listed; any of a side's 15 not placed are taken as already borne off.
function make(spec: Spec): Position {
  const points = new Array<number>(24).fill(0);
  for (const [i, n] of Object.entries(spec.w ?? {})) points[Number(i)] += n;
  for (const [i, n] of Object.entries(spec.b ?? {})) points[Number(i)] -= n;
  const bar = { w: spec.bar?.w ?? 0, b: spec.bar?.b ?? 0 };
  const onBoard = (side: Side): number =>
    points.reduce((sum, n) => sum + (side === 'w' ? Math.max(n, 0) : Math.max(-n, 0)), 0) + bar[side];
  const off = { w: spec.off?.w ?? 15 - onBoard('w'), b: spec.off?.b ?? 15 - onBoard('b') };
  return { points, bar, off, turn: spec.turn ?? 'w' };
}

function checkers(pos: Position, side: Side): number {
  let n = pos.bar[side] + pos.off[side];
  for (const c of pos.points) if ((side === 'w' && c > 0) || (side === 'b' && c < 0)) n += Math.abs(c);
  return n;
}

const moveKey = (m: Move): string => `${m.from}>${m.to}:${m.die}`;
const sorted = (moves: Move[]): string[] => moves.map(moveKey).sort();
const finalOf = (pos: Position, seq: Move[]): string => JSON.stringify(seq.reduce(applyMove, pos));

// ---------------------------------------------------------------------------------------------------------------
// A deliberately naive reference: tries every die in every order with its own move rules, no shortcuts.

function refSteps(pos: Position, die: number): Move[] {
  const side = pos.turn;
  const mine = (i: number): boolean => (side === 'w' ? pos.points[i] > 0 : pos.points[i] < 0);
  const open = (i: number): boolean => (side === 'w' ? pos.points[i] >= -1 : pos.points[i] <= 1);
  if (pos.bar[side] > 0) {
    const to = side === 'w' ? 24 - die : die - 1;
    return open(to) ? [{ from: 'bar', to, die }] : [];
  }
  const home = side === 'w' ? [0, 1, 2, 3, 4, 5] : [18, 19, 20, 21, 22, 23];
  const inHome = home.reduce((n, i) => n + (mine(i) ? Math.abs(pos.points[i]) : 0), 0) + pos.off[side];
  const out: Move[] = [];
  for (let from = 0; from < 24; from++) {
    if (!mine(from)) continue;
    const to = side === 'w' ? from - die : from + die;
    if (to >= 0 && to < 24) {
      if (open(to)) out.push({ from, to, die });
      continue;
    }
    if (inHome !== 15) continue;
    const needed = side === 'w' ? from + 1 : 24 - from;
    const behind = home.some((i) => mine(i) && (side === 'w' ? i > from : i < from));
    if (die === needed || (die > needed && !behind)) out.push({ from, to: 'off', die });
  }
  return out;
}

function refAll(pos: Position, dice: number[]): Move[][] {
  if (pos.off.w === 15 || pos.off.b === 15) return [[]];
  const out: Move[][] = [];
  for (let i = 0; i < dice.length; i++) {
    if (dice.indexOf(dice[i]) !== i) continue;
    const rest = dice.filter((_, j) => j !== i);
    for (const m of refSteps(pos, dice[i])) {
      for (const tail of refAll(applyMove(pos, m), rest)) out.push([m, ...tail]);
    }
  }
  return out.length ? out : [[]];
}

function refMaximal(pos: Position, dice: number[]): Move[][] {
  const all = refAll(pos, dice);
  const longest = Math.max(...all.map((s) => s.length));
  if (longest === 0) return [];
  let seqs = all.filter((s) => s.length === longest);
  if (longest === 1) {
    const top = Math.max(...seqs.map((s) => s[0].die));
    seqs = seqs.filter((s) => s[0].die === top);
  }
  return seqs;
}

// ---------------------------------------------------------------------------------------------------------------

describe('initial position', () => {
  it('has 15 checkers and 167 pips each', () => {
    const pos = initial();
    expect(pipCount(pos, 'w')).toBe(167);
    expect(pipCount(pos, 'b')).toBe(167);
    expect(checkers(pos, 'w')).toBe(15);
    expect(checkers(pos, 'b')).toBe(15);
    expect(pos.turn).toBe('w');
    expect(initial('b').turn).toBe('b');
  });

  it('reports owners and counts', () => {
    const pos = initial();
    expect(owner(pos, 23)).toBe('w');
    expect(owner(pos, 0)).toBe('b');
    expect(owner(pos, 1)).toBeNull();
    expect(count(pos, 12)).toBe(5);
    expect(count(pos, 11)).toBe(5);
    expect(count(pos, 1)).toBe(0);
  });
});

describe('dice', () => {
  it('rolls two dice from 1 to 6', () => {
    expect(rollDice(() => 0)).toEqual([1, 1]);
    expect(rollDice(() => 0.9999999)).toEqual([6, 6]);
    const random = seeded(1);
    for (let i = 0; i < 200; i++) {
      for (const d of rollDice(random)) expect(d >= 1 && d <= 6 && Number.isInteger(d)).toBe(true);
    }
  });

  it('gives four dice for doubles', () => {
    expect(diceFor([3, 3])).toEqual([3, 3, 3, 3]);
    expect(diceFor([5, 2])).toEqual([5, 2]);
  });

  it('removes one used die', () => {
    expect(useDie([4, 4, 4, 4], { from: 12, to: 8, die: 4 })).toEqual([4, 4, 4]);
    expect(useDie([6, 1], { from: 12, to: 11, die: 1 })).toEqual([6]);
  });
});

describe('opening moves', () => {
  it('3-1 for White includes 8/5 6/5', () => {
    const pos = initial();
    const seqs = legalSequences(pos, diceFor([3, 1]));
    const want = sorted([
      { from: 7, to: 4, die: 3 },
      { from: 5, to: 4, die: 1 },
    ]);
    expect(seqs.some((s) => JSON.stringify(sorted(s)) === JSON.stringify(want))).toBe(true);
    const first = legalFirstMoves(pos, [3, 1]).map(moveKey);
    expect(first).toContain('7>4:3');
    expect(first).toContain('5>4:1');
    expect(seqs.every((s) => s.length === 2)).toBe(true);
  });

  it('6-6 gives four moves, including 24/18(2) 13/7(2)', () => {
    const pos = initial();
    const seqs = legalSequences(pos, diceFor([6, 6]));
    expect(seqs.length).toBeGreaterThan(0);
    expect(seqs.every((s) => s.length === 4)).toBe(true);
    const want = JSON.stringify(sorted([23, 23, 12, 12].map((from) => ({ from, to: from - 6, die: 6 }))));
    expect(seqs.some((s) => JSON.stringify(sorted(s)) === want)).toBe(true);
  });

  it('deduplicates sequences that reach the same position', () => {
    for (const roll of [[3, 1], [6, 6], [2, 2], [5, 4]] as Array<[number, number]>) {
      const pos = initial();
      const finals = legalSequences(pos, diceFor(roll)).map((s) => finalOf(pos, s));
      expect(new Set(finals).size).toBe(finals.length);
      const ref = new Set(refMaximal(pos, diceFor(roll)).map((s) => finalOf(pos, s)));
      expect(new Set(finals)).toEqual(ref);
    }
  });

  it('Black moves the other way', () => {
    const pos = initial('b');
    const first = legalFirstMoves(pos, [6, 5]).map(moveKey);
    expect(first).toContain('0>6:6');
    expect(first).toContain('11>16:5');
    // White's five checkers on 5 block the 5 from Black's back checkers.
    expect(first).not.toContain('0>5:5');
    const finals = legalSequences(pos, [6, 5]).map((s) => finalOf(pos, s));
    const leap: Move[] = [
      { from: 0, to: 6, die: 6 },
      { from: 6, to: 11, die: 5 },
    ];
    expect(finals).toContain(finalOf(pos, leap));
  });
});

describe('the bar', () => {
  it('a checker on the bar must enter before any other move', () => {
    const pos = make({ w: { 23: 1, 12: 5, 7: 3, 5: 5 }, b: { 0: 2, 11: 5, 16: 3, 18: 5 }, bar: { w: 1 } });
    // The 6 would land on Black's 5 checkers on 18, so only the 5 can bring it in (to 19).
    expect(legalFirstMoves(pos, [6, 5])).toEqual([{ from: 'bar', to: 19, die: 5 }]);
    const seqs = legalSequences(pos, [6, 5]);
    expect(seqs.length).toBeGreaterThan(0);
    for (const s of seqs) expect(s[0]).toEqual({ from: 'bar', to: 19, die: 5 });
    expect(() => applyMove(pos, { from: 12, to: 6, die: 6 })).toThrow();
  });

  it('has no legal moves against a closed home board', () => {
    const pos = make({
      w: { 12: 5, 7: 3, 5: 5, 4: 1 },
      b: { 0: 2, 18: 3, 19: 2, 20: 2, 21: 2, 22: 2, 23: 2 },
      bar: { w: 1 },
    });
    for (let a = 1; a <= 6; a++) {
      for (let b = a; b <= 6; b++) {
        const dice = diceFor([a, b]);
        expect(legalSequences(pos, dice)).toEqual([]);
        expect(legalFirstMoves(pos, dice)).toEqual([]);
        expect(canMove(pos, dice)).toBe(false);
      }
    }
  });

  it('enters only as many checkers as it can', () => {
    // Two on the bar and only the 4 lets one in, so the 2 is lost.
    const pos = make({
      w: { 12: 5, 7: 3, 5: 5 },
      b: { 0: 2, 10: 2, 18: 3, 19: 2, 21: 2, 22: 2, 23: 2 },
      bar: { w: 2 },
    });
    expect(legalSequences(pos, [4, 2])).toEqual([[{ from: 'bar', to: 20, die: 4 }]]);
    // With 4-4 both come in and two more fours are played.
    const seqs = legalSequences(pos, diceFor([4, 4]));
    expect(seqs.every((s) => s.length === 4 && s[0].from === 'bar' && s[1].from === 'bar')).toBe(true);
  });

  it('entering on a blot hits it', () => {
    const pos = make({ w: { 12: 5, 7: 3, 5: 6 }, b: { 0: 2, 11: 5, 16: 3, 18: 4, 19: 1 }, bar: { w: 1 } });
    expect(destination(pos, 'bar', 5, 'w')).toBe(19);
    const after = applyMove(pos, { from: 'bar', to: 19, die: 5 });
    expect(after.points[19]).toBe(1);
    expect(after.bar).toEqual({ w: 0, b: 1 });
    expect(checkers(after, 'w')).toBe(15);
    expect(checkers(after, 'b')).toBe(15);
    // Black enters on White's side of the board at die - 1.
    expect(destination(endTurn(after), 'bar', 3, 'b')).toBe(2);
  });
});

describe('using the dice', () => {
  it('must use both dice when some sequence allows it', () => {
    // Only the checkers on 20 and 7 can move. Playing 7/4 with the 3 first would leave the 6 unplayable,
    // so it is not allowed; 20/17 then 7/1 uses both dice.
    const pos = make({ w: { 20: 1, 7: 1, 0: 13 }, b: { 14: 2, 11: 2, 23: 11 } });
    const first = legalFirstMoves(pos, [6, 3]).map(moveKey).sort();
    expect(first).toEqual(['20>17:3', '7>1:6']);
    const seqs = legalSequences(pos, [6, 3]);
    expect(seqs.length).toBe(1);
    expect(sorted(seqs[0])).toEqual(['20>17:3', '7>1:6']);
    // applyMove only checks the single move; legalFirstMoves is what enforces the dice rules.
    expect(applyMove(pos, { from: 7, to: 4, die: 3 }).points[4]).toBe(1);
  });

  it('when only one die can be used, the larger is forced if playable', () => {
    // From 20 either 20/14 or 20/17 is possible, but never both (11 is blocked): the 6 must be played.
    const pos = make({ w: { 20: 1, 0: 14 }, b: { 11: 2, 23: 13 } });
    expect(legalSequences(pos, [3, 6])).toEqual([[{ from: 20, to: 14, die: 6 }]]);
    expect(legalFirstMoves(pos, [3, 6])).toEqual([{ from: 20, to: 14, die: 6 }]);
    // After it, the 3 cannot be played.
    const after = applyMove(pos, { from: 20, to: 14, die: 6 });
    expect(canMove(after, [3])).toBe(false);
  });

  it('plays the smaller die when the larger cannot be played', () => {
    const pos = make({ w: { 20: 1, 0: 14 }, b: { 14: 2, 11: 2, 23: 11 } });
    expect(legalSequences(pos, [6, 3])).toEqual([[{ from: 20, to: 17, die: 3 }]]);
    expect(legalFirstMoves(pos, [6, 3])).toEqual([{ from: 20, to: 17, die: 3 }]);
  });

  it('plays as many of the four moves of a double as possible', () => {
    const pos = make({ w: { 20: 1, 0: 14 }, b: { 8: 2, 23: 13 } });
    const seqs = legalSequences(pos, diceFor([4, 4]));
    expect(seqs).toEqual([
      [
        { from: 20, to: 16, die: 4 },
        { from: 16, to: 12, die: 4 },
      ],
    ]);
  });
});

describe('bearing off', () => {
  it('bears off with the exact die', () => {
    const pos = make({ w: { 2: 2, 4: 1 }, b: BLACK_HOME });
    expect(canBearOff(pos, 'w')).toBe(true);
    expect(destination(pos, 2, 3, 'w')).toBe('off');
    expect(legalFirstMoves(pos, [3, 1]).map(moveKey)).toContain('2>off:3');
    const after = applyMove(pos, { from: 2, to: 'off', die: 3 });
    expect(after.off.w).toBe(13);
    expect(after.points[2]).toBe(1);
  });

  it('bears off with a higher die from the highest point', () => {
    const pos = make({ w: { 3: 2, 1: 1 }, b: BLACK_HOME });
    expect(destination(pos, 3, 6, 'w')).toBe('off');
    const first = legalFirstMoves(pos, [6, 5]).map(moveKey);
    expect(first).toContain('3>off:6');
    expect(first).toContain('3>off:5');
    expect(first).not.toContain('1>off:6');
  });

  it('does not bear off with a higher die while a checker sits on a higher point', () => {
    const pos = make({ w: { 3: 2, 1: 1 }, b: BLACK_HOME });
    expect(destination(pos, 1, 6, 'w')).toBeNull();
    // Black's mirror image: home is 18..23 and 20 is further back than 22.
    const black = make({ w: WHITE_HOME, b: { 20: 1, 22: 2 }, turn: 'b' });
    expect(destination(black, 20, 6, 'b')).toBe('off');
    expect(destination(black, 22, 6, 'b')).toBeNull();
    expect(destination(black, 22, 2, 'b')).toBe('off');
  });

  it('does not bear off while a checker is outside the home board', () => {
    const pos = make({ w: { 7: 1, 2: 2 }, b: BLACK_HOME });
    expect(canBearOff(pos, 'w')).toBe(false);
    expect(destination(pos, 2, 3, 'w')).toBeNull();
    expect(legalFirstMoves(pos, [3, 6]).map(moveKey)).not.toContain('2>off:3');
    // Bringing the last checker home first makes bearing off legal in the same turn.
    const seqs = legalSequences(pos, [3, 6]).map(sorted);
    expect(seqs).toContainEqual(['2>off:3', '7>1:6']);
    // A checker on the bar also stops bearing off.
    expect(canBearOff(make({ w: { 2: 2 }, b: BLACK_HOME, bar: { w: 1 } }), 'w')).toBe(false);
  });
});

describe('winning', () => {
  it('finds the winner and the kind of win', () => {
    expect(winner(initial())).toBeNull();
    expect(winKind(initial())).toBeNull();
    const single = make({ b: { 20: 3 } });
    expect(winner(single)).toBe('w');
    expect(winKind(single)).toBe('single');
    const gammon = make({ b: { 20: 10, 12: 5 }, off: { w: 15, b: 0 } });
    expect(winKind(gammon)).toBe('gammon');
    const inHome = make({ b: { 20: 10, 12: 4, 3: 1 }, off: { w: 15, b: 0 } });
    expect(winKind(inHome)).toBe('backgammon');
    const onBar = make({ b: { 20: 14 }, bar: { b: 1 }, off: { w: 15, b: 0 } });
    expect(winKind(onBar)).toBe('backgammon');
    const blackWins = make({ w: { 20: 2, 3: 13 }, off: { w: 0, b: 15 } });
    expect(winner(blackWins)).toBe('b');
    expect(winKind(blackWins)).toBe('backgammon');
  });

  it('stops all moves once someone has won', () => {
    const pos = make({ b: { 20: 3 }, turn: 'b' });
    expect(legalSequences(pos, [6, 5])).toEqual([]);
    expect(canMove(pos, [6, 5])).toBe(false);
  });

  it('bearing off the last checker ends the sequence', () => {
    const pos = make({ w: { 0: 1 }, b: BLACK_HOME });
    // Either die bears it off, but the larger one must be used.
    expect(legalSequences(pos, [6, 1])).toEqual([[{ from: 0, to: 'off', die: 6 }]]);
    expect(winner(applyMove(pos, { from: 0, to: 'off', die: 6 }))).toBe('w');
  });
});

describe('purity', () => {
  it('never mutates the position it is given', () => {
    const freeze = (pos: Position): Position => {
      Object.freeze(pos.points);
      Object.freeze(pos.bar);
      Object.freeze(pos.off);
      return Object.freeze(pos);
    };
    const pos = freeze(make({ w: { 23: 2, 12: 5, 7: 3, 5: 5 }, b: { 0: 2, 11: 5, 16: 3, 18: 4, 19: 1 }, bar: {} }));
    const before = JSON.stringify(pos);
    legalSequences(pos, diceFor([5, 5]));
    legalFirstMoves(pos, [5, 4]);
    legalOutcomes(pos, [5, 4]);
    canMove(pos, [5, 4]);
    const after = applyMove(pos, { from: 23, to: 19, die: 4 });
    endTurn(pos);
    expect(JSON.stringify(pos)).toBe(before);
    expect(after).not.toBe(pos);
    expect(JSON.parse(JSON.stringify(after))).toEqual(after);
  });
});

describe('one checker at a time', () => {
  interface Seen {
    turns: number;
    entered: number;
    hits: number;
    noMove: number;
    someDiceLost: number;
    largerForced: number;
    bigDieBearOff: number;
  }

  // Random self-play, choosing single moves only from legalFirstMoves, must always finish one of the
  // maximal sequences, and the engine must agree with the naive reference above.
  function playRandomGames(games: number, seed: number, compareWithReference: boolean): Seen {
    const random = seeded(seed);
    const seen: Seen = { turns: 0, entered: 0, hits: 0, noMove: 0, someDiceLost: 0, largerForced: 0, bigDieBearOff: 0 };
    for (let g = 0; g < games; g++) {
      let pos = initial(random() < 0.5 ? 'w' : 'b');
      while (!winner(pos)) {
        const dice = diceFor(rollDice(random));
        const seqs = legalSequences(pos, dice);
        const longest = seqs.length ? seqs[0].length : 0;
        const finals = seqs.map((s) => finalOf(pos, s));
        expect(seqs.every((s) => s.length === longest)).toBe(true);
        expect(new Set(finals).size).toBe(finals.length);
        expect(canMove(pos, dice)).toBe(seqs.length > 0);
        if (longest === 0) seen.noMove++;
        else if (longest < dice.length) seen.someDiceLost++;
        if (longest === 1 && dice[0] !== dice[1] && canMove(pos, [Math.min(...dice)])) {
          if (seqs.every((s) => s[0].die === Math.max(...dice))) seen.largerForced++;
        }

        if (compareWithReference) {
          const ref = refMaximal(pos, dice);
          expect(new Set(finals)).toEqual(new Set(ref.map((s) => finalOf(pos, s))));
          const refFirst = new Set(ref.map((s) => moveKey(s[0])));
          expect(new Set(legalFirstMoves(pos, dice).map(moveKey))).toEqual(refFirst);
        }

        let cur = pos;
        let left = dice;
        let played = 0;
        for (;;) {
          const first = legalFirstMoves(cur, left);
          expect(first.length > 0).toBe(canMove(cur, left) && played < longest);
          if (first.length === 0) break;
          const keys = first.map(moveKey);
          expect(new Set(keys).size).toBe(keys.length);
          const move = first[Math.floor(random() * first.length)];
          const next = applyMove(cur, move);
          const foe = cur.turn === 'w' ? 'b' : 'w';
          if (move.from === 'bar') seen.entered++;
          if (next.bar[foe] > cur.bar[foe]) seen.hits++;
          if (move.to === 'off' && typeof move.from === 'number') {
            const needed = cur.turn === 'w' ? move.from + 1 : 24 - move.from;
            if (move.die > needed) seen.bigDieBearOff++;
          }
          cur = next;
          left = useDie(left, move);
          played++;
          expect(checkers(cur, 'w')).toBe(15);
          expect(checkers(cur, 'b')).toBe(15);
        }
        expect(played).toBe(longest);
        if (longest > 0) expect(finals).toContain(JSON.stringify(cur));
        pos = endTurn(cur);
        seen.turns++;
      }
    }
    return seen;
  }

  it('stays inside the maximal sequences over many random games', () => {
    const seen = playRandomGames(60, 2024, false);
    // Make sure the games actually went through the awkward cases.
    for (const [what, n] of Object.entries(seen)) expect(n, what).toBeGreaterThan(5);
    // 60 whole games: a few seconds normally, longer on a busy PC.
  }, 30_000);

  it('matches a naive reference implementation', () => {
    const seen = playRandomGames(25, 7, true);
    expect(seen.turns).toBeGreaterThan(500);
  });
});
