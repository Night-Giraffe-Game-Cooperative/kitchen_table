// Pairs rules. Every picture is on two cards, dealt face down. Turn over one
// card and then another: a match stays face up and belongs to whoever found it;
// a miss stays up for everyone to see until the next card is tapped, which
// turns the two back over first. Together, the family finds every pair in as
// few turns as it can. Taking turns, a pair scores and earns another go, a miss
// passes the turn, and the most pairs wins.
import { leaders, listNames, nextSeat, placings, shuffle } from '../common';
import type { Band } from '../bands';
import type { Picture } from '../photos';

export type PictureSet = 'photos' | 'animals' | 'treats';

/** One picture, on two cards. */
export interface Face {
  /** What it's called when read out: "a fox", or "Photo 2". */
  name: string;
  emoji?: string;
  /** A family photo. */
  url?: string;
}

/** Who found a pair: the seat taking turns, or the person's id together. */
export type Finder = string | number;

export interface PairsState {
  /** 'anyone' together; the seat whose turn it is when taking turns. */
  turn: string;
  set: PictureSet;
  /** The chat's photos the cards were made from, for playing again. Empty for animals and treats. */
  photos: Picture[];
  faces: Face[];
  /** cards[i] = which face card i shows. */
  cards: number[];
  /** Turned over and not matched: one card, or two that didn't match. */
  up: number[];
  /** found[i] = who found card i's pair, or null while it's still to find. */
  found: (Finder | null)[];
  /** Cards that have been turned over at least once. */
  seen: number[];
  /** Turns taken: two cards each. */
  turns: number;
  /** Person id -> cards they turned over. */
  by: Record<string, number>;
  /** The cards of the latest turn, and who turned the latest one. */
  last: { by: number; cards: number[] } | null;
  band?: Band;
  ended?: string;
}

interface Item {
  e: string;
  name: string;
}

export const ANIMALS: Item[] = [
  { e: '🦊', name: 'a fox' },
  { e: '🐶', name: 'a dog' },
  { e: '🐱', name: 'a cat' },
  { e: '🐰', name: 'a rabbit' },
  { e: '🐻', name: 'a bear' },
  { e: '🐼', name: 'a panda' },
  { e: '🐨', name: 'a koala' },
  { e: '🐯', name: 'a tiger' },
  { e: '🦁', name: 'a lion' },
  { e: '🐮', name: 'a cow' },
  { e: '🐷', name: 'a pig' },
  { e: '🐸', name: 'a frog' },
  { e: '🐵', name: 'a monkey' },
  { e: '🐔', name: 'a chicken' },
  { e: '🐧', name: 'a penguin' },
  { e: '🦉', name: 'an owl' },
  { e: '🐢', name: 'a turtle' },
  { e: '🐙', name: 'an octopus' },
  { e: '🦋', name: 'a butterfly' },
  { e: '🐝', name: 'a bee' },
  { e: '🦒', name: 'a giraffe' },
  { e: '🐘', name: 'an elephant' },
  { e: '🦔', name: 'a hedgehog' },
  { e: '🐞', name: 'a ladybird' },
];

/** Things the Night Giraffe might find left out on the step. */
export const TREATS: Item[] = [
  { e: '🍓', name: 'a strawberry' },
  { e: '🍌', name: 'a banana' },
  { e: '🍎', name: 'an apple' },
  { e: '🍉', name: 'a slice of watermelon' },
  { e: '🍇', name: 'a bunch of grapes' },
  { e: '🍍', name: 'a pineapple' },
  { e: '🍐', name: 'a pear' },
  { e: '🍊', name: 'an orange' },
  { e: '🥕', name: 'a carrot' },
  { e: '🍪', name: 'a biscuit' },
  { e: '🧁', name: 'a cupcake' },
  { e: '🍩', name: 'a doughnut' },
  { e: '🍦', name: 'an ice cream' },
  { e: '🍰', name: 'a slice of cake' },
  { e: '🍫', name: 'a bar of chocolate' },
  { e: '🍭', name: 'a lollipop' },
  { e: '🥞', name: 'a stack of pancakes' },
  { e: '🍕', name: 'a slice of pizza' },
  { e: '🧇', name: 'a waffle' },
  { e: '🥐', name: 'a croissant' },
  { e: '🍿', name: 'some popcorn' },
  { e: '🍯', name: 'a pot of honey' },
  { e: '🥨', name: 'a pretzel' },
  { e: '🍒', name: 'some cherries' },
];

const SETS: Record<Exclude<PictureSet, 'photos'>, Item[]> = { animals: ANIMALS, treats: TREATS };

