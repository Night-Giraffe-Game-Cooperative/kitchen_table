// Drawing the board: where each square's centre is, wooden ladders, and
// friendly snakes that wiggle from head to tail. Everything is in board units,
// 100 to a square, with y going down the screen like SVG.
import { cellOf, rowsOf, snakes, type Board } from './rules';

export const CELL = 100;

export interface Pt {
  x: number;
  y: number;
}

export function centre(b: Board, n: number): Pt {
  const { col, row } = cellOf(b, n);
  return { x: (col + 0.5) * CELL, y: (rowsOf(b) - 1 - row + 0.5) * CELL };
}

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const r1 = (n: number) => Math.round(n * 10) / 10;
const pt = (p: Pt) => `${r1(p.x)} ${r1(p.y)}`;

function frame(a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const u = { x: dx / length, y: dy / length };
  return { length, u, n: { x: -u.y, y: u.x } };
}

export interface LadderArt {
  rails: [Pt, Pt][];
  rungs: [Pt, Pt][];
}

/** Two rails and evenly spaced rungs, from the foot square to the top one. */
export function ladderArt(foot: Pt, top: Pt): LadderArt {
  const { length, u, n } = frame(foot, top);
  const half = 15;
  const a = add(foot, u, -6);
  const b = add(top, u, 6);
  const rails: [Pt, Pt][] = [
    [add(a, n, half), add(b, n, half)],
    [add(a, n, -half), add(b, n, -half)],
  ];
  const count = Math.max(2, Math.round((length - 20) / 30));
  const gap = (length - 20) / count;
  const rungs: [Pt, Pt][] = [];
  for (let i = 0; i <= count; i++) {
    const c = add(foot, u, 10 + i * gap);
    rungs.push([add(c, n, half), add(c, n, -half)]);
  }
  return { rails, rungs };
}

export interface SnakeArt {
  /** The body outline, tapering from head to tail. */
  body: string;
  /** Spots along the back. */
  spots: { x: number; y: number; r: number }[];
  /** The middle of the body, head first: the way a counter slides down. */
  spine: Pt[];
}

/** A wiggly, tapering body from the head square to the tail square. `twist` picks which way it bends first. */
export function snakeArt(head: Pt, tail: Pt, twist: number): SnakeArt {
  const { length, u, n } = frame(head, tail);
  const waves = Math.max(2, Math.round(length / 95));
  const amp = Math.min(26, 9 + length * 0.05) * (twist % 2 ? 1 : -1);
  const steps = Math.max(24, Math.round(length / 7));
  const spine: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    spine.push(add(add(head, u, length * t), n, amp * Math.sin(Math.PI * waves * t)));
  }
  const width = (t: number) => 24 - 18 * t;
  const left: Pt[] = [];
  const right: Pt[] = [];
  spine.forEach((p, i) => {
    const a = spine[Math.max(0, i - 1)];
    const b = spine[Math.min(steps, i + 1)];
    const f = frame(a, b);
    const w = width(i / steps) / 2;
    left.push(add(p, f.n, w));
    right.push(add(p, f.n, -w));
  });
  const end = frame(spine[steps - 1], spine[steps]);
  const tip = add(spine[steps], end.u, 9);
  const body = `M ${left.map(pt).join(' L ')} L ${pt(tip)} L ${right.reverse().map(pt).join(' L ')} Z`;

  const spots: SnakeArt['spots'] = [];
  for (let i = Math.round(steps * 0.14); i < steps * 0.8; i += Math.max(3, Math.round(steps / 9))) {
    spots.push({ x: r1(spine[i].x), y: r1(spine[i].y), r: r1(width(i / steps) * 0.2) });
  }
  return { body, spots, spine };
}

/** Every snake on a board, by the square its head is on, with its colour. */
export function snakeShapes(b: Board): Map<number, SnakeArt & { tone: number }> {
  return new Map(snakes(b).map(([from, to], i) => [from, { ...snakeArt(centre(b, from), centre(b, to), i), tone: i % TONES }]));
}

/** How many snake colours there are. */
export const TONES = 5;
