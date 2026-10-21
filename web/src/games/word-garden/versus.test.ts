import { describe, expect, it } from 'vitest';
import { BONUS, LIVES, chooseWords, guessLetter, isOver, missesOf, newVersus, solveWord, standings, starter, versusSummary, winners, type VersusState } from './versus';

const order = ['p1', 'p2'];
const words = [
  { word: 'tiger', emoji: '🐯', category: 'animals' },
  { word: 'bee', emoji: '🐝', category: 'animals' },
];
const fresh = () => newVersus(words, order, { length: 'short', pick: 'animals' });

function play(s: VersusState, seat: string, letters: string) {
  for (const l of letters) {
    const next = guessLetter(s, order, seat, l);
    if (!next) throw new Error(`${seat} couldn't play ${l}`);
    s = next;
  }
  return s;
}

describe('Word Garden versus', () => {
  it('starts with the first player and nobody scoring', () => {
    const s = fresh();
    expect(s.turn).toBe('p1');
    expect(s.scores).toEqual({ p1: 0, p2: 0 });
    expect(s.lives).toBe(LIVES);
  });

  it('a right letter scores and keeps the turn; a wrong one passes it', () => {
    let s = play(fresh(), 'p1', 'e');
    expect(s.scores.p1).toBe(1);
    expect(s.turn).toBe('p1');
    expect(s.by.e).toBe('p1');
    s = play(s, 'p1', 'z');
    expect(s.turn).toBe('p2');
    expect(missesOf(s)).toBe(1);
    expect(s.log.map((t) => t.k)).toEqual(['hit', 'miss']);
  });

  it('scores a letter for every time it appears', () => {
    let s = newVersus([{ word: 'bee', emoji: '🐝', category: 'animals' }], order, { length: 'short', pick: 'mixed' });
    s = play(s, 'p1', 'e');
    expect(s.scores.p1).toBe(2);
  });

  it('refuses a go out of turn or a letter already tried', () => {
    const s = play(fresh(), 'p1', 't');
    expect(guessLetter(s, order, 'p2', 'i')).toBeNull();
    expect(guessLetter(s, order, 'p1', 't')).toBeNull();
    expect(guessLetter(s, order, 'p1', 'TT')).toBeNull();
  });

  it('finishing a word with the last letter earns the bonus and the next player opens the next word', () => {
    let s = play(fresh(), 'p1', 'tige');
    s = play(s, 'p1', 'r');
    expect(s.scores.p1).toBe(5 + BONUS);
    expect(s.at).toBe(1);
    expect(s.played).toEqual([{ word: 'tiger', emoji: '🐯', by: 'p1' }]);
    expect(s.guessed).toEqual([]);
    expect(s.turn).toBe('p2');
    expect(s.log.at(-1)).toMatchObject({ k: 'hit', l: 'r', p: 1 + BONUS, b: BONUS });
  });

  it('solving the word scores each hidden letter and the bonus', () => {
    let s = play(fresh(), 'p1', 'ez');
    // Two hidden letters were already found by p1 (e); t, i, g, r are hidden.
    s = solveWord(s, order, 'p2', 'Tiger')!;
    expect(s.scores.p2).toBe(4 + BONUS);
    expect(s.played[0].by).toBe('p2');
    expect(s.turn).toBe('p2'); // p2 opens word two anyway
  });

  it('a wrong guess at the word passes the turn and clouds a sun', () => {
    let s = solveWord(fresh(), order, 'p1', 'tiles')!;
    expect(s.turn).toBe('p2');
    expect(missesOf(s)).toBe(1);
    expect(solveWord(s, order, 'p2', 'tiles')).toBeNull(); // already tried
    expect(solveWord(s, order, 'p2', 'cat')).toBeNull(); // wrong length
  });

  it('when the suns run out the word is lost, with no bonus, and the next word starts', () => {
    let s = fresh();
    const wrong = 'zxqwvub'; // seven letters not in TIGER
    for (const l of wrong) s = guessLetter(s, order, s.turn, l)!;
    expect(s.at).toBe(1);
    expect(s.played[0]).toEqual({ word: 'tiger', emoji: '🐯', by: null });
    expect(s.scores).toEqual({ p1: 0, p2: 0 });
    expect(s.turn).toBe('p2');
  });

  it('each player opens the same number of words', () => {
    expect([0, 1, 2, 3].map((at) => starter(['p1', 'p2'], at))).toEqual(['p1', 'p2', 'p1', 'p2']);
    expect([0, 1, 2].map((at) => starter(['p1', 'p2', 'p3'], at))).toEqual(['p1', 'p2', 'p3']);
  });

  it('ends after the last word and names the winner', () => {
    let s = play(fresh(), 'p1', 'tiger');
    s = play(s, 'p2', 'b');
    s = play(s, 'p2', 'e');
    expect(isOver(s)).toBe(true);
    expect(winners(s, order)).toEqual(['p1']);
    expect(standings(s, order)).toEqual([
      { seat: 'p1', place: 1, flowers: 8 },
      { seat: 'p2', place: 2, flowers: 6 },
    ]);
    const names: Record<string, string> = { p1: 'Mia', p2: 'Dad' };
    expect(versusSummary(s, order, (k) => names[k])).toBe('Mia won Word Garden with 8 flowers 🌻 (Dad 6)');
    expect(guessLetter(s, order, s.turn, 'a')).toBeNull();
  });

  it('a tie is shared', () => {
    const s = { ...fresh(), at: 2, scores: { p1: 4, p2: 4 } };
    expect(winners(s, order)).toEqual(['p1', 'p2']);
    expect(standings(s, order).map((r) => r.place)).toEqual([1, 1]);
    expect(versusSummary(s, order, (k) => (k === 'p1' ? 'Mum' : 'Gran'))).toBe('Mum and Gran tied at Word Garden with 4 flowers each 🌻');
  });

  it('chooses different words, topping up when a category is short', () => {
    const picked = chooseWords('animals', 'long', 40, () => 0.3);
    expect(picked).toHaveLength(40);
    expect(new Set(picked.map((w) => w.word)).size).toBe(40);
    expect(picked.slice(0, 5).every((w) => w.category === 'animals' && w.word.length >= 6)).toBe(true);
  });
});
