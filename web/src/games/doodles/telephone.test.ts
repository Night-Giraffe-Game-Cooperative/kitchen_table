import { describe, expect, it } from 'vitest';
import { HOLD, addStep, canTake, holder, nextKind, release, take, type State } from './telephone';

const start = (): State => ({ turn: 'anyone', steps: [{ kind: 'words', u: 1, text: 'a cat on a bus' }], length: 5 });

describe('Doodle Telephone', () => {
  it('lets one person take the next step, and everyone else waits', () => {
    const s = take(start(), 2, 1000)!;
    expect(holder(s, 2000)?.u).toBe(2);
    // Mia can't start drawing the same words while Dad is on it.
    expect(canTake(s, 3, 2000)).toBe(false);
    expect(take(s, 3, 2000)).toBeNull();
    expect(addStep(s, { kind: 'picture', u: 3, url: '/m/1' }, 2000)).toBeNull();
    // Dad sends his drawing, and the next step is free for anyone else.
    const drawn = addStep(s, { kind: 'picture', u: 2, url: '/m/2' }, 3000)!;
    expect(drawn.steps).toHaveLength(2);
    expect(drawn.doing).toBeUndefined();
    expect(nextKind(drawn)).toBe('words');
    expect(canTake(drawn, 3, 3000)).toBe(true);
    expect(canTake(drawn, 2, 3000)).toBe(false);
  });

  it('nobody does two steps in a row, and the person who started waits', () => {
    expect(canTake(start(), 1)).toBe(false);
    expect(take(start(), 1)).toBeNull();
  });

  it('gives the step back, or lets someone take over after a long wait', () => {
    const s = take(start(), 2, 1000)!;
    expect(release(s, 3)).toBeNull();
    const back = release(s, 2)!;
    expect(holder(back)).toBeUndefined();
    expect(canTake(back, 3)).toBe(true);
    // Left the app halfway through: after a while, anyone else can take it.
    expect(canTake(s, 3, 1000 + HOLD + 1)).toBe(true);
  });

  it('still adds a step for an old game where nobody took it first', () => {
    expect(addStep(start(), { kind: 'picture', u: 2, url: '/m/3' })?.steps).toHaveLength(2);
    // But not two drawings of the same words.
    const drawn = addStep(start(), { kind: 'picture', u: 2, url: '/m/3' })!;
    expect(addStep(drawn, { kind: 'picture', u: 3, url: '/m/4' })).toBeNull();
  });

  it('stops at the chosen number of steps', () => {
    let s: State = { ...start(), length: 2 };
    s = addStep(s, { kind: 'picture', u: 2, url: '/m/5' })!;
    expect(canTake(s, 3)).toBe(false);
  });
});
