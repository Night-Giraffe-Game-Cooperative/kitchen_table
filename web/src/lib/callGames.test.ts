import { describe, expect, it } from 'vitest';
import {
  ACT_SECONDS,
  actWords,
  endTurn,
  familyTotal,
  faces,
  favourites,
  gotIt,
  newFace,
  nextActor,
  pickFresh,
  skipWord,
  startAct,
  toggleStar,
} from './callGames';

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe('pickFresh', () => {
  it('never repeats until everything has been used', () => {
    let used: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const r = pickFresh(['a', 'b', 'c', 'd'], used);
      expect(seen.has(r.item)).toBe(false);
      seen.add(r.item);
      used = r.used;
    }
    const again = pickFresh(['a', 'b', 'c', 'd'], used);
    expect(again.used).toEqual([again.item]);
  });
});

describe('Pull a Face', () => {
  it('counts rounds and picks new faces', () => {
    const one = newFace(null, seq(0));
    const two = newFace(one, seq(0));
    expect(one.round).toBe(1);
    expect(two.round).toBe(2);
    expect(two.prompt).not.toBe(one.prompt);
    expect(faces).toContain(two.prompt);
  });

  it('stars toggle, and nobody stars their own photo', () => {
    let g = newFace(null);
    g = toggleStar(g, 'peer-a', 1, 2);
    g = toggleStar(g, 'peer-a', 1, 3);
    g = toggleStar(g, 'peer-b', 2, 1);
    g = toggleStar(g, 'peer-b', 2, 2);
    expect(g.stars).toEqual({ 'peer-a': [2, 3], 'peer-b': [1] });
    expect(favourites(g)).toEqual(['peer-a']);
    g = toggleStar(g, 'peer-a', 1, 3);
    expect(favourites(g).sort()).toEqual(['peer-a', 'peer-b']);
    expect(favourites(newFace(null))).toEqual([]);
  });
});

describe('Act It Out', () => {
  it('scores words for the actor and keeps the family best', () => {
    let g = startAct(7, null, seq(0));
    expect(g.remainingMs).toBe(ACT_SECONDS * 1000);
    expect(actWords).toContain(g.word);
    const first = g.word;
    g = gotIt(g, 50_000, seq(0));
    expect(g.word).not.toBe(first);
    g = gotIt(g, 40_000);
    g = skipWord(g, 30_000);
    expect(g).toMatchObject({ got: 2, skipped: 1, remainingMs: 30_000, scores: { '7': 2 } });
    g = endTurn(g);
    expect(g).toMatchObject({ phase: 'between', best: 2, remainingMs: 0 });

    // The next turn keeps scores and the best, and resets the count.
    g = startAct(9, g);
    expect(g).toMatchObject({ actor: 9, got: 0, best: 2, turn: 2, scores: { '7': 2 } });
    g = endTurn(gotIt(g, 1000));
    expect(familyTotal(g)).toBe(3);
    expect(g.best).toBe(2);
  });

  it('passes the turn round everyone in the call', () => {
    const g = startAct(5, null);
    expect(nextActor(g, [9, 5, 2])).toBe(9);
    expect(nextActor({ ...g, actor: 9 }, [9, 5, 2, 5])).toBe(2);
    expect(nextActor({ ...g, actor: 4 }, [2, 9])).toBe(9);
    expect(nextActor(g, [])).toBe(5);
  });
});
