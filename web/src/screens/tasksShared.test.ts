import { describe, expect, it } from 'vitest';
import { ariaTick, needsCheck, tapTick } from './tasksShared';
import type { Me, Task } from '../lib/types';

const me = (id: number, role: Me['role']) => ({ id, role }) as Me;
const task = (created_by_id: number) => ({ id: 9, created_by_id }) as Task;
const kid = me(3, 'kid');
const mum = me(2, 'grownup');

describe('kids tick, grown-ups check', () => {
  it("waits for a grown-up only on a kid's tick of a task someone else set", () => {
    expect(needsCheck(kid, task(2))).toBe(true);
    expect(needsCheck(kid, task(3))).toBe(false);
    expect(needsCheck(mum, task(2))).toBe(false);
  });

  it('a tap ticks, takes back a waiting tick, or agrees it', () => {
    expect(tapTick(kid, task(2), 'todo')).toBe(true);
    expect(tapTick(kid, task(2), 'waiting')).toBe(false);
    expect(tapTick(kid, task(2), 'done')).toBeNull();
    expect(tapTick(kid, task(3), 'done')).toBe(false);
    expect(tapTick(mum, task(2), 'waiting')).toBe(true);
    expect(tapTick(mum, task(2), 'done')).toBe(false);
  });

  it('shows a waiting tick as half-ticked', () => {
    expect(ariaTick('waiting')).toBe('mixed');
    expect(ariaTick('done')).toBe(true);
    expect(ariaTick('todo')).toBe(false);
  });
});
