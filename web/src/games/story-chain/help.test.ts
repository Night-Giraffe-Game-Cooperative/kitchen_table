import { describe, expect, it } from 'vitest';
import { BANDS } from '../bands';
import { helpFor, ideaFor, isStarter, lineHint, partOf, startersFor, writingTips } from './help';

describe('Story Chain help by age', () => {
  it('splits a story into a beginning, a middle and an end', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => partOf(n, 8))).toEqual(['beginning', 'beginning', 'middle', 'middle', 'middle', 'middle', 'end', 'end']);
  });

  it('gives the youngest the most help and 14 and up none, unless learn mode is on', () => {
    expect(BANDS.map((b) => helpFor(b, false))).toEqual([
      { openers: expect.arrayContaining(['Suddenly']), ideas: true, shape: true },
      { openers: expect.arrayContaining(['Suddenly,']), ideas: true, shape: true },
      { openers: [], ideas: true, shape: false },
      { openers: [], ideas: false, shape: false },
    ]);
    expect(helpFor('14+', true)).toMatchObject({ ideas: true, shape: true });
  });

  it('says which part of the story a line is, where the band shows it', () => {
    expect(lineHint(4, 8, helpFor('5-7', false), '5 lines to go.')).toBe('5 lines to go. The middle: Something goes wrong, or someone has a problem.');
    expect(lineHint(4, 8, helpFor('14+', false), '5 lines to go.')).toBe('5 lines to go.');
    expect(lineHint(8, 8, helpFor('14+', false), '1 line to go.')).toMatch(/very last line/);
  });

  it('knows its own story starts, so a new age band can swap one', () => {
    for (const b of BANDS) expect(startersFor[b].every(isStarter)).toBe(true);
    expect(isStarter('Our cat ran for prime minister.')).toBe(false);
  });

  it('never gives the same idea twice running', () => {
    for (let i = 0; i < 20; i++) expect(ideaFor('middle', 'Something goes wrong. What is it?')).not.toBe('Something goes wrong. What is it?');
  });

  it('offers the basics first, then what the part of the story needs', () => {
    expect(writingTips(1, 8).map((t) => t?.key)).toEqual(['first', undefined]);
    expect(writingTips(4, 8).map((t) => t?.key)).toEqual(['carry', 'problem']);
    expect(writingTips(8, 8).map((t) => t?.key)).toEqual(['carry', 'ending']);
  });
});
