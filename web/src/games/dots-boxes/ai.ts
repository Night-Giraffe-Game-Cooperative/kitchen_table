// The computer player for Dots and Boxes, one level for each age band. Gentle
// takes a free box only some of the time; steady always takes one; tricky also
// avoids drawing a third side while it can. Strong also counts what each line
// would give away when every line gives something, hands over the fewest boxes,
// and near the end keeps control by leaving the last two boxes of a chain (the
// double-cross) when the chains left make that worth it.
import type { Band } from '../bands';
import { pick } from '../common';
import { boxesBeside, drawLine, isOver, lineCount, sidesOf, type DotsState, type Level } from './rules';

export type { Level };

export const levelFor: Record<Band, Level> = { '5-7': 1, '8-10': 2, '11-13': 3, '14+': 4 };
export const levelName: Record<Level, string> = { 1: 'gentle', 2: 'steady', 3: 'tricky', 4: 'strong' };

/** The board's shape, worked out once per size: each box's sides and each line's boxes. */
interface Shape {
  lines: number;
  boxes: number;
  sides: Int16Array;
  beside: number[][];
}

const shapes = new Map<number, Shape>();

function shapeOf(n: number): Shape {
  let g = shapes.get(n);
  if (!g) {
    const boxes = n * n;
    const sides = new Int16Array(boxes * 4);
    for (let b = 0; b < boxes; b++) sides.set(sidesOf(n, b), b * 4);
    g = { lines: lineCount(n), boxes, sides, beside: Array.from({ length: lineCount(n) }, (_, l) => boxesBeside(n, l)) };
    shapes.set(n, g);
  }
  return g;
}

/** 1 for each drawn line. */
type Drawn = Uint8Array;

const drawnOf = (lines: readonly (string | null)[]): Drawn => Uint8Array.from(lines, (l) => (l == null ? 0 : 1));

function count(g: Shape, d: Drawn, box: number): number {
  const o = box * 4;
  return d[g.sides[o]] + d[g.sides[o + 1]] + d[g.sides[o + 2]] + d[g.sides[o + 3]];
}

function missing(g: Shape, d: Drawn, box: number): number {
  for (let k = 0; k < 4; k++) if (!d[g.sides[box * 4 + k]]) return g.sides[box * 4 + k];
  return -1;
}

/** How many boxes drawing this line finishes: 0, 1 or 2. */
function finishes(g: Shape, d: Drawn, line: number): number {
  let k = 0;
  for (const b of g.beside[line]) if (count(g, d, b) === 3) k++;
  return k;
}

/** Whether drawing this line puts a third side on a box, ready for the next player to take. */
function opens(g: Shape, d: Drawn, line: number): boolean {
  return g.beside[line].some((b) => count(g, d, b) === 2);
}

interface Bite {
  line: number;
  /** Boxes that line finished. */
  boxes: number;
}

/**
 * Takes every box that can be taken, one line at a time, always the
 * lowest-numbered box with three sides first, and draws them into `d`. A box
 * finished can give its neighbour a third side, so this eats along a chain.
 */
function eat(g: Shape, d: Drawn): Bite[] {
  const bites: Bite[] = [];
  for (;;) {
    let box = -1;
    for (let b = 0; b < g.boxes; b++) {
      if (count(g, d, b) === 3) {
        box = b;
        break;
      }
    }
    if (box < 0) return bites;
    const line = missing(g, d, box);
    bites.push({ line, boxes: finishes(g, d, line) });
    d[line] = 1;
  }
}

const total = (bites: Bite[]) => bites.reduce((a, b) => a + b.boxes, 0);

/**
 * The chains and loops left on a board where every box still to claim has
 * exactly two sides, so every line gives something away. Null when the board
 * isn't that simple (a box with fewer sides joins chains together).
 */
export function partsOf(size: number, lines: readonly (string | null)[]): { chains: number[]; loops: number[] } | null {
  return parts(shapeOf(size), drawnOf(lines));
}

function parts(g: Shape, d: Drawn): { chains: number[]; loops: number[] } | null {
  for (let b = 0; b < g.boxes; b++) {
    const k = count(g, d, b);
    if (k !== 4 && k !== 2) return null;
  }
  const seen = new Uint8Array(g.boxes);
  const chains: number[] = [];
  const loops: number[] = [];
  for (let b = 0; b < g.boxes; b++) {
    if (seen[b] || count(g, d, b) === 4) continue;
    let size = 0;
    let ends = 0;
    const stack = [b];
    seen[b] = 1;
    while (stack.length) {
      const x = stack.pop()!;
      size++;
      for (let k = 0; k < 4; k++) {
        const l = g.sides[x * 4 + k];
        if (d[l]) continue;
        const other = g.beside[l].find((y) => y !== x);
        if (other === undefined) ends++;
        else if (!seen[other]) {
          seen[other] = 1;
          stack.push(other);
        }
      }
    }
    (ends ? chains : loops).push(size);
  }
  return { chains, loops };
}

const worthMemo = new Map<string, number>();

const without = (xs: number[], x: number) => {
  const i = xs.indexOf(x);
  return [...xs.slice(0, i), ...xs.slice(i + 1)];
};

/**
 * Boxes ahead (or behind, if negative) for the player who has to open one of
 * these chains or loops next, if both sides play well. Whoever is handed a
 * chain of 3 or more can take it all, or take all but 2 and hand those back
 * (all but 4 of a loop) to make the other side open the next one.
 */
