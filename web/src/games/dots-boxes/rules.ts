// Dots and Boxes rules. A square grid of dots; players take turns drawing one
// line between two dots side by side. Drawing the fourth side of a box claims
// it and gives another go. When every line is drawn, most boxes wins. Pure, so
// the board, the computer player and the tests all share them.
import { leaders, listNames, nextSeat, seatOrder } from '../common';
import type { Band } from '../bands';

/** 1 gentle, 2 steady, 3 tricky, 4 strong. */
export type Level = 1 | 2 | 3 | 4;

/** Boxes along each side, by age: 9 boxes for the youngest up to 36. */
export const sizeFor: Record<Band, number> = { '5-7': 3, '8-10': 4, '11-13': 5, '14+': 6 };

export interface DotsState {
  /** The seat drawing next: p1, p2, … */
  turn: string;
  /** Boxes along each side. */
  size: number;
  /** Who drew each line, or null while it's still to draw. */
  lines: (string | null)[];
  /** Who claimed each box, row by row. */
  boxes: (string | null)[];
  /** The lines in the order they were drawn. */
  order: number[];
  /** How well the computer plays, against the computer. */
  level?: Level;
  band?: Band;
  /** Set by the server when a game is stopped or put away. */
  ended?: string;
}

// Lines are numbered across first, a row of dots at a time, then down, a row
// of boxes at a time. On a 3 by 3 board lines 0–11 go across and 12–23 down.

export const lineCount = (n: number) => 2 * n * (n + 1);

/** The line across from dot (row, col) to the dot on its right. Rows 0 to n, columns 0 to n - 1. */
export const across = (n: number, row: number, col: number) => row * n + col;

/** The line down from dot (row, col) to the dot below. Rows 0 to n - 1, columns 0 to n. */
export const down = (n: number, row: number, col: number) => n * (n + 1) + row * (n + 1) + col;

export interface LinePlace {
  dir: 'across' | 'down';
  /** The dot the line starts from, counting from 0. */
  row: number;
  col: number;
}

export function lineAt(n: number, i: number): LinePlace {
  const flat = n * (n + 1);
  if (i < flat) return { dir: 'across', row: Math.floor(i / n), col: i % n };
  const j = i - flat;
  return { dir: 'down', row: Math.floor(j / (n + 1)), col: j % (n + 1) };
}

/** "Line across, row 2, between dots 3 and 4" or "Line down, column 1, between dots 2 and 3", counting from 1. */
export function lineName(n: number, i: number): string {
  const { dir, row, col } = lineAt(n, i);
  return dir === 'across'
    ? `Line across, row ${row + 1}, between dots ${col + 1} and ${col + 2}`
    : `Line down, column ${col + 1}, between dots ${row + 1} and ${row + 2}`;
}

/** The four sides of a box: top, bottom, left, right. Boxes are numbered row by row. */
export function sidesOf(n: number, box: number): [number, number, number, number] {
  const r = Math.floor(box / n);
  const c = box % n;
  return [across(n, r, c), across(n, r + 1, c), down(n, r, c), down(n, r, c + 1)];
}

/** The boxes a line is a side of: one on the edge of the board, two inside it. Above or left first. */
export function boxesBeside(n: number, i: number): number[] {
  const { dir, row, col } = lineAt(n, i);
  const out: number[] = [];
  if (dir === 'across') {
    if (row > 0) out.push((row - 1) * n + col);
    if (row < n) out.push(row * n + col);
  } else {
    if (col > 0) out.push(row * n + col - 1);
    if (col < n) out.push(row * n + col);
  }
  return out;
}

export function sidesDrawn(n: number, lines: readonly (string | null)[], box: number): number {
  return sidesOf(n, box).filter((l) => lines[l] != null).length;
}

/** Where a line's middle sits, in boxes from the top-left dot: for moving between lines with the arrow keys. */
export function middleOf(n: number, i: number): [number, number] {
  const { dir, row, col } = lineAt(n, i);
  return dir === 'across' ? [col + 0.5, row] : [col, row + 0.5];
}

/** The nearest of `open` from line `from` in a direction, preferring lines straight ahead over ones off to the side. */
export function lineToward(n: number, open: readonly number[], from: number, dx: number, dy: number): number | null {
  const [fx, fy] = middleOf(n, from);
  let best: number | null = null;
  let cost = Infinity;
  for (const i of open) {
    if (i === from) continue;
    const [x, y] = middleOf(n, i);
    const ahead = (x - fx) * dx + (y - fy) * dy;
    if (ahead <= 0) continue;
    const aside = Math.abs((x - fx) * dy) + Math.abs((y - fy) * dx);
    const c = ahead + 4 * aside;
    if (c < cost) {
      cost = c;
      best = i;
    }
  }
  return best;
}

