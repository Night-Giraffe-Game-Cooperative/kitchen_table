import { describe, expect, it } from 'vitest';
import { BANDS } from '../bands';
import { LIVES, chooseWords, livesFor } from './versus';
import { categories, wordsFor } from './words';

describe('Word Garden words by age', () => {
  it('gives 5 to 7 short everyday words and 14 and up long or harder ones', () => {
    const young = wordsFor('mixed', '5-7');
    expect(young.every((w) => w.word.length <= 4 && !w.hard)).toBe(true);
    const old = wordsFor('mixed', '14+');
    expect(old.every((w) => (w.hard ? w.word.length >= 6 : w.word.length >= 9))).toBe(true);
    expect(wordsFor('mixed', '8-10').every((w) => !w.hard)).toBe(true);
  });

  it('has words for every category at every age', () => {
    for (const c of Object.keys(categories)) for (const b of BANDS) expect(wordsFor(c, b).length, `${c} ${b}`).toBeGreaterThanOrEqual(5);
  });

  it('keeps the old word sizes free of the harder words', () => {
    for (const size of ['short', 'any', 'long'] as const) expect(wordsFor('mixed', size).some((w) => w.hard)).toBe(false);
  });

  it('tops up a big game from other categories, never repeating a word', () => {
    const words = chooseWords('food', '5-7', 18);
    expect(words).toHaveLength(18);
    expect(new Set(words.map((w) => w.word)).size).toBe(18);
  });

  it('gives younger players more lives', () => {
    expect(BANDS.map(livesFor)).toEqual([9, 8, 7, 6]);
    expect(livesFor(undefined)).toBe(LIVES);
  });
});
