import { describe, expect, it } from 'vitest';
import { BANDS, bandOf, defaultBand, step, tipsFor } from './bands';

describe('age bands', () => {
  it('plays games from before age bands as 8 to 10', () => {
    expect(bandOf({})).toBe('8-10');
    expect(bandOf(null)).toBe('8-10');
    expect(bandOf({ band: 'grown-ups' })).toBe('8-10');
    expect(bandOf({ band: '14+' })).toBe('14+');
  });

  it('gives older age bands fewer tips', () => {
    expect(BANDS.map(tipsFor)).toEqual(['all', 'all', 'rules', 'none']);
  });

  it('steps from the youngest to the oldest', () => {
    expect(BANDS.map(step)).toEqual([0, 1, 2, 3]);
  });

  it('starts children on the youngest band and grown-ups on 8 to 10', () => {
    expect(defaultBand({ role: 'kid' })).toBe('5-7');
    expect(defaultBand({ role: 'grownup' })).toBe('8-10');
  });
});
