import { describe, expect, it } from 'vitest';
import {
  AREA_TIMES,
  RADIUS,
  SHOW_AFTER,
  areaAround,
  areaShown,
  canShow,
  cluesFor,
  cluesOf,
  distance,
  foundSummary,
  fresh,
  guess,
  heatOf,
  hide,
  isFound,
  nudge,
  placeWords,
  trendOf,
  waitsFor,
  type Guess,
  type State,
} from './rules';
import { BANDS, type Band } from '../bands';

const wide = { url: '/media/x.jpg', width: 800, height: 600 };
const tall = { url: '/media/y.jpg', width: 600, height: 900 };

/** A seeded random number, so the tests are the same every time. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function hidden(at = { x: 0.5, y: 0.5 }, band: Band = '8-10', media = wide): State {
  return hide({ ...fresh(media), band }, at, seeded(1))!;
}

describe("Where's the Giraffe?", () => {
  it("measures distance in the photo's real proportions", () => {
    // Across a landscape photo is further than down it.
    expect(distance({ x: 0, y: 0 }, { x: 1, y: 0 }, wide)).toBeCloseTo(800 / 600);
    expect(distance({ x: 0, y: 0 }, { x: 0, y: 1 }, wide)).toBeCloseTo(1);
    // And the other way round on a portrait one.
    expect(distance({ x: 0, y: 0 }, { x: 0, y: 1 }, tall)).toBeCloseTo(1.5);
    expect(distance({ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.7 }, { width: 500, height: 500 })).toBeCloseTo(0.5);
    // The same step on the screen is the same distance either way.
    expect(distance({ x: 0.5, y: 0.5 }, { x: 0.5 + 0.075, y: 0.5 }, wide)).toBeCloseTo(distance({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.6 }, wide));
  });

  it("finds him within the band's radius", () => {
    const spot = { x: 0.5, y: 0.5 };
    // 0.12 of the shorter side straight down.
    const near = { x: 0.5, y: 0.62 };
    expect(isFound(near, spot, wide, '5-7')).toBe(true);
    expect(isFound(near, spot, wide, '8-10')).toBe(false);
    // 0.09 of the shorter side across: 0.09 × 600 / 800 of the width.
    const close = { x: 0.5 + (0.09 * 600) / 800, y: 0.5 };
    expect(isFound(close, spot, wide, '8-10')).toBe(true);
    expect(isFound(close, spot, wide, '11-13')).toBe(false);
    expect(isFound({ x: 0.5, y: 0.56 }, spot, wide, '14+')).toBe(false);
    expect(isFound({ x: 0.5, y: 0.55 }, spot, wide, '14+')).toBe(true);
    // Younger bands are easier.
    expect(RADIUS['5-7']).toBeGreaterThan(RADIUS['8-10']);
    expect(RADIUS['8-10']).toBeGreaterThan(RADIUS['11-13']);
    expect(RADIUS['11-13']).toBeGreaterThan(RADIUS['14+']);
  });

  it('says warmer or colder compared with the guess before', () => {
    const r = RADIUS['8-10'];
    expect(trendOf(0.3, 0.6, r)).toBe('warmer');
    expect(trendOf(0.6, 0.3, r)).toBe('colder');
    expect(trendOf(0.5, 0.505, r)).toBe('same');

    const s = hidden({ x: 0.5, y: 0.5 });
    const g = (x: number, y: number): Guess => ({ x, y, by: 2 });
    const clues = cluesOf({ ...s, guesses: [g(0.05, 0.05), g(0.2, 0.2), g(0.05, 0.95), g(0.6, 0.5), g(0.51, 0.52)] }, '8-10', 'words');
    expect(clues.map((c) => c.word)).toEqual(['Cool', 'Warmer!', 'Colder', 'Very hot!', 'Found him!']);
    expect(clues[0].heat).toBe(1);
    expect(clues[4].found).toBe(true);
    // Hot and cold only: no comparisons.
    const heat = cluesOf({ ...s, guesses: [g(0.05, 0.05), g(0.2, 0.2)] }, '11-13', 'heat');
    expect(heat.every((c) => c.trend === null)).toBe(true);
    expect(heat[1].heat!).toBeGreaterThan(heat[0].heat!);
    // No clues at all.
    expect(cluesOf({ ...s, guesses: [g(0.05, 0.05), g(0.45, 0.5)] }, '14+', 'none').map((c) => c.word)).toEqual(['Not there', 'Not there']);
  });

  it('gets hotter the closer a guess is', () => {
    const r = RADIUS['5-7'];
    const heats = [10, 6, 4, 3, 1.5].map((k) => heatOf(k * r, r));
    expect(heats).toEqual([0, 1, 2, 3, 4]);
  });

  it('gives clues by band, and learn mode gives words at any age', () => {
    expect(cluesFor('5-7', false)).toEqual({ level: 'words', areaAfter: 8 });
    expect(cluesFor('8-10', false)).toEqual({ level: 'words', areaAfter: 15 });
    expect(cluesFor('11-13', false)).toEqual({ level: 'heat', areaAfter: null });
    expect(cluesFor('14+', false)).toEqual({ level: 'none', areaAfter: null });
    expect(cluesFor('14+', true).level).toBe('words');
    expect(cluesFor('5-7', true).areaAfter).toBe(8);
  });

  it('puts the glow near him but not on him, and always around him', () => {
    for (const band of BANDS) {
      for (const media of [wide, tall]) {
        const random = seeded(band.length * 31 + media.width);
        for (let i = 0; i < 300; i++) {
          const spot = { x: random(), y: random() };
          const area = areaAround(spot, media, band, random);
          const reach = AREA_TIMES * RADIUS[band];
          const d = distance(area, spot, media);
          expect(d).toBeLessThan(reach * 0.75);
          expect(d).toBeGreaterThan(reach * 0.25);
          expect(area.x).toBeGreaterThanOrEqual(0);
          expect(area.x).toBeLessThanOrEqual(1);
          expect(area.y).toBeGreaterThanOrEqual(0);
          expect(area.y).toBeLessThanOrEqual(1);
        }
      }
    }
    // In a corner too.
    const corner = areaAround({ x: 0, y: 1 }, wide, '5-7', () => 0.99);
    expect(distance(corner, { x: 0, y: 1 }, wide)).toBeLessThan(AREA_TIMES * RADIUS['5-7']);
  });

  it('hides him once, and only while hiding', () => {
    const s = fresh(wide, '5-7');
    expect(s.turn).toBe('hider');
    const h = hide(s, { x: 0.3, y: 0.4 }, seeded(2))!;
    expect(h.turn).toBe('anyone');
    expect(h.spot).toEqual({ x: 0.3, y: 0.4 });
    expect(h.area).not.toBeNull();
    expect(hide(h, { x: 0.6, y: 0.6 })).toBeNull();
  });

  it('takes guesses from seekers but not the hider, and ends when he is found', () => {
    const hider = 1;
    expect(guess(fresh(wide, '8-10'), { x: 0.5, y: 0.5 }, 2, hider)).toBeNull();
    let s = hidden({ x: 0.7, y: 0.3 });
    expect(guess(s, { x: 0.1, y: 0.9 }, hider, hider)).toBeNull();

    const miss = guess(s, { x: 0.1, y: 0.9 }, 2, hider)!;
    expect(miss.found).toBe(false);
    expect(miss.state.guesses).toHaveLength(1);
    s = miss.state;

    const hit = guess(s, { x: 0.72, y: 0.31 }, 3, hider)!;
    expect(hit.found).toBe(true);
    expect(hit.state.foundBy).toBe(3);
    expect(hit.state.ended).toBe('found');
    // Someone guessing at the same moment is too late.
    expect(guess(hit.state, { x: 0.2, y: 0.2 }, 2, hider)).toBeNull();
    // Guesses outside the photo land on its edge.
    expect(guess(s, { x: 1.4, y: -0.2 }, 2, hider)!.state.guesses[1]).toEqual({ x: 1, y: 0, by: 2 });
  });

  it('lets seekers ask to see him after 10 guesses', () => {
    let s = hidden({ x: 0.9, y: 0.9 });
    for (let i = 0; i < SHOW_AFTER - 1; i++) s = guess(s, { x: 0.05, y: 0.05 + i * 0.01 }, 2, 1)!.state;
    expect(canShow(s)).toBe(false);
    s = guess(s, { x: 0.1, y: 0.1 }, 2, 1)!.state;
    expect(canShow(s)).toBe(true);
    expect(canShow({ ...s, ended: 'shown' })).toBe(false);
  });

  it('shows the glow after enough guesses for the band', () => {
    let s = hidden({ x: 0.5, y: 0.5 }, '5-7');
    expect(areaShown(s, 8)).toBe(false);
    for (let i = 0; i < 8; i++) s = guess(s, { x: 0.02, y: 0.02 }, 2, 1)!.state;
    expect(areaShown(s, 8)).toBe(true);
    expect(areaShown(s, 15)).toBe(false);
    expect(areaShown(s, null)).toBe(false);
  });

  it('moves the crosshair the same real distance each way, inside the photo', () => {
    const p = { x: 0.5, y: 0.5 };
    const right = nudge(p, 'ArrowRight', wide)!;
    const down = nudge(p, 'ArrowDown', wide)!;
    expect(distance(p, right, wide)).toBeCloseTo(distance(p, down, wide), 3);
    expect(nudge({ x: 0, y: 0 }, 'ArrowLeft', wide)).toEqual({ x: 0, y: 0 });
    expect(nudge(p, 'Enter', wide)).toBeNull();
    expect(placeWords({ x: 0.1, y: 0.1 })).toBe('at the top, on the far left');
    expect(placeWords({ x: 0.5, y: 0.5 })).toBe('halfway down, in the middle');
  });

  it('waits on the hider, then on every seeker who has not had a guess yet', () => {
    const hider = 1;
    const s = fresh(wide, '8-10');
    expect(waitsFor(s, hider, hider)).toBe(true);
    expect(waitsFor(s, hider, 2)).toBe(false);
    const seeking = hidden({ x: 0.7, y: 0.3 });
    expect(waitsFor(seeking, hider, hider)).toBe(false);
    expect(waitsFor(seeking, hider, 2)).toBe(true);
    const missed = guess(seeking, { x: 0.1, y: 0.9 }, 2, hider)!.state;
    expect(waitsFor(missed, hider, 2)).toBe(false);
    expect(waitsFor(missed, hider, 3)).toBe(true);
    const found = guess(missed, { x: 0.7, y: 0.3 }, 2, hider)!.state;
    expect(waitsFor(found, hider, 3)).toBe(false);
    expect(waitsFor({ ...seeking, ended: 'stopped' }, hider, 3)).toBe(false);
  });

  it('writes the summary', () => {
    expect(foundSummary('Mia', 7)).toBe('Mia found the Night Giraffe after 7 guesses');
    expect(foundSummary('Mia', 1)).toBe('Mia found the Night Giraffe with the very first guess');
  });
});
