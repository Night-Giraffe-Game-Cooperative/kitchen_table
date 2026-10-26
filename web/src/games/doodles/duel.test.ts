import { describe, expect, it } from 'vitest';
import { addEntry, allVoted, canCount, showNow, vote, waitsOn, type DuelState } from './duel';

// Mum is 1, Dad is 2, Mia is 3.
const fresh = (players = [1, 2, 3]): DuelState => ({ turn: 'anyone', prompt: 'a cat', phase: 'drawing', players, entries: {}, votes: {} });

describe('Doodle Battle', () => {
  it('shows the pictures once everyone has drawn', () => {
    let s = addEntry(fresh(), 1, '/m/1.png')!;
    s = addEntry(s, 2, '/m/2.png')!;
    expect(s.phase).toBe('drawing');
    expect(addEntry(s, 2, '/m/2b.png')).toBeNull();
    s = addEntry(s, 3, '/m/3.png')!;
    expect(s.phase).toBe('voting');
  });

  it('lets someone else in the chat join in', () => {
    const s = addEntry(fresh([1, 2]), 4, '/m/4.png')!;
    expect(s.players).toEqual([1, 2, 4]);
    expect(s.phase).toBe('drawing');
  });

  it('adds a picture finished after they were shown early, without hiding them again', () => {
    let s = addEntry(addEntry(fresh([1, 2, 3, 5]), 1, '/m/1.png')!, 2, '/m/2.png')!;
    s = showNow(s)!;
    expect(s.phase).toBe('voting');
    s = vote(s, 1, 2)!;
    // Mia sends hers just after Dad showed them; Gran (5) still hasn't drawn.
    s = addEntry(s, 3, '/m/3.png')!;
    expect(s.phase).toBe('voting');
    expect(s.entries[3]).toBe('/m/3.png');
    expect(s.votes).toEqual({ 1: 2 });
  });

  it("doesn't show the pictures early with only one in, and takes nothing once it's over", () => {
    const one = addEntry(fresh(), 1, '/m/1.png')!;
    expect(showNow(one)).toBeNull();
    expect(addEntry({ ...one, phase: 'done' }, 2, '/m/2.png')).toBeNull();
  });

  it('stars go to other pictures, and a change of mind replaces the star', () => {
    let s = addEntry(addEntry(fresh([1, 2]), 1, '/m/1.png')!, 2, '/m/2.png')!;
    expect(vote(s, 1, 1)).toBeNull();
    expect(vote(s, 1, 3)).toBeNull();
    s = vote(s, 1, 2)!;
    expect(allVoted(s)).toBe(false);
    s = vote(s, 2, 1)!;
    expect(allVoted(s)).toBe(true);
    expect(vote({ ...s, phase: 'done' }, 3, 1)).toBeNull();
  });

  it("doesn't count by itself while someone shown early is still drawing", () => {
    let s = showNow(addEntry(addEntry(fresh(), 1, '/m/1.png')!, 2, '/m/2.png')!)!;
    s = vote(vote(s, 1, 2)!, 2, 1)!;
    expect(allVoted(s)).toBe(false); // Mia might still add hers
    expect(canCount(s)).toBe(true);
  });

  it('can be counted when only one person drew, as nobody can star their own', () => {
    const s = addEntry(fresh([1]), 1, '/m/1.png')!;
    expect(s.phase).toBe('voting');
    expect(canCount(s)).toBe(true);
    const two = addEntry(addEntry(fresh([1, 2]), 1, '/m/1.png')!, 2, '/m/2.png')!;
    expect(canCount(two)).toBe(false);
    expect(canCount(vote(two, 1, 2)!)).toBe(true);
  });

  it('waits on whoever is still to draw, then on artists still to give a star', () => {
    let s = addEntry(fresh(), 1, '/m/1.png')!;
    expect([1, 2, 3, 4].map((id) => waitsOn(s, id))).toEqual([false, true, true, false]);
    s = addEntry(addEntry(s, 2, '/m/2.png')!, 3, '/m/3.png')!;
    s = vote(s, 1, 2)!;
    expect([1, 2, 3].map((id) => waitsOn(s, id))).toEqual([false, true, true]);
    expect(waitsOn(addEntry(fresh([1]), 1, '/m/1.png')!, 1)).toBe(false);
  });
});
