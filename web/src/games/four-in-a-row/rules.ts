// Four in a Row rules: a frame 7 columns wide and 6 rows high, counters that
// drop to the lowest empty space, and four in a line to win. A game is kept as
// the list of columns played: red always goes first, so the board, whose turn
// it is and taking a move back all follow from that list.

export type Disc = 'red' | 'yellow';
/** grid[col][row], with row 0 at the bottom. */
export type Grid = (Disc | null)[][];
export type Cell = [col: number, row: number];
export type Direction = 'across' | 'up' | 'rising' | 'falling';

export const COLS = 7;
export const ROWS = 6;
export const DISCS: readonly Disc[] = ['red', 'yellow'];

export const other = (d: Disc): Disc => (d === 'red' ? 'yellow' : 'red');

/** Whose turn it is after these moves. */
export const turnOf = (moves: readonly number[]): Disc => (moves.length % 2 === 0 ? 'red' : 'yellow');

/** Who dropped the counter of move number `i` (counting from 0). */
export const discOfMove = (i: number): Disc => (i % 2 === 0 ? 'red' : 'yellow');

export const isColumn = (col: unknown): col is number => Number.isInteger(col) && (col as number) >= 0 && (col as number) < COLS;

export function emptyGrid(): Grid {
  return Array.from({ length: COLS }, () => Array<Disc | null>(ROWS).fill(null));
}

/** How many counters are in a column. */
export function height(grid: Grid, col: number): number {
  let h = 0;
  while (h < ROWS && grid[col][h]) h++;
  return h;
}

export const canDrop = (grid: Grid, col: number): boolean => isColumn(col) && height(grid, col) < ROWS;

/** The board after dropping a counter, and the row it landed in; null if the column is full. */
export function drop(grid: Grid, col: number, disc: Disc): { grid: Grid; row: number } | null {
  if (!canDrop(grid, col)) return null;
  const row = height(grid, col);
  const next = grid.map((c) => [...c]);
  next[col][row] = disc;
  return { grid: next, row };
}

/** The board after these moves. A move into a full or unknown column is skipped. */
export function boardOf(moves: readonly number[]): Grid {
  const grid = emptyGrid();
  moves.forEach((col, i) => {
    if (!canDrop(grid, col)) return;
    grid[col][height(grid, col)] = discOfMove(i);
  });
  return grid;
}

/** Which move put each counter there: order[col][row], or -1 for an empty space. */
export function moveOrder(moves: readonly number[]): number[][] {
  const order = Array.from({ length: COLS }, () => Array<number>(ROWS).fill(-1));
  const heights = Array<number>(COLS).fill(0);
  moves.forEach((col, i) => {
    if (isColumn(col) && heights[col] < ROWS) order[col][heights[col]++] = i;
  });
  return order;
}

export const freeColumns = (grid: Grid): number[] => [...Array(COLS).keys()].filter((c) => canDrop(grid, c));

export const isFull = (grid: Grid): boolean => freeColumns(grid).length === 0;

const STEPS: [Direction, number, number][] = [
  ['across', 1, 0],
  ['up', 0, 1],
  ['rising', 1, 1],
  ['falling', 1, -1],
];

/** The words for a line's direction, for the end of the game. */
export const DIRECTION_WORDS: Record<Direction, string> = { across: 'going across', up: 'going straight up', rising: 'on a slant', falling: 'on a slant' };

/** The line of four or more through a counter, if it is part of one. */
export function lineThrough(grid: Grid, col: number, row: number): { cells: Cell[]; direction: Direction } | null {
  const disc = grid[col]?.[row];
  if (!disc) return null;
  for (const [direction, dc, dr] of STEPS) {
    const cells: Cell[] = [[col, row]];
    for (let c = col + dc, r = row + dr; grid[c]?.[r] === disc; c += dc, r += dr) cells.push([c, r]);
    for (let c = col - dc, r = row - dr; grid[c]?.[r] === disc; c -= dc, r -= dr) cells.unshift([c, r]);
    if (cells.length >= 4) return { cells, direction };
  }
  return null;
}

/** Whether a counter at this empty space would make four, whether or not it can be reached yet. */
export function makesFour(grid: Grid, col: number, row: number, disc: Disc): boolean {
  if (!isColumn(col) || row < 0 || row >= ROWS || grid[col][row]) return false;
  for (const [, dc, dr] of STEPS) {
    let n = 1;
    for (let c = col + dc, r = row + dr; grid[c]?.[r] === disc; c += dc, r += dr) n++;
    for (let c = col - dc, r = row - dr; grid[c]?.[r] === disc; c -= dc, r -= dr) n++;
    if (n >= 4) return true;
  }
  return false;
}

/** Columns where a counter of `disc` dropped now would make four. */
export function winningColumns(grid: Grid, disc: Disc): number[] {
  return freeColumns(grid).filter((c) => makesFour(grid, c, height(grid, c), disc));
}

/**
 * Columns where a counter of `disc` would fill the space just under one where
 * the other side could make four, so they could drop on top and win.
 */
export function giftColumns(grid: Grid, disc: Disc): number[] {
  return freeColumns(grid).filter((c) => {
    const h = height(grid, c);
    return !makesFour(grid, c, h, disc) && makesFour(grid, c, h + 1, other(disc));
  });
}

/**
 * The most counters of `disc` already in one line of four through this space,
 * counting only lines the other side hasn't blocked.
 */
export function bestLine(grid: Grid, col: number, row: number, disc: Disc): number {
  let best = 0;
  for (const [, dc, dr] of STEPS) {
    for (let start = -3; start <= 0; start++) {
      let mine = 0;
      let open = true;
      for (let k = start; k < start + 4 && open; k++) {
        const c = col + k * dc;
        const r = row + k * dr;
        if (!isColumn(c) || r < 0 || r >= ROWS) open = false;
        else if (k !== 0 && grid[c][r] === disc) mine++;
        else if (k !== 0 && grid[c][r]) open = false;
      }
      if (open) best = Math.max(best, mine);
    }
  }
  return best;
}

export type Outcome = { kind: 'four'; winner: Disc; cells: Cell[]; direction: Direction } | { kind: 'full' } | null;

/** A four in a row, a full board, or null while the game goes on. */
export function outcomeOf(grid: Grid): Outcome {
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const line = lineThrough(grid, c, r);
      if (line) return { kind: 'four', winner: grid[c][r]!, ...line };
    }
  }
  return isFull(grid) ? { kind: 'full' } : null;
}

export const outcome = (moves: readonly number[]): Outcome => outcomeOf(boardOf(moves));

/** The moves after dropping a counter in `col`, or null if that isn't allowed now. */
export function playColumn(moves: readonly number[], col: number): number[] | null {
  const grid = boardOf(moves);
  if (outcomeOf(grid) || !canDrop(grid, col)) return null;
  return [...moves, col];
}

/** Whether two lists of moves are the same game so far. Counting them isn't enough: a take back and a new counter leave as many. */
export const sameMoves = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((col, i) => col === b[i]);

/**
 * The moves after taking back `side`'s last turn and the reply after it. Null
 * when `side` hasn't had a turn yet, or when the moves aren't the ones `seen`
 * when take back was pressed: someone has moved or taken back since, and that
 * isn't theirs to undo.
 */
export function takeBackTo(moves: readonly number[], seen: readonly number[], side: Disc): number[] | null {
  if (!sameMoves(moves, seen)) return null;
  let back = moves.slice();
  do back = back.slice(0, -1);
  while (back.length && turnOf(back) !== side);
  return back.length < moves.length && turnOf(back) === side ? back : null;
}
