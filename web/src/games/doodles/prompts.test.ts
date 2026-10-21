import { describe, expect, it } from 'vitest';
import { BANDS } from '../bands';
import { isPrompt, promptsFor } from './prompts';

describe('doodle ideas by age', () => {
  it('has plenty of different ideas for every age', () => {
    for (const b of BANDS) {
      expect(promptsFor[b].length).toBeGreaterThanOrEqual(15);
      expect(new Set(promptsFor[b]).size).toBe(promptsFor[b].length);
    }
  });

  it('knows its own ideas, so a new age band can swap one but leaves your own', () => {
    expect(isPrompt('a cat')).toBe(true);
    expect(isPrompt(' the smell of rain ')).toBe(true);
    expect(isPrompt('our dog Biscuit')).toBe(false);
  });
});
