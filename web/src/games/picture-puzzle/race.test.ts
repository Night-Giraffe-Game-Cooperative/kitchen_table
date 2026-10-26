import { describe, expect, it } from 'vitest';
import { begin, everyoneFinished, fewestSwaps, formatTime, isSolved, newRace, placePiece, raceSummary, scramble, standings, swap, waitsOn, type RaceState } from './race';

const media = { url: '/media/x.jpg', width: 800, height: 600 };

/** Solves a board the careful way: each swap puts one piece where it belongs. */
function solve(s: RaceState, seat: string, now: number, wasted = 0): RaceState {
  // Wasted swaps: two misplaced pieces swapped and swapped back again.
  for (let i = 0; i < wasted; i += 2) {
    const t = s.boards[seat].tiles;
    const free = t.map((p, i) => (p === i ? -1 : i)).filter((i) => i >= 0);
    const a = free[0];
    const b = free.find((x) => x !== a && t[x] !== a && t[a] !== x)!;
    s = swap(swap(s, seat, a, b, now)!, seat, a, b, now)!;
  }
  for (;;) {
    const t = s.boards[seat].tiles;
    const place = t.findIndex((p, i) => p !== i);
    if (place < 0) return s;
    const from = t.indexOf(place);
    s = swap(s, seat, place, from, now)!;
  }
}

