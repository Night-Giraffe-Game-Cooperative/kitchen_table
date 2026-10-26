import { describe, expect, it } from 'vitest';
import {
  BOUNDS,
  DAY,
  advance,
  age,
  canFeed,
  dayOf,
  feed,
  mood,
  needsYou,
  newlyUnlocked,
  nextJob,
  plant,
  seasonOf,
  setAway,
  setPot,
  shootEnds,
  startOf,
  sweep,
  toggleExtra,
  trim,
  unlocked,
  visitorFor,
  water,
} from './rules';

// Midday on 15 May 2027, in the growing season.
const may = Date.UTC(2027, 4, 15, 12);
const days = (n: number) => n * DAY;

describe('Bonsai', () => {
  it('arrives thirsty and a little shaggy, so the first jobs are a drink and a trim', () => {
    const s = plant('maple', ' Momiji ', may, 42, '8-10');
    expect(s.name).toBe('Momiji');
    expect(s.water).toBeLessThan(0.3);
    expect(nextJob(s, may)).toBe('water');
    const wet = water(s, may).state!;
    expect(nextJob(wet, may)).toBe('trim');
    expect(age(s, may)).toBe('Planted today');
    expect(age(s, may + days(1))).toBe('1 day old');
  });

  it("won't take more water when the soil is still wet", () => {
    const wet = water(plant('pine', 'Matsu', may, 1), may).state!;
    const again = water(wet, may + 3_600_000);
    expect(again.state).toBeNull();
    expect(again.note).toMatch(/still wet/);
  });

  it('dries out over a few days, and dries more slowly for younger children', () => {
    const young = water(plant('maple', 'M', may, 7, '5-7'), may).state!;
    const old = water(plant('maple', 'M', may, 7, '14+'), may).state!;
    expect(advance(young, may + days(2)).water).toBeGreaterThan(advance(old, may + days(2)).water);
    expect(advance(old, may + days(4)).water).toBe(0);
  });

  it('comes out the same however often it is looked at', () => {
    const s = water(plant('cherry', 'Sakura', may, 9), may).state!;
    const once = advance(s, may + days(6));
    let step = s;
    for (let h = 6; h <= 6 * 24; h += 6) step = advance(step, may + h * 3_600_000);
    expect(step.twigs).toEqual(once.twigs);
    expect(step.shoots).toEqual(once.shoots);
    expect(step.water).toBeCloseTo(once.water, 6);
  });

  it('grows new shoots when watered, and stops growing when thirsty', () => {
    let s = water(plant('maple', 'M', may, 3), may).state!;
    s = { ...s, shoots: [] };
    // Watered every other day for a fortnight: new shoots.
    for (let d = 2; d <= 14; d += 2) s = water(s, may + days(d)).state ?? s;
    expect(s.shoots.length).toBeGreaterThan(0);
    // Nobody waters it: it stops, droops, but never dies.
    const dry = advance(s, may + days(40));
    expect(dry.thirsty).toBeGreaterThan(3);
    expect(dry.twigs.every((t) => t.r === 0 || t.r >= 12)).toBe(true);
    expect(Math.max(...dry.twigs.map((t) => t.r))).toBeLessThan(Math.max(...s.twigs.map((t) => t.r)));
    expect(mood(dry, may + days(40))).toMatch(/very thirsty/);
    expect(water(dry, may + days(40)).state!.thirsty).toBe(0);
  });

  it('keeps every shoot and branch inside the picture', () => {
    let s = water(plant('pine', 'P', may, 11), may).state!;
    for (let d = 1; d <= 120; d++) s = water(s, may + days(d)).state ?? advance(s, may + days(d));
    for (const t of s.twigs) {
      expect(t.x).toBeGreaterThanOrEqual(BOUNDS.left - 1);
      expect(t.x).toBeLessThanOrEqual(BOUNDS.right + 1);
      expect(t.y).toBeGreaterThanOrEqual(BOUNDS.top - 1);
    }
    const byId = new Map(s.twigs.map((t) => [t.id, t]));
    for (const sh of s.shoots) {
      const tip = shootEnds(byId.get(sh.on)!, sh);
      expect(tip.x1).toBeGreaterThanOrEqual(BOUNDS.left - 1);
      expect(tip.x1).toBeLessThanOrEqual(BOUNDS.right + 1);
    }
    // Shoots left alone became branches.
    expect(s.twigs.length).toBeGreaterThan(9);
  });

  it('gets bushier where it is trimmed', () => {
    const s = water(plant('maple', 'M', may, 5), may).state!;
    const sh = s.shoots[0];
    const pad = s.twigs.find((t) => t.id === sh.on)!;
    const done = trim(s, sh.id, may);
    const after = done.state!.twigs.find((t) => t.id === sh.on)!;
    expect(after.d).toBe(pad.d + 1);
    expect(done.state!.shoots.some((x) => x.id === sh.id)).toBe(false);
    expect(done.note).toMatch(/1 more/);
    expect(trim(done.state!, sh.id, may).state).toBeNull();
  });

  it('is fed once a fortnight, and not in winter', () => {
    const s = plant('cherry', 'S', may, 2);
    const fed = feed(s, may).state!;
    expect(canFeed(fed, may + days(5))).toBe('soon');
    expect(feed(fed, may + days(5)).note).toMatch(/9 days/);
    expect(canFeed(fed, may + days(14))).toBe('yes');
    const jan = Date.UTC(2028, 0, 10, 12);
    expect(canFeed(fed, jan)).toBe('winter');
    expect(feed(fed, jan).state).toBeNull();
  });

  it('drops leaves in autumn to sweep up, but a pine keeps its needles', () => {
    const oct = Date.UTC(2026, 9, 1, 12);
    let maple = water(plant('maple', 'M', oct, 8), oct).state!;
    let pine = water(plant('pine', 'P', oct, 8), oct).state!;
    for (let d = 2; d <= 20; d += 2) {
      maple = water(maple, oct + days(d)).state ?? maple;
      pine = water(pine, oct + days(d)).state ?? pine;
    }
    expect(maple.fallen).toBeGreaterThan(2);
    expect(pine.fallen).toBe(0);
    expect(sweep(maple, oct + days(20)).state!.fallen).toBe(0);
    expect(sweep(pine, oct + days(20)).state).toBeNull();
    expect(mood(maple, oct + days(20))).toMatch(/turned for autumn/);
  });

  it('sleeps through the winter without its leaves', () => {
    const dec = Date.UTC(2026, 11, 20, 12);
    const s = water(plant('maple', 'Momiji', dec, 4), dec).state!;
    const shoots = s.shoots.length;
    const later = advance(s, dec + days(10));
    expect(later.shoots.length).toBe(shoots);
    expect(mood(water(later, dec + days(10)).state!, dec + days(10))).toMatch(/sleeping for the winter/);
    expect(seasonOf(dayOf(dec))).toBe('winter');
  });

  it('is looked after while the family is away', () => {
    const s = setAway(water(plant('maple', 'M', may, 6), may).state!, true, may);
    const back = advance(s, may + days(20));
    expect(back.water).toBeGreaterThanOrEqual(0.6);
    expect(back.thirsty).toBe(0);
    expect(nextJob(back, may + days(20))).toBeNull();
    expect(needsYou(back)).toBe(false);
    expect(setAway(back, false, may + days(20)).away).toBeUndefined();
  });

  it('unlocks pots and things to put by it, one caring day at a time', () => {
    let s = plant('maple', 'M', may, 6);
    expect(unlocked(s, 'blue')).toBe(true);
    expect(setPot(s, 'clay')).toBeNull();
    const before = s;
    for (let d = 0; d < 3; d++) s = water(s, may + days(d * 2)).state!;
    // Twice on the same day counts once.
    expect(sweep({ ...s, fallen: 2 }, may + days(4)).state!.cared).toBe(3);
    expect(s.cared).toBe(3);
    expect(newlyUnlocked(before, s).map((u) => u.what)).toEqual(['moss', 'clay']);
    expect(setPot(s, 'clay')!.pot).toBe('clay');
    expect(toggleExtra(s, 'moss')!.extras).toEqual(['moss']);
    expect(toggleExtra({ ...s, extras: ['moss'] }, 'moss')!.extras).toEqual([]);
    expect(toggleExtra(s, 'lantern')).toBeNull();
  });

  it('has the Night Giraffe visit some nights, and the same visitor all day', () => {
    const s = plant('maple', 'M', may, 6);
    const nights = Array.from({ length: 30 }, (_, i) => visitorFor(s, startOf(dayOf(may) + i) + 21 * 3_600_000));
    expect(nights.some((v) => v === 'night_giraffe')).toBe(true);
    expect(nights.every((v) => v === 'night_giraffe' || v === null)).toBe(true);
    const day = startOf(dayOf(may));
    expect(visitorFor(s, day + 9 * 3_600_000)).toBe(visitorFor(s, day + 16 * 3_600_000));
  });
});
