import { describe, expect, it } from 'vitest';
import {
  close,
  dishJapanese,
  dishName,
  maki,
  newGame,
  nextStep,
  nigiri,
  orderFor,
  orderWords,
  roll,
  send,
  side,
  starsFor,
  stillToMake,
  summary,
  tap,
  type Board,
  type Dish,
  type State,
} from './rules';

const t0 = Date.UTC(2026, 9, 26, 18);

/** Serves every customer waiting, the way a quick family would. */
function serveAll(s: State, by = 1, at = t0): State {
  let next = s;
  for (const d of s.diners) if (!d.served) next = send(next, d.order, by, at)!.state;
  return next;
}

describe('Sushi Train', () => {
  it('makes nigiri from rice and a topping, and rolls from seaweed, rice and fillings', () => {
    let r = tap(null, 'rice');
    expect(r.board).toEqual({ base: 'rice' });
    r = tap(r.board, 'salmon');
    expect(r.made).toBe('nigiri:salmon');
    expect(r.board).toBeNull();

    let b: Board = tap(null, 'nori').board;
    expect(tap(b, 'cucumber').note).toMatch(/Rice goes on the seaweed first/);
    b = tap(b, 'rice').board;
    expect(roll(b)).toBeNull();
    b = tap(b, 'salmon').board;
    b = tap(b, 'avocado').board;
    expect(tap(b, 'tuna').note).toMatch(/Two fillings/);
    expect(roll(b)).toBe('maki:avocado+salmon');
    expect(maki(['salmon', 'avocado'])).toBe('maki:avocado+salmon');

    expect(tap(null, 'miso').made).toBe('side:miso');
    expect(tap(null, 'egg').note).toMatch(/Start with rice/);
  });

  it('names dishes in English and Japanese', () => {
    expect(dishName('nigiri:egg')).toBe('Egg nigiri');
    expect(dishName('maki:avocado+salmon')).toBe('Avocado and salmon roll');
    expect(dishJapanese('maki:cucumber')).toBe('kappa maki');
    expect(dishJapanese('nigiri:tuna')).toBe('maguro nigiri');
    expect(orderWords(['nigiri:salmon', 'nigiri:salmon', 'side:miso'])).toBe('2 salmon nigiri and miso soup');
  });

  it('orders get harder each wave, and stay simple for the youngest', () => {
    for (let seed = 1; seed < 30; seed++) {
      expect(orderFor(seed, '8-10', 0, 0)).toHaveLength(1);
      expect(orderFor(seed, '8-10', 0, 0)[0]).toMatch(/^nigiri:/);
      expect(orderFor(seed, '8-10', 2, 1)[0]).toMatch(/^maki:[a-z]+$/);
      expect(orderFor(seed, '14+', 5, 0)).toHaveLength(3);
      for (let w = 0; w < 4; w++) {
        const order = orderFor(seed, '5-7', w, 0);
        expect(order.length).toBeLessThanOrEqual(2);
        expect(order.join()).not.toMatch(/tuna|prawn|avocado|\+/);
      }
    }
  });

  it('sends a plate to the customer who ordered it, and the next wave sits down', () => {
    const s = newGame(7, 2, t0, '8-10');
    expect(s.diners).toHaveLength(3);
    const first = s.diners[0].order;
    const sent = send(s, first, 5, t0 + 5000)!;
    expect(sent.to).toBe(0);
    expect(sent.state.diners[0].served).toEqual({ by: 5, at: t0 + 5000 });
    expect(sent.state.served).toBe(1);

    const next = serveAll(sent.state, 5, t0 + 10_000);
    expect(next.wave).toBe(1);
    expect(next.stars).toEqual([3]);
    expect(next.diners.some((d) => d.served)).toBe(false);
  });

  it("keeps a plate nobody ordered going round, until someone orders it", () => {
    let s = newGame(3, 1, t0, '8-10');
    // Find a plate the second wave wants but the first doesn't.
    const later = orderFor(3, '8-10', 1, 0);
    const wanted = s.diners.some((d) => d.order.join() === later.join());
    const sent = send(s, later, 2, t0)!;
    if (!wanted) {
      expect(sent.to).toBeNull();
      expect(sent.state.spares).toHaveLength(1);
    }
    s = serveAll(sent.state, 1, t0 + 1000);
    // The second wave's first customer gets the plate already going round.
    expect(s.wave).toBe(1);
    expect(s.diners[0].served?.by).toBe(2);
    expect(s.spares).toHaveLength(0);
  });

  it('two people sending the same dish: the second goes round the belt', () => {
    const s = newGame(11, 3, t0, '5-7');
    const order = s.diners[0].order;
    const a = send(s, order, 1, t0)!.state;
    const b = send(a, order, 2, t0)!;
    const otherWants = s.diners.slice(1).some((d) => d.order.join() === order.join());
    expect(b.to === null).toBe(!otherWants);
  });

  it('ends after the last wave, with stars for quick waves', () => {
    let s = newGame(5, 1, t0, '5-7');
    expect(s.waves).toBe(4);
    let at = t0;
    while (!s.ended) {
      at += 10_000;
      s = serveAll(s, 1, at);
    }
    expect(s.ended).toBe('done');
    expect(s.stars).toHaveLength(4);
    expect(summary(s)).toMatch(/^The sushi bar served \d+ customers and earned \d+ ⭐$/);
    expect(send(s, ['nigiri:egg'], 1, at)).toBeNull();
    expect(close(newGame(1, 1, t0))!.ended).toBe('closed');
  });

  it('gives fewer stars for a slow wave', () => {
    const s = newGame(2, 1, t0, '8-10');
    const dishes = s.diners.reduce((n, d) => n + d.order.length, 0);
    expect(starsFor(s, dishes * 20_000)).toBe(3);
    expect(starsFor(s, dishes * 30_000)).toBe(2);
    expect(starsFor(s, dishes * 60_000)).toBe(1);
  });

  it('shows the youngest what to tap next', () => {
    const order: Dish[] = [nigiri('salmon'), maki(['cucumber']), side('miso')];
    expect(nextStep(order, [], null)).toBe('rice');
    expect(nextStep(order, [], { base: 'rice' })).toBe('salmon');
    expect(nextStep(order, ['nigiri:salmon'], null)).toBe('nori');
    expect(nextStep(order, ['nigiri:salmon'], { base: 'nori', rice: false, fill: [] })).toBe('rice');
    expect(nextStep(order, ['nigiri:salmon'], { base: 'nori', rice: true, fill: [] })).toBe('cucumber');
    expect(nextStep(order, ['nigiri:salmon'], { base: 'nori', rice: true, fill: ['cucumber'] })).toBe('roll');
    expect(nextStep(order, ['nigiri:salmon', 'maki:cucumber'], null)).toBe('miso');
    expect(nextStep(order, ['nigiri:salmon', 'maki:cucumber', 'side:miso'], null)).toBe('send');
    expect(nextStep(order, ['nigiri:salmon'], { base: 'nori', rice: true, fill: ['tuna'] })).toBe('bin');
    expect(stillToMake(['nigiri:egg', 'nigiri:egg'], ['nigiri:egg'])).toEqual(['nigiri:egg']);
  });
});
