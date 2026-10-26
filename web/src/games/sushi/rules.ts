// Sushi Train: the family runs a sushi bar together. Customers sit at the
// counter and order; everyone makes dishes at their own station and sends
// plates down the belt. A plate that matches an order goes to that customer;
// one nobody ordered goes round the belt until someone does. Each wave of
// customers orders something a bit harder, from one piece of nigiri to rolls
// and sides together.
//
// Making a dish happens on each person's own screen; only a plate sent down
// the belt is a move, so people never get in each other's way.

import { bandOf, type Band } from '../bands';

export type Topping = 'salmon' | 'tuna' | 'egg' | 'prawn' | 'cucumber' | 'avocado';
export type Side = 'edamame' | 'miso';
export type Ingredient = 'rice' | 'nori' | Topping | Side;

/**
 * A dish, as a short name: "nigiri:salmon", "maki:cucumber",
 * "maki:avocado+salmon" (fillings in order), or "side:miso".
 */
export type Dish = string;

export interface Diner {
  /** Which animal, from DINERS. */
  who: number;
  order: Dish[];
  served?: { by: number; at: number };
}

export interface Plate {
  id: number;
  by: number;
  dishes: Dish[];
}

/** A plate on its way: to a diner's seat, or round the belt when nobody ordered it. */
export interface Sent extends Plate {
  to: number | null;
}

export interface State {
  turn: 'anyone';
  band?: Band;
  seed: number;
  /** How many customers sit down at once. */
  size: number;
  wave: number;
  waves: number;
  waveAt: number;
  diners: Diner[];
  /** Plates going round that nobody has ordered yet, oldest first. */
  spares: Plate[];
  /** The last plates sent, for everyone's belt to show. */
  log: Sent[];
  next: number;
  served: number;
  /** Stars for each wave finished: quicker is more. */
  stars: number[];
  ended?: 'done' | 'closed';
}

export const TOPPINGS: Topping[] = ['salmon', 'tuna', 'egg', 'prawn', 'cucumber', 'avocado'];
export const SIDES: Side[] = ['edamame', 'miso'];
const MOST_SPARES = 5;
const MOST_LOG = 12;
/** Most dishes on one plate. */
export const PLATE_HOLDS = 3;

/** Names in English, and in Japanese as they're said at a sushi bar. */
export const toppingNames: Record<Topping, { en: string; ja: string }> = {
  salmon: { en: 'Salmon', ja: 'sāmon' },
  tuna: { en: 'Tuna', ja: 'maguro' },
  egg: { en: 'Egg', ja: 'tamago' },
  prawn: { en: 'Prawn', ja: 'ebi' },
  cucumber: { en: 'Cucumber', ja: 'kyūri' },
  avocado: { en: 'Avocado', ja: 'abokado' },
};
export const sideNames: Record<Side, { en: string; ja: string }> = {
  edamame: { en: 'Edamame beans', ja: 'edamame' },
  miso: { en: 'Miso soup', ja: 'misoshiru' },
};
export const ingredientNames: Record<Ingredient, string> = {
  rice: 'Rice',
  nori: 'Seaweed',
  ...Object.fromEntries(TOPPINGS.map((t) => [t, toppingNames[t].en])),
  ...Object.fromEntries(SIDES.map((s) => [s, sideNames[s].en])),
} as Record<Ingredient, string>;

/** The customers, with what they say when their food comes. */
export const DINERS = [
  { emoji: '🐱', name: 'Cat' },
  { emoji: '🐼', name: 'Panda' },
  { emoji: '🦊', name: 'Fox' },
  { emoji: '🐻', name: 'Bear' },
  { emoji: '🐸', name: 'Frog' },
  { emoji: '🐰', name: 'Rabbit' },
  { emoji: '🐧', name: 'Penguin' },
  { emoji: '🐨', name: 'Koala' },
  { emoji: '🐵', name: 'Monkey' },
  { emoji: '🦉', name: 'Owl' },
];

