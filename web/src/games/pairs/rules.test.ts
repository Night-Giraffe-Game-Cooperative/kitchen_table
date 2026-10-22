import { describe, expect, it } from 'vitest';
import { BANDS } from '../bands';
import {
  ANIMALS,
  PAIRS,
  TREATS,
  chooseFaces,
  coopSummary,
  flip,
  goodScore,
  isOver,
  lastWasMatch,
  layoutFor,
  missShowing,
  newGame,
  pairsFound,
  rating,
  ratingText,
  scoreLine,
  scoresOf,
  standings,
  versusSummary,
  winners,
  type PairsState,
} from './rules';

/** A repeatable random, so a deal can be checked twice. */
function seeded(n: number) {
  return () => ((n = (n * 16807) % 2147483647) / 2147483647);
}

/** A table with the cards in a known order: [0, 0, 1, 1, 2, 2, …] unless given. */
function table(cards: number[], order?: string[]): PairsState {
  const s = newGame({ set: 'animals', band: '5-7', order, random: seeded(1) });
  return { ...s, faces: s.faces.slice(0, Math.max(...cards) + 1), cards, found: cards.map(() => null) };
}

const order = ['p1', 'p2'];
const as = (seat: string, person: number) => ({ finder: seat, person, order });
const together = (person: number) => ({ finder: person, person });

/** Plays several cards in a row, failing loudly if one isn't allowed. */
function turn(s: PairsState, cards: number[], who: Parameters<typeof flip>[2]): PairsState {
  for (const c of cards) {
    const next = flip(s, c, who);
    if (!next) throw new Error(`card ${c} couldn't be turned`);
    s = next;
  }
  return s;
}

describe('dealing', () => {
  it('puts every picture on exactly two cards, with the right number of pairs for each age band', () => {
    for (const band of BANDS) {
      for (const set of ['animals', 'treats'] as const) {
        const s = newGame({ set, band, random: seeded(7) });
        expect(s.cards).toHaveLength(PAIRS[band] * 2);
        expect(s.faces).toHaveLength(PAIRS[band]);
        const counts = new Map<number, number>();
        for (const c of s.cards) counts.set(c, (counts.get(c) ?? 0) + 1);
        expect([...counts.values()].every((n) => n === 2)).toBe(true);
        expect(counts.size).toBe(PAIRS[band]);
        // Different pictures, each with a name to read out.
        expect(new Set(s.faces.map((f) => f.emoji)).size).toBe(PAIRS[band]);
        expect(s.faces.every((f) => f.name.length > 0)).toBe(true);
      }
    }
    expect(PAIRS).toEqual({ '5-7': 6, '8-10': 8, '11-13': 10, '14+': 12 });
  });

  it('starts face down with nothing found or seen, together or taking turns', () => {
    const coop = newGame({ set: 'treats', band: '8-10' });
    expect(coop.turn).toBe('anyone');
    expect(coop.up).toEqual([]);
    expect(coop.seen).toEqual([]);
    expect(coop.turns).toBe(0);
    expect(coop.found.every((f) => f === null)).toBe(true);
    expect(coop.band).toBe('8-10');
    expect(newGame({ set: 'treats', band: '8-10', order }).turn).toBe('p1');
  });

  it('shuffles the cards', () => {
    const a = newGame({ set: 'animals', band: '14+', random: seeded(3) }).cards;
    const b = newGame({ set: 'animals', band: '14+', random: seeded(4) }).cards;
    expect(a).not.toEqual(b);
  });

  it('has plenty of animals and treats, each with a spoken name', () => {
    for (const set of [ANIMALS, TREATS]) {
      expect(set.length).toBeGreaterThanOrEqual(12);
      expect(new Set(set.map((i) => i.e)).size).toBe(set.length);
      expect(set.every((i) => /^(a|an|some) /.test(i.name))).toBe(true);
    }
  });

  it('labels family photos and fills the places left over with animals', () => {
    const photos = [1, 2, 3].map((n) => ({ url: `/media/${n}.jpg`, width: 800, height: 600 }));
    const faces = chooseFaces('photos', 8, photos, seeded(2));
    expect(faces).toHaveLength(8);
    expect(faces.slice(0, 3)).toEqual([
      { name: 'Photo 1', url: '/media/1.jpg' },
      { name: 'Photo 2', url: '/media/2.jpg' },
      { name: 'Photo 3', url: '/media/3.jpg' },
    ]);
    expect(faces.slice(3).every((f) => f.emoji && !f.url)).toBe(true);

    // More photos than pairs: only the latest are used, and kept for playing again.
    const many = Array.from({ length: 12 }, (_, n) => ({ url: `/media/${n}.jpg`, width: 1, height: 1 }));
    const s = newGame({ set: 'photos', band: '5-7', photos: many });
    expect(s.photos).toHaveLength(6);
    expect(s.faces.every((f) => f.url)).toBe(true);
    expect(newGame({ set: 'animals', band: '5-7', photos: many }).photos).toEqual([]);
  });

  it('lays the cards out in a grid that suits the count', () => {
    expect(layoutFor(6)).toEqual({ cols: 4, rows: 3 });
    expect(layoutFor(8)).toEqual({ cols: 4, rows: 4 });
    expect(layoutFor(10)).toEqual({ cols: 5, rows: 4 });
    expect(layoutFor(12)).toEqual({ cols: 6, rows: 4 });
  });
});

