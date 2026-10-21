import { describe, expect, it } from 'vitest';
import { addLine, bestLines, canStar, everyoneStarred, markDone, newStory, standings, starWinners, storySummary, toggleStar, totals, type StoryVersus } from './versus';

const order = ['p1', 'p2'];
const ids: Record<string, number> = { p1: 1, p2: 2 };
const names: Record<number, string> = { 1: 'Mia', 2: 'Dad', 3: 'Gran' };
const name = (id: number) => names[id];

function written(lines: string[]): StoryVersus {
  let s = newStory('Once upon a time, a small dragon found a door.', 2, order);
  for (const text of lines) s = addLine(s, order, s.turn, ids[s.turn], text)!;
  return s;
}

describe('Story Chain versus', () => {
  it('takes turns, one line each, and everyone writes the same number', () => {
    let s = newStory('Once upon a time.', 2, order);
    expect(s.length).toBe(4);
    expect(s.turn).toBe('p1');
    s = addLine(s, order, 'p1', 1, '  The door   was blue. ')!;
    expect(s.lines).toEqual([{ u: 1, text: 'The door was blue.' }]);
    expect(s.turn).toBe('p2');
    expect(addLine(s, order, 'p1', 1, 'Again!')).toBeNull();
    expect(addLine(s, order, 'p2', 2, '   ')).toBeNull();
  });

  it('opens the stars once the last line is written', () => {
    const s = written(['a', 'b', 'c']);
    expect(s.phase).toBe('writing');
    const t = addLine(s, order, 'p2', 2, 'The end.')!;
    expect(t.phase).toBe('stars');
    expect(t.turn).toBe('anyone');
    expect(addLine(t, order, 'p1', 1, 'More')).toBeNull();
  });

  it("stars go to other people's lines, once each, and can be taken back", () => {
    let s = written(['a', 'b', 'c', 'd']);
    expect(canStar(s, 0, 1)).toBe(false); // Mia wrote line 0
    expect(toggleStar(s, 0, 1)).toBeNull();
    s = toggleStar(s, 0, 2)!;
    s = toggleStar(s, 0, 3)!; // Gran is reading along
    expect(s.stars[0]).toEqual([2, 3]);
    s = toggleStar(s, 0, 3)!;
    expect(s.stars[0]).toEqual([2]);
    expect(toggleStar(s, 9, 2)).toBeNull();
  });

  it('no stars while the story is still being written', () => {
    const s = written(['a']);
    expect(toggleStar(s, 0, 2)).toBeNull();
  });

  it('totals stars per writer and finds the best line', () => {
    let s = written(['Mia 1', 'Dad 1', 'Mia 2', 'Dad 2']);
    s = toggleStar(s, 0, 2)!;
    s = toggleStar(s, 2, 2)!;
    s = toggleStar(s, 2, 3)!;
    s = toggleStar(s, 3, 1)!;
    expect(totals(s, [1, 2])).toEqual({ 1: 3, 2: 1 });
    expect(standings(s, [1, 2])).toEqual([
      { id: 1, place: 1, stars: 3 },
      { id: 2, place: 2, stars: 1 },
    ]);
    expect(starWinners(s, [1, 2])).toEqual([1]);
    expect(bestLines(s)).toEqual([2]);
    expect(storySummary(s, [1, 2], name)).toBe(`Mia's lines got the most stars in Story Chain (3 stars) 🌟 Best line, by Mia: "Mia 2"`);
  });

  it('shares the win on a tie, and handles a story with no stars', () => {
    let s = written(['a', 'b', 'c', 'd']);
    expect(starWinners(s, [1, 2])).toEqual([]);
    expect(bestLines(s)).toEqual([]);
    expect(storySummary(s, [1, 2], name)).toBe('Mia and Dad finished a story: "Once upon a time, a small dragon found a door."');
    s = toggleStar(toggleStar(s, 0, 2)!, 1, 1)!;
    expect(starWinners(s, [1, 2])).toEqual([1, 2]);
    expect(bestLines(s)).toEqual([0, 1]);
    expect(storySummary(s, [1, 2], name)).toMatch(/^Mia and Dad shared the most stars in Story Chain 🌟 Best line, by Mia: "a"$/);
  });

  it('keeps the chat line short, trimming a long best line', () => {
    let s = written(['x'.repeat(240), 'b', 'c', 'd']);
    s = toggleStar(s, 0, 2)!;
    const line = storySummary(s, [1, 2], name);
    expect(line.length).toBeLessThanOrEqual(200);
    expect(line.endsWith('…"')).toBe(true);
  });

  it('is done when every player has given their stars', () => {
    let s = written(['a', 'b', 'c', 'd']);
    expect(everyoneStarred(s, [1, 2])).toBe(false);
    s = markDone(s, 1)!;
    expect(markDone(s, 1)).toBeNull();
    s = markDone(s, 3)!; // a reader, not a player
    expect(everyoneStarred(s, [1, 2])).toBe(false);
    s = markDone(s, 2)!;
    expect(everyoneStarred(s, [1, 2])).toBe(true);
  });
});