/** The same number between 0 and 1 for the same inputs, every time. */
export function rand(...n: number[]): number {
  let h = 2166136261;
  for (const x of n) {
    h = Math.imul(h ^ Math.round(x * 1000), 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

const pickOf = <T>(xs: T[], r: number): T => xs[Math.floor(r * xs.length) % xs.length];

/** What's on the menu for an age band: fewer toppings for the youngest. */
export function menuFor(band: Band): { toppings: Topping[]; fillings: Topping[] } {
  if (band === '5-7') return { toppings: ['salmon', 'egg', 'cucumber'], fillings: ['cucumber', 'salmon'] };
  if (band === '8-10') return { toppings: ['salmon', 'tuna', 'egg', 'prawn', 'cucumber'], fillings: ['cucumber', 'salmon', 'tuna'] };
  return { toppings: TOPPINGS, fillings: ['cucumber', 'salmon', 'tuna', 'avocado', 'egg'] };
}

/** How many waves of customers in a day at the sushi bar. */
export const wavesFor = (band: Band) => (band === '5-7' ? 4 : band === '8-10' ? 5 : 6);

export const nigiri = (t: Topping): Dish => `nigiri:${t}`;
export const maki = (fill: Topping[]): Dish => `maki:${[...fill].sort().join('+')}`;
export const side = (s: Side): Dish => `side:${s}`;

/** One customer's order, harder with each wave. */
export function orderFor(seed: number, band: Band, wave: number, slot: number): Dish[] {
  const { toppings, fillings } = menuFor(band);
  const r = (k: number) => rand(seed, wave, slot, k);
  const n = () => nigiri(pickOf(toppings, r(1)));
  const roll1 = () => maki([pickOf(fillings, r(2))]);
  const roll2 = () => {
    const a = pickOf(fillings, r(3));
    const b = pickOf(
      fillings.filter((f) => f !== a),
      r(4),
    );
    return maki([a, b]);
  };
  const s = () => side(pickOf(SIDES, r(5)));
  const young = band === '5-7';
  switch (Math.min(wave, 5)) {
    case 0:
      return [n()];
    case 1:
      return r(6) < 0.5 ? [n(), nigiri(pickOf(toppings, r(7)))] : [n()];
    case 2:
      return [roll1()];
    case 3:
      return young ? [r(6) < 0.5 ? n() : roll1(), s()] : [n(), roll1()];
    case 4:
      return young ? [n(), roll1()] : r(6) < 0.5 ? [roll2()] : [roll1(), s()];
    default:
      return [n(), roll2(), s()];
  }
}

export const sameDishes = (a: Dish[], b: Dish[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Customers for a wave, each a different animal. */
function seat(s: Pick<State, 'seed' | 'band' | 'size'>, wave: number): Diner[] {
  const band = bandOf(s);
  const start = Math.floor(rand(s.seed, wave, 99) * DINERS.length);
  return Array.from({ length: s.size }, (_, slot) => ({ who: (start + slot * 3) % DINERS.length, order: orderFor(s.seed, band, wave, slot) }));
}

/** Plates already going round go to new customers who ordered just that. */
function serveSpares(s: State, now: number): State {
  let spares = s.spares;
  let log = s.log;
  let served = s.served;
  const diners = s.diners.map((d) => {
    if (d.served) return d;
    const plate = spares.find((p) => sameDishes(p.dishes, d.order));
    if (!plate) return d;
    spares = spares.filter((p) => p !== plate);
    served++;
    log = [...log, { ...plate, to: s.diners.indexOf(d) }].slice(-MOST_LOG);
    return { ...d, served: { by: plate.by, at: now } };
  });
  return { ...s, diners, spares, log, served };
}

/** Stars for a wave: quick is three, steady is two, and finishing at all is one. */
export function starsFor(s: Pick<State, 'diners' | 'band'>, took: number): number {
  const dishes = s.diners.reduce((n, d) => n + d.order.length, 0);
  const par = (bandOf(s) === '5-7' ? 30 : 20) * 1000 * dishes;
  return took <= par ? 3 : took <= par * 2 ? 2 : 1;
}

export function newGame(seed: number, players: number, now: number, band?: Band): State {
  const base = { seed, band, size: Math.min(4, Math.max(2, players + 1)) };
  return {
    turn: 'anyone',
    ...(band ? { band } : {}),
    seed,
    size: base.size,
    wave: 0,
    waves: wavesFor(band ?? '8-10'),
    waveAt: now,
    diners: seat(base, 0),
    spares: [],
    log: [],
    next: 1,
    served: 0,
    stars: [],
  };
}

/**
 * A plate sent down the belt. It goes to the first customer waiting for
 * exactly that, or round the belt for later. Serving the last customer of a
 * wave brings the next wave in, or ends the day.
 */
export function send(s: State, dishes: Dish[], by: number, now: number): { state: State; to: number | null } | null {
  if (s.ended || !dishes.length || dishes.length > PLATE_HOLDS) return null;
  const plate: Plate = { id: s.next, by, dishes };
  const to = s.diners.findIndex((d) => !d.served && sameDishes(d.order, dishes));
  if (to < 0) {
    // Nobody wants it yet: round it goes, and the oldest spare goes back to the kitchen.
    const spares = [...s.spares, plate].slice(-MOST_SPARES);
    return { state: { ...s, next: s.next + 1, spares, log: [...s.log, { ...plate, to: null }].slice(-MOST_LOG) }, to: null };
  }
  const diners = s.diners.map((d, i) => (i === to ? { ...d, served: { by, at: now } } : d));
  let next: State = { ...s, next: s.next + 1, diners, served: s.served + 1, log: [...s.log, { ...plate, to }].slice(-MOST_LOG) };
  if (diners.every((d) => d.served)) next = nextWave(next, now);
  return { state: next, to };
}

function nextWave(s: State, now: number): State {
  const stars = [...s.stars, starsFor(s, now - s.waveAt)];
  if (s.wave + 1 >= s.waves) return { ...s, stars, ended: 'done' };
  const wave = s.wave + 1;
  return serveSpares({ ...s, stars, wave, waveAt: now, diners: seat(s, wave) }, now);
}

export function close(s: State): State | null {
  return s.ended ? null : { ...s, ended: 'closed' };
}

/** What someone is making at their station: a ball of rice, or seaweed with rice and fillings on. */
export type Board = { base: 'rice' } | { base: 'nori'; rice: boolean; fill: Topping[] } | null;

const isTopping = (i: Ingredient): i is Topping => (TOPPINGS as string[]).includes(i);
const isSide = (i: Ingredient): i is Side => (SIDES as string[]).includes(i);

/**
 * Tapping an ingredient at the station. A topping on rice makes nigiri
 * straight away, and a side is ready as it is. A roll needs Roll pressing.
 */
export function tap(board: Board, i: Ingredient): { board: Board; made?: Dish; note?: string } {
  if (isSide(i)) return board ? { board, note: 'Finish what you are making first, or bin it.' } : { board: null, made: side(i) };
  if (!board) {
    if (i === 'rice') return { board: { base: 'rice' } };
    if (i === 'nori') return { board: { base: 'nori', rice: false, fill: [] } };
    return { board, note: 'Start with rice for nigiri, or seaweed for a roll.' };
  }
  if (board.base === 'rice') {
    if (isTopping(i)) return { board: null, made: nigiri(i) };
    return { board, note: 'Now put a topping on the rice.' };
  }
  if (i === 'rice') return board.rice ? { board, note: 'That roll has rice already.' } : { board: { ...board, rice: true } };
  if (i === 'nori') return { board, note: 'One sheet of seaweed is enough.' };
  if (!board.rice) return { board, note: 'Rice goes on the seaweed first.' };
  if (board.fill.length >= 2) return { board, note: 'Two fillings is plenty. Press Roll it!' };
  if (board.fill.includes(i)) return { board, note: `It has ${toppingNames[i].en.toLowerCase()} already.` };
  return { board: { ...board, fill: [...board.fill, i] } };
}

export const canRoll = (board: Board) => board?.base === 'nori' && board.rice && board.fill.length > 0;

export function roll(board: Board): Dish | null {
  return canRoll(board) && board?.base === 'nori' ? maki(board.fill) : null;
}

/** The dishes of an order still to make, given what's on the plate. */
export function stillToMake(order: Dish[], plate: Dish[]): Dish[] {
  const left = [...plate];
  return order.filter((d) => {
    const i = left.indexOf(d);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
}

/**
 * For the youngest, what to tap next to make an order: the ingredient that
 * glows, Roll, or Send. Null when what's on the board doesn't belong in it.
 */
export function nextStep(order: Dish[], plate: Dish[], board: Board): Ingredient | 'roll' | 'send' | 'bin' | null {
  const todo = stillToMake(order, plate);
  if (!todo.length) return board ? 'bin' : sameDishes(order, plate) ? 'send' : null;
  if (board) {
    const target = todo.find((d) => (board.base === 'rice' ? d.startsWith('nigiri:') : d.startsWith('maki:')) && fits(d, board));
    if (!target) return 'bin';
    if (board.base === 'rice') return target.split(':')[1] as Topping;
    if (!board.rice) return 'rice';
    const want = target.split(':')[1].split('+') as Topping[];
    const missing = want.find((t) => !board.fill.includes(t));
    return missing ?? 'roll';
  }
  const d = todo[0];
  const [kind, what] = d.split(':');
  return kind === 'nigiri' ? 'rice' : kind === 'maki' ? 'nori' : (what as Side);
}

/** Whether what's on the board can still become this dish. */
function fits(d: Dish, board: NonNullable<Board>): boolean {
  const [kind, what] = d.split(':');
  if (board.base === 'rice') return kind === 'nigiri';
  if (kind !== 'maki') return false;
  const want = what.split('+');
  return board.fill.every((f) => want.includes(f));
}

/** "Salmon nigiri", "Cucumber and avocado roll", "Miso soup". */
export function dishName(d: Dish): string {
  const [kind, what] = d.split(':');
  if (kind === 'nigiri') return `${toppingNames[what as Topping].en} nigiri`;
  if (kind === 'side') return sideNames[what as Side].en;
  const fill = what.split('+').map((t, i) => (i ? toppingNames[t as Topping].en.toLowerCase() : toppingNames[t as Topping].en));
  return `${fill.join(' and ')} roll`;
}

/** What it's called at a sushi bar in Japan. A cucumber roll is a kappa maki, after the cucumber-loving river imp. */
export function dishJapanese(d: Dish): string {
  const [kind, what] = d.split(':');
  if (kind === 'nigiri') return `${toppingNames[what as Topping].ja} nigiri`;
  if (kind === 'side') return sideNames[what as Side].ja;
  if (what === 'cucumber') return 'kappa maki';
  if (what === 'tuna') return 'tekka maki';
  return 'maki';
}

/** "Salmon nigiri and a cucumber roll", for the order in words. */
export function orderWords(order: Dish[]): string {
  const counts = new Map<string, number>();
  for (const d of order) counts.set(d, (counts.get(d) ?? 0) + 1);
  const parts = [...counts].map(([d, n]) => (n > 1 ? `${n} ${dishName(d).toLowerCase()}` : dishName(d).toLowerCase()));
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function summary(s: State): string {
  const stars = s.stars.reduce((a, b) => a + b, 0);
  return `The sushi bar served ${s.served} ${s.served === 1 ? 'customer' : 'customers'}${stars ? ` and earned ${stars} ⭐` : ''}`;
}