describe('turning cards together', () => {
  it('a match stays face up and belongs to whoever found it', () => {
    let s = flip(table([0, 1, 0, 1]), 0, together(7))!;
    expect(s.up).toEqual([0]);
    expect(s.turns).toBe(0);
    s = flip(s, 2, together(9))!;
    expect(s.up).toEqual([]);
    expect(s.found).toEqual([9, null, 9, null]);
    expect(s.turns).toBe(1);
    expect(s.turn).toBe('anyone');
    expect(lastWasMatch(s)).toBe(true);
    expect(s.last).toEqual({ by: 9, cards: [0, 2] });
    expect(s.by).toEqual({ 7: 1, 9: 1 });
    expect(pairsFound(s)).toBe(1);
  });

  it('a miss stays up until the next tap, which turns them back over first', () => {
    let s = turn(table([0, 1, 0, 1, 2, 2]), [0, 1], together(7));
    expect(s.up).toEqual([0, 1]);
    expect(missShowing(s)).toBe(true);
    expect(lastWasMatch(s)).toBe(false);
    expect(s.found.every((f) => f === null)).toBe(true);
    expect(s.turns).toBe(1);

    s = flip(s, 4, together(8))!;
    expect(s.up).toEqual([4]);
    expect(s.seen).toEqual([0, 1, 4]);
    expect(s.last).toEqual({ by: 8, cards: [4] });
  });

  it('a missed card can be the first card of the next turn', () => {
    const s = flip(turn(table([0, 1, 0, 1]), [0, 1], together(7)), 1, together(7))!;
    expect(s.up).toEqual([1]);
    expect(s.seen).toEqual([0, 1]);
  });

  it("won't turn a card that is already face up or found", () => {
    let s = flip(table([0, 1, 0, 1]), 0, together(7))!;
    expect(flip(s, 0, together(7))).toBeNull();
    s = flip(s, 2, together(7))!;
    expect(flip(s, 0, together(7))).toBeNull();
    expect(flip(s, 2, together(7))).toBeNull();
    expect(flip(s, 9, together(7))).toBeNull();
    expect(flip(s, -1, together(7))).toBeNull();
  });

  it('remembers every card that has been seen, once each', () => {
    const s = turn(table([0, 1, 0, 1, 2, 2]), [0, 1, 0, 4], together(7));
    expect(s.seen).toEqual([0, 1, 4]);
  });

  it('ends when every pair is found, with a summary and a score to aim for', () => {
    let s = turn(table([0, 1, 0, 1]), [0, 1, 0, 2], together(7));
    expect(isOver(s)).toBe(false);
    s = turn(s, [1, 3], together(9));
    expect(isOver(s)).toBe(true);
    expect(s.turns).toBe(3);
    expect(flip(s, 0, together(7))).toBeNull();
    const name = (id: number) => ({ 7: 'Mia', 9: 'Dad' })[id] ?? 'Someone';
    expect(coopSummary(s, name)).toBe('The family found all 2 pairs in 3 turns. A very good score! 🃏');
    expect(scoresOf(s)).toEqual({ 7: 1, 9: 1 });

    const alone = turn(table([0, 0, 1, 1]), [0, 1, 2, 3], together(7));
    expect(coopSummary(alone, name)).toBe('Mia found all 2 pairs in 2 turns. A perfect game! 🃏');
  });

  it('rates the turns against a good score of about one and a half per pair', () => {
    expect(goodScore(8)).toBe(12);
    expect(rating(8, 8)).toBe('perfect');
    expect(rating(8, 12)).toBe('great');
    expect(rating(8, 16)).toBe('good');
    expect(rating(8, 17)).toBe('more');
    expect(ratingText(8, 14)).toBe('A good score. About 12 turns is a very good score for 8 pairs.');
    expect(ratingText(6, 20)).toContain('About 9 turns is a very good score for 6 pairs.');
  });
});