export function worth(chains: number[], loops: number[] = []): number {
  if (!chains.length && !loops.length) return 0;
  const key = `${[...chains].sort((a, b) => a - b)}|${[...loops].sort((a, b) => a - b)}`;
  const known = worthMemo.get(key);
  if (known !== undefined) return known;
  let best = -Infinity;
  for (const c of new Set(chains)) {
    const v = worth(without(chains, c), loops);
    // A chain of 1 or 2 can be opened so it can't be handed back: draw the line between the two boxes.
    best = Math.max(best, c <= 2 ? -c - v : Math.min(-c - v, 4 - c + v));
  }
  for (const c of new Set(loops)) {
    const v = worth(chains, without(loops, c));
    best = Math.max(best, Math.min(-c - v, 8 - c + v));
  }
  worthMemo.set(key, best);
  return best;
}

/**
 * The double-cross. When the last two boxes of a chain are all that's left to
 * take, and taking them would mean opening the next chain, it can be better
 * to draw the far side of the last box instead: the other side gets both
 * boxes with one line, then has to open a chain for us. Only done when the
 * board is simple chains and loops, so the sums are right. -1 if not.
 */
function doubleCross(g: Shape, d: Drawn): number {
  const after = d.slice();
  const bites = eat(g, after);
  if (bites.length !== 2 || bites[0].boxes !== 1 || bites[1].boxes !== 1) return -1;
  // Only the first box has three sides; the line that finishes it gives the second its third.
  const threes: number[] = [];
  for (let b = 0; b < g.boxes; b++) if (count(g, d, b) === 3) threes.push(b);
  if (threes.length !== 1) return -1;
  const first = threes[0];
  const second = g.beside[bites[0].line].find((b) => b !== first);
  if (second === undefined || count(g, d, second) !== 2) return -1;
  const far = bites[1].line;
  if (!g.beside[far].includes(second)) return -1;
  // The far side must not give anything else away.
  const beyond = g.beside[far].find((b) => b !== second);
  if (beyond !== undefined && count(g, d, beyond) >= 2) return -1;
  const left = parts(g, after);
  if (!left || !(left.chains.length + left.loops.length)) return -1;
  // Taking both: +2, then we open next. Handing them back: -2, then they open next.
  return worth(left.chains, left.loops) < -2 ? far : -1;
}

/** When every line gives something away: the line that gives the fewest boxes, opening a chain of 2 in its middle. */
function fewest(g: Shape, d: Drawn, open: number[], random: () => number): number {
  let best = Infinity;
  let choices: number[] = [];
  for (const l of open) {
    const t = d.slice();
    t[l] = 1;
    let threes = 0;
    for (const b of g.beside[l]) if (count(g, t, b) === 3) threes++;
    const score = total(eat(g, t)) * 4 - threes;
    if (score < best) {
      best = score;
      choices = [l];
    } else if (score === best) choices.push(l);
  }
  return pick(choices, random);
}

/** The computer's next line. -1 if every line is drawn. */
export function chooseLine(size: number, lines: readonly (string | null)[], level: Level, random: () => number = Math.random): number {
  const g = shapeOf(size);
  const d = drawnOf(lines);
  const open: number[] = [];
  for (let l = 0; l < g.lines; l++) if (!d[l]) open.push(l);
  if (!open.length) return -1;

  const takes = open.filter((l) => finishes(g, d, l) > 0);
  // Gentle takes a free box only half the time.
  if (takes.length && (level > 1 || random() < 0.5)) {
    if (level < 4) return pick(takes, random);
    const cross = doubleCross(g, d);
    // Strong eats in a fixed order, so it can see the last two boxes of a chain coming.
    return cross >= 0 ? cross : eat(g, d.slice())[0].line;
  }
  if (level <= 2) return pick(open, random);

  const safe = open.filter((l) => !opens(g, d, l));
  if (safe.length) return pick(safe, random);
  if (level === 3) return pick(open, random);
  return fewest(g, d, open, random);
}

/**
 * Boxes the next player could take straight after this line, counting along
 * any chain it opens. 0 for a line that gives nothing away, or that finishes a
 * box (the same player goes again).
 */
export function giveaway(size: number, lines: readonly (string | null)[], line: number): number {
  const g = shapeOf(size);
  const d = drawnOf(lines);
  if (d[line] || finishes(g, d, line) > 0 || !opens(g, d, line)) return 0;
  d[line] = 1;
  return total(eat(g, d));
}

/** Whether there's still a line that finishes a box or gives nothing away. */
export function anySafeLine(size: number, lines: readonly (string | null)[]): boolean {
  const g = shapeOf(size);
  const d = drawnOf(lines);
  for (let l = 0; l < g.lines; l++) if (!d[l] && (finishes(g, d, l) > 0 || !opens(g, d, l))) return true;
  return false;
}

/** The computer draws until its turn ends: one line, or several when it finishes boxes. */
export function computerTurn(s: DotsState, seats: readonly string[], random: () => number = Math.random): DotsState {
  const seat = s.turn;
  let st = s;
  for (let guard = st.lines.length; guard > 0 && st.turn === seat && !isOver(st); guard--) {
    const next = drawLine(st, chooseLine(st.size, st.lines, st.level ?? 2, random), seats);
    if (!next) break;
    st = next.state;
  }
  return st;
}
