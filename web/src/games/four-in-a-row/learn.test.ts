import { describe, expect, it } from 'vitest';
import { columnWords, fourBasics, hintFor, threatTips, turnTip } from './learn';

describe('hints', () => {
  it('points at a four first', () => {
    // Red can finish the bottom row in column 3 (and yellow wants column 4).
    const h = hintFor([0, 1, 1, 2, 2, 3, 2, 3, 3, 6]);
    expect(h?.col).toBe(3);
    expect(h?.text).toMatch(/Column 4 makes four/);
  });

  it('then at a four to block', () => {
    const h = hintFor([0, 6, 1, 6, 5, 6]);
    expect(h).toEqual({ col: 6, text: 'They could make four in column 7 next go. A counter of yours there stops them.' });
  });

  it('otherwise suggests a good column and says why', () => {
    const h = hintFor([3, 3, 2, 2]);
    expect([1, 4]).toContain(h?.col);
    expect(h?.text).toMatch(/^Try column [25]\. It adds to a line of yours\.$/);
    expect(hintFor([])?.text).toBe('Try column 4. Counters in the middle are part of the most lines of four.');
  });

  it('has nothing to say once the game is over', () => {
    expect(hintFor([0, 0, 1, 1, 2, 2, 3])).toBeNull();
  });
});

describe('tips', () => {
  it('names the star or the warning only when they are on the board', () => {
    expect(threatTips([0, 0, 1, 1, 2, 6], true).map((t) => t.key)).toEqual(['can-win']);
    expect(threatTips([0, 0, 1, 1, 2, 6], true)[0].text).toMatch(/star/);
    expect(threatTips([0, 0, 1, 1, 2, 6], false)[0].text).not.toMatch(/star/);
    expect(threatTips([0, 6, 1, 6, 5, 6], true)[0]).toMatchObject({ key: 'block' });
    expect(threatTips([0, 6, 1, 6, 5, 6], true)[0].text).toMatch(/warning sign/);
    expect(threatTips([3, 3], true)).toEqual([]);
  });

  it('warns about two fours at once, and about filling the space under theirs', () => {
    expect(threatTips([3, 3, 2, 2, 4], false).map((t) => t.key)).toEqual(['two-threats']);
    expect(threatTips([0, 0, 1, 1, 6, 2, 5, 2], false).map((t) => t.key)).toEqual(['gift']);
  });

  it('explains what the other side just did in learn mode', () => {
    expect(turnTip([], 'The computer')).toBeNull();
    expect(turnTip([3], 'The computer')?.text).toBe('The computer dropped a counter in column 4. Nobody can make four next go.');
    // Yellow blocks red's three across the bottom.
    expect(turnTip([0, 6, 1, 6, 2, 3], 'Mia')?.text).toBe('Mia dropped a counter in column 4. That blocked a line of yours. Nobody can make four next go.');
    expect(turnTip([3, 3, 2, 2, 4, 6], 'Mia')?.text).toMatch(/You could make four in columns 2 and 6!/);
    expect(turnTip([0, 6, 1, 6, 5, 6], 'The computer')?.text).toMatch(/they could make four in column 7\. A counter of yours there stops them\./);
  });

  it('gives each turn its own learn-mode tip', () => {
    expect(turnTip([3], 'Mia')?.key).not.toBe(turnTip([3, 3, 4], 'Mia')?.key);
  });

  it('writes columns out in words', () => {
    expect(columnWords([3])).toBe('column 4');
    expect(columnWords([0, 6])).toBe('columns 1 and 7');
    expect(columnWords([0, 2, 6])).toBe('columns 1, 3 and 7');
  });

  it('keeps the basics short', () => {
    expect(fourBasics.length).toBeGreaterThanOrEqual(4);
    expect(fourBasics.length).toBeLessThanOrEqual(6);
  });
});
