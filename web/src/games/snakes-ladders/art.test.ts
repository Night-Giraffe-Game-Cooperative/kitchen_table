import { describe, expect, it } from 'vitest';
import { BANDS } from '../bands';
import { CELL, centre, ladderArt, snakeArt, snakeShapes } from './art';
import { BOARDS, snakes } from './rules';

describe('drawing the board', () => {
  it('puts square 1 bottom left and the last square top left or right', () => {
    const small = BOARDS['5-7'];
    expect(centre(small, 1)).toEqual({ x: CELL / 2, y: 4.5 * CELL });
    expect(centre(small, 30)).toEqual({ x: 5.5 * CELL, y: CELL / 2 });
    expect(centre(BOARDS['8-10'], 100)).toEqual({ x: CELL / 2, y: CELL / 2 });
  });

  it('gives a ladder two rails and rungs between them', () => {
    const art = ladderArt({ x: 50, y: 450 }, { x: 50, y: 250 });
    expect(art.rails).toHaveLength(2);
    expect(art.rungs.length).toBeGreaterThanOrEqual(3);
  });

  it('draws each snake from the middle of its head square to the middle of its tail square', () => {
    for (const band of BANDS) {
      const b = BOARDS[band];
      const shapes = snakeShapes(b);
      expect(shapes.size).toBe(snakes(b).length);
      for (const [from, to] of snakes(b)) {
        const { spine, body, spots } = shapes.get(from)!;
        const head = centre(b, from);
        const tail = centre(b, to);
        expect(spine[0].x).toBeCloseTo(head.x);
        expect(spine[0].y).toBeCloseTo(head.y);
        expect(spine[spine.length - 1].x).toBeCloseTo(tail.x);
        expect(spine[spine.length - 1].y).toBeCloseTo(tail.y);
        expect(body).not.toMatch(/NaN|Infinity/);
        expect(spots.length).toBeGreaterThan(0);
      }
    }
  });

  it('wiggles the other way for the next snake', () => {
    const a = snakeArt({ x: 0, y: 0 }, { x: 0, y: 400 }, 0).spine;
    const b = snakeArt({ x: 0, y: 0 }, { x: 0, y: 400 }, 1).spine;
    const mid = Math.floor(a.length / 4);
    expect(Math.sign(a[mid].x)).toBe(-Math.sign(b[mid].x));
  });
});
