// Word Garden against each other: players take turns guessing letters of the
// same hidden word. A right letter grows a flower for each time it appears and
// you go again; a wrong one clouds a sun and passes the turn. Finishing a word
// earns a bonus bunch. Each player starts the same number of words, so nobody
// gets an extra first go.
import { leaders, listNames, nextSeat, placings, shuffle } from '../common';
import type { Band } from '../bands';
import { wordsFor, type Length } from './words';

export const LIVES = 7;
export const BONUS = 3;

/** Suns for a word: more for younger players. Games from before age bands have seven. */
export function livesFor(band?: Band): number {
  return band ? { '5-7': 9, '8-10': 8, '11-13': 7, '14+': 6 }[band] : LIVES;
}

export interface WordPick {
  word: string;
  emoji: string;
  category: string;
}

/** One go: a letter found or missed, or a guess at the whole word. */
export interface Turn {
  /** Seat that went. */
  s: string;
  k: 'hit' | 'miss' | 'solve' | 'wrong';
  /** The letter tried. */
  l?: string;
  /** The word guessed. */
  g?: string;
  /** Flowers won, the bonus included. */
  p: number;
  /** The bonus, when this go finished the word. */
  b?: number;
  /** Which word, from 0. */
  w: number;
}

export interface Played {
  word: string;
  emoji: string;
  /** Seat that finished it; null when the suns ran out. */
  by: string | null;
}

export interface VersusState {
  turn: string;
  words: WordPick[];
  /** The word being played, from 0; equal to words.length once all are done. */
  at: number;
  guessed: string[];
  wrong: string[];
  by: Record<string, string>; // letter -> seat that found it
  lives: number;
  scores: Record<string, number>; // seat -> flowers
  log: Turn[];
  played: Played[];
  /** Word size, in games from before age bands. */
  length?: Length;
  band?: Band;
  pick: string;
}

/** Different words for a game, topped up from every category if one runs short. */
export function chooseWords(category: string, size: Band | Length, count: number, random = Math.random): WordPick[] {
  const seen = new Set<string>();
  const pool = [...shuffle(wordsFor(category, size), random), ...shuffle(wordsFor('mixed', size), random), ...shuffle(wordsFor('mixed', 'any'), random)];
  const out: WordPick[] = [];
  for (const w of pool) {
    if (out.length >= count) break;
    if (seen.has(w.word)) continue;
    seen.add(w.word);
    out.push({ word: w.word, emoji: w.emoji, category: w.category });
  }
  return out;
}

export function newVersus(words: WordPick[], order: string[], o: { band?: Band; length?: Length; pick: string }): VersusState {
  return {
    turn: order[0],
    words,
    at: 0,
    guessed: [],
    wrong: [],
    by: {},
    lives: livesFor(o.band),
    scores: Object.fromEntries(order.map((s) => [s, 0])),
    log: [],
    played: [],
    ...(o.band ? { band: o.band } : { length: o.length ?? 'any' }),
    pick: o.pick,
  };
}

export const currentWord = (s: VersusState): string => s.words[s.at]?.word ?? '';
export const isOver = (s: VersusState): boolean => s.at >= s.words.length;
/** Who opens a word: each player in turn. */
export const starter = (order: string[], at: number): string => order[at % order.length];

export function missesOf(s: VersusState): number {
  const word = currentWord(s);
  return s.guessed.filter((ch) => !word.includes(ch)).length + s.wrong.length;
}

export function normalise(guess: string): string {
  return guess.toLowerCase().replace(/[^a-z]/g, '');
}

function add(scores: Record<string, number>, seat: string, n: number) {
  return { ...scores, [seat]: (scores[seat] ?? 0) + n };
}

function endWord(s: VersusState, order: string[], by: string | null): VersusState {
  const w = s.words[s.at];
  const at = s.at + 1;
  return {
    ...s,
    at,
    guessed: [],
    wrong: [],
    by: {},
    played: [...s.played, { word: w.word, emoji: w.emoji, by }],
    turn: at < s.words.length ? starter(order, at) : s.turn,
  };
}

/** A letter from the player whose turn it is; null if that isn't a fair go. */
export function guessLetter(s: VersusState, order: string[], seat: string, letter: string): VersusState | null {
  if (isOver(s) || s.turn !== seat || !/^[a-z]$/.test(letter) || s.guessed.includes(letter)) return null;
  const word = currentWord(s);
  const found = [...word].filter((ch) => ch === letter).length;
  const guessed = [...s.guessed, letter];

  if (!found) {
    const next = { ...s, guessed, turn: nextSeat(order, seat), log: [...s.log, { s: seat, k: 'miss' as const, l: letter, p: 0, w: s.at }] };
    return missesOf(next) >= next.lives ? endWord(next, order, null) : next;
  }

  const complete = [...word].every((ch) => guessed.includes(ch));
  const p = found + (complete ? BONUS : 0);
  const turn: Turn = { s: seat, k: 'hit', l: letter, p, w: s.at, ...(complete ? { b: BONUS } : {}) };
  const next = { ...s, guessed, by: { ...s.by, [letter]: seat }, scores: add(s.scores, seat, p), log: [...s.log, turn] };
  return complete ? endWord(next, order, seat) : next;
}

/** A guess at the whole word: the hidden letters and the bonus if right, the turn passes if not. */
export function solveWord(s: VersusState, order: string[], seat: string, guess: string): VersusState | null {
  const g = normalise(guess);
  const word = currentWord(s);
  if (isOver(s) || s.turn !== seat || g.length !== word.length) return null;

  if (g === word) {
    const hidden = [...word].filter((ch) => !s.guessed.includes(ch));
    const p = hidden.length + BONUS;
    const by = { ...s.by };
    for (const ch of hidden) by[ch] = seat;
    const next = {
      ...s,
      guessed: [...s.guessed, ...new Set(hidden)],
      by,
      scores: add(s.scores, seat, p),
      log: [...s.log, { s: seat, k: 'solve' as const, g, p, b: BONUS, w: s.at }],
    };
    return endWord(next, order, seat);
  }

  if (s.wrong.includes(g)) return null;
  const next = { ...s, wrong: [...s.wrong, g], turn: nextSeat(order, seat), log: [...s.log, { s: seat, k: 'wrong' as const, g, p: 0, w: s.at }] };
  return missesOf(next) >= next.lives ? endWord(next, order, null) : next;
}

/** Players best first, sharing a place on a tie. */
export function standings(s: VersusState, order: string[]) {
  return placings(order, (a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0)).map(({ item, place }) => ({ seat: item, place, flowers: s.scores[item] ?? 0 }));
}

export function winners(s: VersusState, order: string[]): string[] {
  return leaders(s.scores, order);
}

export const flowers = (n: number) => `${n} ${n === 1 ? 'flower' : 'flowers'}`;

/** The line posted to the chat at the end, e.g. "Mia won Word Garden with 14 flowers 🌻 (Dad 11)". */
export function versusSummary(s: VersusState, order: string[], name: (seat: string) => string): string {
  const top = winners(s, order);
  const best = s.scores[top[0]] ?? 0;
  const rest = standings(s, order)
    .filter((r) => !top.includes(r.seat))
    .map((r) => `${name(r.seat)} ${r.flowers}`);
  const tail = rest.length ? ` (${rest.join(', ')})` : '';
  const names = top.map(name);
  const head =
    top.length === 1
      ? `${names[0]} won Word Garden with ${flowers(best)} 🌻`
      : `${listNames(names)} tied at Word Garden with ${flowers(best)} each 🌻`;
  const line = head + tail;
  return line.length <= 200 ? line : head.slice(0, 200);
}