describe('Picture Puzzle', () => {
  it('scrambles with no piece in its own place', () => {
    for (let i = 0; i < 20; i++) {
      const t = scramble(3);
      expect(t.every((p, place) => p !== place)).toBe(true);
      expect([...t].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    }
  });

  it('knows the fewest swaps a jumble needs', () => {
    expect(fewestSwaps([0, 1, 2, 3])).toBe(0);
    expect(fewestSwaps([1, 0, 3, 2])).toBe(2); // two pairs
    expect(fewestSwaps([1, 2, 3, 0])).toBe(3); // one loop of four
    expect(fewestSwaps([1, 2, 0, 4, 3])).toBe(3);
  });

  it('moves the piece that was picked up, even if someone else moved it meanwhile', () => {
    // Mia picks up piece 5 from space 0, then Dad swaps spaces 0 and 1.
    const tiles = [5, 2, 0, 1, 3, 4];
    const dad = placePiece(tiles, tiles[0], 1)!;
    expect(dad).toEqual([2, 5, 0, 1, 3, 4]);
    // Mia puts her piece down in space 5: it's still piece 5 that moves, from where Dad left it, not Dad's piece 2.
    expect(placePiece(dad, 5, 5)).toEqual([2, 4, 0, 1, 3, 5]);
  });

  it('leaves pieces in their right places alone', () => {
    const tiles = [1, 0, 2, 4, 3];
    expect(placePiece(tiles, 2, 0)).toBeNull(); // piece 2 is home
    expect(placePiece(tiles, 1, 2)).toBeNull(); // so is the piece in space 2
    expect(placePiece(tiles, 1, 0)).toBeNull(); // already there
    expect(placePiece(tiles, 1, 9)).toBeNull();
    expect(placePiece(tiles, 1, 1)).toEqual([0, 1, 2, 4, 3]);
  });

  it('careful swapping matches the fewest swaps', () => {
    const s = begin(newRace(media, 4), 'p1', 0)!;
    const solved = solve(s, 'p1', 10);
    expect(isSolved(solved.boards.p1.tiles)).toBe(true);
    expect(solved.boards.p1.swaps).toBe(fewestSwaps(s.start));
  });
});

describe('Picture Puzzle race', () => {
  const seats = { p1: 1, p2: 2, p3: 'open' as const };
  const order = ['p1', 'p2', 'p3'];
  const names: Record<string, string> = { p1: 'Mia', p2: 'Dad', p3: 'Gran' };

  it('gives everyone the same jumble on their own board', () => {
    let s = newRace(media, 3);
    s = begin(s, 'p1', 1000)!;
    s = begin(s, 'p2', 5000)!;
    expect(s.boards.p1.tiles).toEqual(s.start);
    expect(s.boards.p2.tiles).toEqual(s.start);
    expect(begin(s, 'p1', 9000)).toBeNull();
    s = swap(s, 'p1', 0, s.start.indexOf(0), 2000)!;
    expect(s.boards.p1.swaps).toBe(1);
    expect(s.boards.p2.swaps).toBe(0);
    expect(s.boards.p2.tiles).toEqual(s.start);
  });

  it('refuses swaps before starting, after finishing, or of pieces already in place', () => {
    let s = newRace(media, 3);
    expect(swap(s, 'p1', 0, 1, 0)).toBeNull();
    s = begin(s, 'p1', 0)!;
    const place = s.start.indexOf(0);
    s = swap(s, 'p1', 0, place, 1)!;
    expect(swap(s, 'p1', 0, 1, 2)).toBeNull(); // piece 0 is home now
    s = solve(s, 'p1', 50);
    expect(s.boards.p1.ended).toBe(50);
    expect(swap(s, 'p1', 1, 2, 60)).toBeNull();
  });

  it('ranks by fewest swaps, then by time taken', () => {
    let s = newRace(media, 3);
    s = begin(s, 'p1', 0)!;
    s = begin(s, 'p2', 100_000)!;
    s = begin(s, 'p3', 0)!;
    s = solve(s, 'p1', 90_000); // careful, slower
    s = solve(s, 'p2', 130_000); // careful, quicker: 30 s
    s = solve(s, 'p3', 20_000, 2); // quick but wasted swaps
    const rows = standings(s, order);
    expect(rows.map((r) => [r.seat, r.place])).toEqual([
      ['p2', 1],
      ['p1', 2],
      ['p3', 3],
    ]);
    expect(rows[0].time).toBe(30_000);
    const best = fewestSwaps(s.start);
    expect(raceSummary(s, order, (k) => names[k])).toBe(
      `Dad won the picture race with ${best} swaps, just quicker than Mia 🧩 (Gran ${best + 2})`,
    );
  });

  it('shares first place when swaps and time are the same', () => {
    let s = newRace(media, 3);
    s = begin(begin(s, 'p1', 0)!, 'p2', 0)!;
    s = solve(solve(s, 'p1', 5000), 'p2', 5000);
    expect(standings(s, ['p1', 'p2']).map((r) => r.place)).toEqual([1, 1]);
    expect(raceSummary(s, ['p1', 'p2'], (k) => names[k])).toMatch(/^Mia and Dad shared first place in the picture race with \d+ swaps 🧩$/);
  });

  it('lists people who had not finished when the race was ended', () => {
    let s = newRace(media, 3);
    s = begin(s, 'p1', 0)!;
    s = solve(s, 'p1', 1000);
    const rows = standings(s, ['p1', 'p2']);
    expect(rows[1]).toEqual({ seat: 'p2', place: null });
    expect(raceSummary(s, ['p1', 'p2'], (k) => names[k])).toMatch(/^Mia won the picture race with \d+ swaps 🧩 \(Dad didn't finish\)$/);
    expect(raceSummary(newRace(media, 3), ['p1'], (k) => names[k])).toBe('The picture race ended before anyone finished 🧩');
  });

  it('is over when every place is taken and everyone has finished', () => {
    let s = newRace(media, 3);
    s = solve(begin(s, 'p1', 0)!, 'p1', 1);
    s = solve(begin(s, 'p2', 0)!, 'p2', 1);
    expect(everyoneFinished(s, seats)).toBe(false); // Gran's place is still open
    expect(everyoneFinished(s, { p1: 1, p2: 2 })).toBe(true);
  });

  it('waits on each player until their puzzle is finished', () => {
    let s = newRace(media, 3);
    expect([1, 2, 3].map((id) => waitsOn(s, seats, id))).toEqual([true, true, false]);
    s = begin(s, 'p1', 0)!;
    expect(waitsOn(s, seats, 1)).toBe(true);
    s = solve(s, 'p1', 1);
    expect([1, 2].map((id) => waitsOn(s, seats, id))).toEqual([false, true]);
  });

  it('writes times for people', () => {
    expect(formatTime(400)).toBe('1 s');
    expect(formatTime(45_000)).toBe('45 s');
    expect(formatTime(200_000)).toBe('3 min 20 s');
    expect(formatTime(180_000)).toBe('3 min');
    expect(formatTime(2 * 3600_000 + 5 * 60_000)).toBe('2 h 5 min');
  });
});
