import { describe, expect, it } from 'vitest';
import { pickTips, stepTips, turnTips } from './learn';
import { applyMove, initial, legalFirstMoves, useDie, type Position } from './rules';

const keys = (tips: { key: string }[]) => tips.map((t) => t.key);

function position(points: Record<number, number>, extra: Partial<Position> = {}): Position {
  const p = initial('w');
  p.points = p.points.map((_, i) => points[i] ?? 0);
  return { ...p, ...extra };
}

describe('backgammon tips', () => {
  it('explains the race and the dice before the first roll', () => {
    expect(keys(turnTips(initial('w'), [], false))).toEqual(['race', 'dice']);
    expect(keys(turnTips(initial('w'), [3, 3, 3, 3], true))).toEqual(['doubles', 'race', 'dice']);
  });

  it('explains the bar and bearing off when they come up', () => {
    const hit = position({ 5: 5, 12: 4, 7: 3, 23: 2, 0: -2, 11: -5 }, { bar: { w: 1, b: 0 } });
    expect(keys(turnTips(hit, [4, 2], true))[0]).toBe('bar');
    const home = position({ 0: 5, 2: 5, 4: 5, 20: -15 });
    expect(keys(turnTips(home, [6, 5], true))[0]).toBe('bear-off');
  });

  it('points out a blot that can be hit', () => {
    const pos = position({ 12: 2, 9: -1, 0: -14 });
    const dests = legalFirstMoves(pos, [3, 1]).filter((m) => m.from === 12);
    expect(keys(pickTips(pos, dests))).toEqual(['pick:hit', 'pick:points']);
  });

  it('notices a hit, and a checker left on its own', () => {
    const pos = position({ 12: 2, 9: -1, 0: -14 });
    const move = legalFirstMoves(pos, [3, 1]).find((m) => m.from === 12 && m.to === 9)!;
    const after = applyMove(pos, move);
    expect(keys(stepTips(pos, move, after, useDie([3, 1], move)))).toEqual(['hit', 'blot']);
  });
});