/** Pairs on the table for each age band: 12 cards for the youngest up to 24. */
export const PAIRS: Record<Band, number> = { '5-7': 6, '8-10': 8, '11-13': 10, '14+': 12 };

const LAYOUTS: Record<number, { cols: number; rows: number }> = {
  6: { cols: 4, rows: 3 },
  8: { cols: 4, rows: 4 },
  10: { cols: 5, rows: 4 },
  12: { cols: 6, rows: 4 },
};

/** Columns and rows that suit a number of pairs: 4×3, 4×4, 5×4 and 6×4. */
export function layoutFor(pairs: number): { cols: number; rows: number } {
  if (LAYOUTS[pairs]) return LAYOUTS[pairs];
  const cols = Math.ceil(Math.sqrt(pairs * 2));
  return { cols, rows: Math.ceil((pairs * 2) / cols) };
}

const fromItem = (i: Item): Face => ({ name: i.name, emoji: i.e });

/**
 * The pictures for a game: different ones, `count` of them. Family photos come
 * first, labelled Photo 1, Photo 2…, and animals fill any places left over.
 */
export function chooseFaces(set: PictureSet, count: number, photos: Picture[] = [], random = Math.random): Face[] {
  if (set !== 'photos') return shuffle(SETS[set], random).slice(0, count).map(fromItem);
  const mine: Face[] = photos.slice(0, count).map((p, i) => ({ name: `Photo ${i + 1}`, url: p.url }));
  return [...mine, ...shuffle(ANIMALS, random).slice(0, count - mine.length).map(fromItem)];
}

/** Two cards of every face, shuffled. */
export function deal(faces: number, random = Math.random): number[] {
  return shuffle(
    Array.from({ length: faces * 2 }, (_, i) => Math.floor(i / 2)),
    random,
  );
}

/** A fresh table. With a turn order it's taking turns, and the first seat starts. */
export function newGame(o: { set: PictureSet; band: Band; photos?: Picture[]; order?: string[]; random?: () => number }): PairsState {
  const photos = o.set === 'photos' ? (o.photos ?? []).slice(0, PAIRS[o.band]) : [];
  const faces = chooseFaces(o.set, PAIRS[o.band], photos, o.random);
  const cards = deal(faces.length, o.random);
  return {
    turn: o.order?.[0] ?? 'anyone',
    set: o.set,
    photos,
    faces,
    cards,
    up: [],
    found: cards.map(() => null),
    seen: [],
    turns: 0,
    by: {},
    last: null,
    band: o.band,
  };
}

export const isOver = (s: PairsState): boolean => s.found.every((f) => f !== null);
export const pairsFound = (s: PairsState): number => s.found.filter((f) => f !== null).length / 2;
export const totalPairs = (s: PairsState): number => s.cards.length / 2;
export const isVersus = (s: PairsState): boolean => s.turn !== 'anyone';
export const faceOf = (s: PairsState, card: number): Face => s.faces[s.cards[card]];

/** Whether two face-up cards are a miss waiting to be turned back over. */
export const missShowing = (s: PairsState): boolean => s.up.length === 2;

export interface Turner {
  /** The seat taking turns, or the person's id together. */
  finder: Finder;
  person: number;
  /** The seats in turn order, taking turns. */
  order?: string[];
}

/**
 * Turns over one card. A miss still showing is turned back over first. The
 * second card of a turn is a match, which stays up and belongs to the finder
 * (taking turns, they go again), or a miss, which stays up and passes the turn.
 * Null when it isn't a fair go: the game is over, it's someone else's turn, or
 * the card is already face up.
 */
export function flip(s: PairsState, card: number, who: Turner): PairsState | null {
  if (isOver(s) || s.ended) return null;
  const versus = isVersus(s);
  if (versus && who.finder !== s.turn) return null;
  if (!Number.isInteger(card) || card < 0 || card >= s.cards.length || s.found[card] !== null) return null;
  const up = missShowing(s) ? [] : s.up;
  if (up.includes(card)) return null;

  const seen = s.seen.includes(card) ? s.seen : [...s.seen, card];
  const by = { ...s.by, [who.person]: (s.by[who.person] ?? 0) + 1 };
  const base = { ...s, seen, by };
  if (!up.length) return { ...base, up: [card], last: { by: who.person, cards: [card] } };

  const first = up[0];
  const last = { by: who.person, cards: [first, card] };
  const turns = s.turns + 1;
  if (s.cards[first] === s.cards[card]) {
    const found = [...s.found];
    found[first] = found[card] = who.finder;
    return { ...base, up: [], found, turns, last };
  }
  const turn = versus && who.order ? nextSeat(who.order, s.turn) : s.turn;
  return { ...base, up: [first, card], turns, last, turn };
}

