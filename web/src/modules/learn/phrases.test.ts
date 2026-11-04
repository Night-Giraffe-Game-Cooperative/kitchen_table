import { describe, expect, it } from 'vitest';
import { allPhrases, kanaList, kanaRows, keyOf, languages } from './phrases';
import { bingoLines, japanFacts, sleepsUntil, spots } from './japanFun';

// The server only keeps keys like these (Family.Phrases).
const serverKey = /^(ja|fr)\.[a-z0-9_.]{1,40}$/;

describe('holiday phrases', () => {
  for (const lang of languages) {
    const items = [...allPhrases(lang), ...lang.signs];

    it(`${lang.name}: every key is one the server keeps, and none repeat`, () => {
      const keys = items.map((p) => keyOf(lang.id, p.id));
      for (const k of keys) expect(k).toMatch(serverKey);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it(`${lang.name}: every phrase says what it means and how to say it`, () => {
      for (const p of items) {
        expect(p.en.trim()).not.toBe('');
        expect(p.text.trim()).not.toBe('');
        expect(p.say.trim()).not.toBe('');
      }
    });

    it(`${lang.name}: the youngest have something in every topic`, () => {
      for (const t of lang.topics) expect(t.phrases.some((p) => p.level === 1)).toBe(true);
    });
  }

  it('signs are only signs, apart from the phrases', () => {
    for (const lang of languages) for (const s of lang.signs) expect(s.id.startsWith('sign.')).toBe(true);
  });
});

describe('kana', () => {
  for (const script of ['hira', 'kata'] as const) {
    it(`${script}: all 46, each once, with keys the server keeps`, () => {
      const list = kanaList(script);
      expect(list).toHaveLength(46);
      expect(new Set(list.map((k) => k.char)).size).toBe(46);
      expect(new Set(list.map((k) => k.roman)).size).toBe(46);
      for (const k of list) expect(keyOf('ja', k.id)).toMatch(serverKey);
      expect(kanaRows(script).every((row) => row.length === 5)).toBe(true);
    });
  }
});

describe('getting excited for Japan', () => {
  it('counts sleeps by the calendar, whatever the time of day', () => {
    expect(sleepsUntil('2027-05-20', new Date(2026, 9, 26, 23, 59))).toBe(206);
    expect(sleepsUntil('2027-05-20', new Date(2027, 4, 19, 0, 1))).toBe(1);
    expect(sleepsUntil('2027-05-20', new Date(2027, 4, 20, 12))).toBe(0);
    expect(sleepsUntil('2027-05-20', new Date(2027, 4, 25))).toBe(-5);
  });

  it('has a full bingo card, with every spot saved under a key the server keeps', () => {
    expect(spots).toHaveLength(16);
    expect(bingoLines).toHaveLength(10);
    for (const s of spots) expect(keyOf('ja', `spot.${s.id}`)).toMatch(serverKey);
    expect(new Set(spots.map((s) => s.label)).size).toBe(16);
  });

  it('has a different fact for every day of a month', () => {
    expect(new Set(japanFacts).size).toBeGreaterThanOrEqual(31);
  });
});