/** The nearest of `open` to line `from`, for keeping keyboard focus close by when a line goes. */
export function nearestLine(n: number, open: readonly number[], from: number): number | null {
  const [fx, fy] = middleOf(n, from);
  let best: number | null = null;
  let cost = Infinity;
  for (const i of open) {
    const [x, y] = middleOf(n, i);
    const c = (x - fx) ** 2 + (y - fy) ** 2;
    if (c < cost) {
      cost = c;
      best = i;
    }
  }
  return best;
}

export function newBoard(size: number, extra: Partial<DotsState> = {}): DotsState {
  return {
    turn: 'p1',
    size,
    lines: Array<string | null>(lineCount(size)).fill(null),
    boxes: Array<string | null>(size * size).fill(null),
    order: [],
    ...extra,
  };
}

export const isOver = (s: DotsState) => s.lines.every((l) => l != null);

/**
 * The seat whose turn it is draws a line. Any box it finishes is theirs, and
 * finishing one means they go again; otherwise the turn passes on. Null when
 * the line is already drawn, isn't on the board, or the game is over.
 */
export function drawLine(s: DotsState, line: number, seats: readonly string[]): { state: DotsState; claimed: number[] } | null {
  if (!Number.isInteger(line) || line < 0 || line >= s.lines.length || s.lines[line] != null) return null;
  const lines = [...s.lines];
  lines[line] = s.turn;
  const boxes = [...s.boxes];
  const claimed = boxesBeside(s.size, line).filter((b) => boxes[b] == null && sidesOf(s.size, b).every((l) => lines[l] != null));
  for (const b of claimed) boxes[b] = s.turn;
  const over = lines.every((l) => l != null);
  const turn = claimed.length || over ? s.turn : nextSeat([...seats], s.turn);
  return { state: { ...s, lines, boxes, order: [...s.order, line], turn }, claimed };
}

export function scoresOf(s: DotsState, seats: readonly string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(seats.map((k) => [k, 0]));
  for (const owner of s.boxes) if (owner != null) out[owner] = (out[owner] ?? 0) + 1;
  return out;
}

/** The seats with the most boxes: more than one when they tie. */
export const winners = (s: DotsState, seats: readonly string[]) => leaders(scoresOf(s, seats), [...seats]);

/**
 * What the latest player did: their run of lines at the end of the game so
 * far, and how many boxes those lines finished. A player who finishes boxes
 * draws several lines in a row, the computer included.
 */
export function lastRun(s: DotsState): { seat: string; lines: number[]; boxes: number } | null {
  const { order } = s;
  const seat = order.length ? s.lines[order[order.length - 1]] : null;
  if (seat == null) return null;
  let from = order.length;
  while (from > 0 && s.lines[order[from - 1]] === seat) from--;
  const when = new Map(order.map((l, i) => [l, i]));
  let boxes = 0;
  s.boxes.forEach((owner, b) => {
    if (owner === seat && Math.max(...sidesOf(s.size, b).map((l) => when.get(l) ?? -1)) >= from) boxes++;
  });
  return { seat, lines: order.slice(from), boxes };
}

export const boxesText = (n: number) => `${n} ${n === 1 ? 'box' : 'boxes'}`;

/**
 * The line for the chat when the game ends: "Mia won Dots and Boxes with 9
 * boxes", "The family beat the computer at Dots and Boxes, 6 boxes to 3 🎉".
 */
export function endSummary(s: DotsState, seats: Record<string, unknown>, name: (seat: string) => string): string {
  const order = seatOrder(seats);
  const scores = scoresOf(s, order);
  const computer = order.find((k) => seats[k] === 'computer');
  if (computer) {
    const family = order.find((k) => k !== computer) ?? 'p1';
    const [us, it] = [scores[family], scores[computer]];
    if (us > it) return `${name(family)} beat the computer at Dots and Boxes, ${boxesText(us)} to ${it} 🎉`;
    if (it > us) return `The computer won Dots and Boxes this time, ${boxesText(it)} to ${us}`;
    return `${name(family)} and the computer shared Dots and Boxes with ${boxesText(us)} each`;
  }
  const top = leaders(scores, order);
  if (top.length === 1) return `${name(top[0])} won Dots and Boxes with ${boxesText(scores[top[0]])}`;
  return `${listNames(top.map(name))} shared Dots and Boxes with ${boxesText(scores[top[0]])} each`;
}