describe('taking turns', () => {
  it('a pair scores and gives another go; a miss passes the turn', () => {
    let s = turn(table([0, 1, 0, 1, 2, 2], order), [0, 2], as('p1', 7));
    expect(s.turn).toBe('p1');
    expect(scoresOf(s)).toEqual({ p1: 1 });
    expect(s.found[0]).toBe('p1');

    s = turn(s, [1, 4], as('p1', 7));
    expect(s.turn).toBe('p2');
    expect(s.up).toEqual([1, 4]);

    // The next player's first tap turns the miss back over.
    s = flip(s, 3, as('p2', 9))!;
    expect(s.up).toEqual([3]);
    s = flip(s, 1, as('p2', 9))!;
    expect(scoresOf(s)).toEqual({ p1: 1, p2: 1 });
    expect(s.turn).toBe('p2');
  });

  it('refuses a go out of turn', () => {
    const s = table([0, 1, 0, 1], order);
    expect(flip(s, 0, as('p2', 9))).toBeNull();
    const missed = turn(s, [0, 1], as('p1', 7));
    expect(flip(missed, 2, as('p1', 7))).toBeNull();
    expect(flip(missed, 2, as('p2', 9))).not.toBeNull();
  });

  it('goes round every player in order and back to the first', () => {
    const three = ['p1', 'p2', 'p3'];
    let s = table([0, 1, 2, 0, 1, 2], three);
    s = turn(s, [0, 1], { finder: 'p1', person: 1, order: three });
    s = turn(s, [0, 1], { finder: 'p2', person: 2, order: three });
    expect(s.turn).toBe('p3');
    s = turn(s, [0, 1], { finder: 'p3', person: 3, order: three });
    expect(s.turn).toBe('p1');
  });

  it('the most pairs wins at the end', () => {
    let s = turn(table([0, 0, 1, 2, 1, 2], order), [0, 1, 2, 3], as('p1', 7));
    s = turn(s, [2, 4, 3, 5], as('p2', 9));
    expect(isOver(s)).toBe(true);
    expect(winners(s, order)).toEqual(['p2']);
    expect(standings(s, order)).toEqual([
      { seat: 'p2', place: 1, pairs: 2 },
      { seat: 'p1', place: 2, pairs: 1 },
    ]);
    const name = (seat: string) => ({ p1: 'Dad', p2: 'Mia' })[seat] ?? 'Someone';
    expect(versusSummary(s, order, name)).toBe('Mia won Pairs with 2 pairs 🃏 (Dad 1)');
  });

  it('a tie shares the win', () => {
    let s = turn(table([0, 0, 1, 1, 2, 3, 2, 3], order), [0, 1, 2, 3, 4, 5], as('p1', 7));
    expect(s.turn).toBe('p2');
    s = turn(s, [4, 6, 5, 7], as('p2', 9));
    expect(isOver(s)).toBe(true);
    expect(scoresOf(s)).toEqual({ p1: 2, p2: 2 });
    expect(winners(s, order)).toEqual(['p1', 'p2']);
    expect(standings(s, order).map((r) => r.place)).toEqual([1, 1]);
    const name = (seat: string) => ({ p1: 'Dad', p2: 'Mia' })[seat] ?? 'Someone';
    expect(versusSummary(s, order, name)).toBe('Dad and Mia shared the win at Pairs with 2 pairs each 🃏');
  });

  it('says how the scores stand', () => {
    const name = (seat: string) => ({ p1: 'You', p2: 'Mia', p3: 'Dad' })[seat] ?? 'Someone';
    const three = ['p1', 'p2', 'p3'];
    let s = table([0, 0, 1, 1, 2, 2, 3, 3], three);
    expect(scoreLine(s, three, name)).toBe('no pairs yet');
    s = turn(s, [0, 1, 2, 4], { finder: 'p1', person: 1, order: three });
    expect(scoreLine(s, three, name)).toBe('You lead with 1 pair');
    s = turn(s, [2, 3, 4, 6], { finder: 'p2', person: 2, order: three });
    expect(scoreLine(s, three, name)).toBe('You and Mia lead with 1 pair');
    s = turn(s, [4, 5], { finder: 'p3', person: 3, order: three });
    expect(scoreLine(s, three, name)).toBe('1 pair each');
    expect(scoreLine(s, ['p2', 'p3'], name)).toBe('1 pair each');
    const mia = turn(table([0, 0, 1, 1], order), [0, 2], as('p1', 7));
    const miaLeads = turn(mia, [0, 1], as('p2', 9));
    expect(scoreLine(miaLeads, order, (k) => (k === 'p2' ? 'Mia' : 'Dad'))).toBe('Mia leads with 1 pair');
  });
});