/** Pairs found by each finder, keyed as strings: seats taking turns, people's ids together. */
export function scoresOf(s: PairsState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of s.found) if (f !== null) out[String(f)] = (out[String(f)] ?? 0) + 0.5;
  return out;
}

/** Whether the latest turn found a pair. */
export function lastWasMatch(s: PairsState): boolean {
  const c = s.last?.cards;
  return !!c && c.length === 2 && s.found[c[0]] !== null && s.found[c[0]] === s.found[c[1]];
}

/** The seats with the most pairs: more than one when they tie. */
export function winners(s: PairsState, seats: string[]): string[] {
  return seats.length ? leaders(scoresOf(s), seats) : [];
}

/** Players best first, sharing a place on a tie. */
export function standings(s: PairsState, seats: string[]) {
  const scores = scoresOf(s);
  return placings(seats, (a, b) => (scores[b] ?? 0) - (scores[a] ?? 0)).map(({ item, place }) => ({ seat: item, place, pairs: scores[item] ?? 0 }));
}

export const pairsText = (n: number) => `${n} ${n === 1 ? 'pair' : 'pairs'}`;
export const turnsText = (n: number) => `${n} ${n === 1 ? 'turn' : 'turns'}`;

/** A very good score together: about one and a half turns for every pair. */
export const goodScore = (pairs: number) => Math.round(pairs * 1.5);

export type Rating = 'perfect' | 'great' | 'good' | 'more';

export function rating(pairs: number, turns: number): Rating {
  if (turns <= pairs) return 'perfect';
  if (turns <= goodScore(pairs)) return 'great';
  if (turns <= pairs * 2) return 'good';
  return 'more';
}

/** How the family did against a good score, for the end of a game together. */
export function ratingText(pairs: number, turns: number): string {
  const good = `About ${goodScore(pairs)} turns is a very good score for ${pairsText(pairs)}.`;
  switch (rating(pairs, turns)) {
    case 'perfect':
      return 'Perfect! Every single turn found a pair.';
    case 'great':
      return `A very good score! ${good}`;
    case 'good':
      return `A good score. ${good}`;
    default:
      return `${good} Can you get closer next time?`;
  }
}

/** "The family found all 8 pairs in 14 turns", or one person's name when they played alone. */
export function coopSummary(s: PairsState, name: (person: number) => string): string {
  const people = Object.keys(s.by).map(Number);
  const who = people.length === 1 ? name(people[0]) : 'The family';
  const pairs = totalPairs(s);
  const r = rating(pairs, s.turns);
  const praise = r === 'perfect' ? '. A perfect game!' : r === 'great' ? '. A very good score!' : '';
  return `${who} found all ${pairs} pairs in ${turnsText(s.turns)}${praise} 🃏`;
}

/** "Mia won Pairs with 5 pairs 🃏 (Dad 3)", or a shared win on a tie. */
export function versusSummary(s: PairsState, seats: string[], name: (seat: string) => string): string {
  const top = winners(s, seats);
  if (!top.length) return 'Pairs has finished 🃏';
  const scores = scoresOf(s);
  const best = scores[top[0]] ?? 0;
  const names = top.map(name);
  const head = top.length === 1 ? `${names[0]} won Pairs with ${pairsText(best)}` : `${listNames(names)} shared the win at Pairs with ${pairsText(best)} each`;
  const rest = standings(s, seats)
    .filter((r) => !top.includes(r.seat))
    .map((r) => `${name(r.seat)} ${r.pairs}`);
  const line = `${head} 🃏${rest.length ? ` (${rest.join(', ')})` : ''}`;
  return line.length <= 200 ? line : `${head} 🃏`.slice(0, 200);
}

/**
 * How the scores stand, taking turns: "3 pairs each", "Mia leads with 4 pairs",
 * "You lead with 2 pairs" or "Mia and Dad lead with 3 pairs".
 */
export function scoreLine(s: PairsState, seats: string[], name: (seat: string) => string): string {
  if (!seats.length) return '';
  const scores = scoresOf(s);
  const top = leaders(scores, seats);
  const best = scores[top[0]] ?? 0;
  if (best === 0) return 'no pairs yet';
  if (top.length === seats.length) return `${pairsText(best)} each`;
  const names = top.map(name);
  const verb = top.length === 1 && names[0] !== 'You' ? 'leads' : 'lead';
  return `${listNames(names)} ${verb} with ${pairsText(best)}`;
}
