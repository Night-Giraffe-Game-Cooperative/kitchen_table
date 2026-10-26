import { describe, expect, it } from 'vitest';
import {
  COLS,
  ROWS,
  bestLine,
  boardOf,
  canDrop,
  drop,
  emptyGrid,
  giftColumns,
  height,
  isFull,
  makesFour,
  moveOrder,
  outcome,
  outcomeOf,
  playColumn,
  sameMoves,
  takeBackTo,
  turnOf,
  winningColumns,
  type Disc,
  type Grid,
} from './rules';

/** Plays a list of columns, checking each move is allowed. */
function playAll(cols: number[]): number[] {
  let moves: number[] = [];
  for (const c of cols) {
    const next = playColumn(moves, c);
    if (!next) throw new Error(`Column ${c} is not allowed after ${moves.join(',')}`);
    moves = next;
  }
  return moves;
}

/**
 * A full board with no four anywhere: every column alternates colours, and the
 * columns start red, red, yellow, yellow, red, red, yellow.
 */
const DRAWN: Grid = [0, 0, 1, 1, 0, 0, 1].map((start) => [...Array(ROWS).keys()].map((r) => ((r + start) % 2 ? 'yellow' : 'red') as Disc));

/** An order of moves that builds a grid, red first and alternating, found by trying each column in turn. */
function movesFor(target: Grid): number[] | null {
  const heights = Array<number>(COLS).fill(0);
  const total = target.flat().length;
  const moves: number[] = [];
  const go = (): boolean => {
    if (moves.length === total) return true;
    const disc = turnOf(moves);
    for (let c = 0; c < COLS; c++) {
      if (heights[c] >= ROWS || target[c][heights[c]] !== disc) continue;
      heights[c]++;
      moves.push(c);
      if (go()) return true;
      moves.pop();
      heights[c]--;
    }
    return false;
  };
  return go() ? moves : null;
}

describe('dropping', () => {
  it('starts empty with red to play', () => {
    const grid = boardOf([]);
    expect(grid).toHaveLength(COLS);
    expect(grid.every((col) => col.length === ROWS && col.every((x) => x === null))).toBe(true);
    expect(turnOf([])).toBe('red');
  });

  it('drops each counter to the lowest empty space, red first and then taking turns', () => {
    const grid = boardOf([3, 3, 4, 3]);
    expect(grid[3].slice(0, 4)).toEqual(['red', 'yellow', 'yellow', null]);
    expect(grid[4][0]).toBe('red');
    expect(height(grid, 3)).toBe(3);
    expect(height(grid, 0)).toBe(0);
    expect(turnOf([3, 3, 4, 3])).toBe('red');
    expect(turnOf([3])).toBe('yellow');
  });

  it('says where a dropped counter lands without changing the board it was given', () => {
    const grid = boardOf([2, 2]);
    const after = drop(grid, 2, 'red');
    expect(after?.row).toBe(2);
    expect(after?.grid[2][2]).toBe('red');
    expect(grid[2][2]).toBeNull();
  });

  it('remembers which move put each counter there', () => {
    const order = moveOrder([3, 3, 0]);
    expect(order[3][0]).toBe(0);
    expect(order[3][1]).toBe(1);
    expect(order[0][0]).toBe(2);
    expect(order[6][0]).toBe(-1);
  });
});

describe('full columns', () => {
  const full = [2, 2, 2, 2, 2, 2];

  it('takes six counters and no more', () => {
    const moves = playAll(full);
    const grid = boardOf(moves);
    expect(height(grid, 2)).toBe(ROWS);
    expect(canDrop(grid, 2)).toBe(false);
    expect(drop(grid, 2, 'red')).toBeNull();
    expect(playColumn(moves, 2)).toBeNull();
    expect(playColumn(moves, 3)).toEqual([...full, 3]);
  });

  it('turns away columns that are not on the board', () => {
    expect(playColumn([], -1)).toBeNull();
    expect(playColumn([], 7)).toBeNull();
    expect(playColumn([], 2.5)).toBeNull();
  });

  it('leaves full columns out of the places that could win', () => {
    // Red has three across the bottom, but column 0 is full.
    const grid = emptyGrid();
    grid[0] = ['yellow', 'red', 'yellow', 'red', 'yellow', 'red'];
    grid[1][0] = 'red';
    grid[2][0] = 'red';
    grid[3][0] = 'red';
    expect(winningColumns(grid, 'red')).toEqual([4]);
  });
});

describe('four in a row', () => {
  it('wins across', () => {
    const moves = playAll([0, 0, 1, 1, 2, 2, 3]);
    const over = outcome(moves);
    expect(over).toMatchObject({ kind: 'four', winner: 'red', direction: 'across' });
    expect(over?.kind === 'four' && over.cells).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
  });

  it('wins straight up', () => {
    const over = outcome(playAll([6, 0, 6, 0, 6, 0, 1, 0]));
    expect(over).toMatchObject({ kind: 'four', winner: 'yellow', direction: 'up' });
    expect(over?.kind === 'four' && over.cells).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
  });

  it('wins on a rising slant', () => {
    // Red climbs from (0,0) to (3,3).
    const moves = playAll([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
    expect(outcome(moves)).toMatchObject({ kind: 'four', winner: 'red', direction: 'rising' });
  });

  it('wins on a falling slant', () => {
    // Red steps down from (3,3) to (6,0).
    const moves = playAll([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
    const over = outcome(moves);
    expect(over).toMatchObject({ kind: 'four', winner: 'red', direction: 'falling' });
    expect(over?.kind === 'four' && over.cells).toEqual([
      [3, 3],
      [4, 2],
      [5, 1],
      [6, 0],
    ]);
  });

  it('shows all of a line longer than four', () => {
    // Red fills the gap in R R _ R R.
    const moves = playAll([0, 0, 1, 1, 3, 3, 4, 4, 2]);
    const over = outcome(moves);
    expect(over?.kind === 'four' && over.cells.length).toBe(5);
  });

  it('does not count three, or four broken by the other colour', () => {
    expect(outcome(playAll([0, 6, 1, 6, 2]))).toBeNull();
    expect(outcome(playAll([0, 2, 1, 6, 3, 6, 4]))).toBeNull();
  });

  it('allows no more moves once someone has four', () => {
    const moves = playAll([0, 0, 1, 1, 2, 2, 3]);
    expect(playColumn(moves, 5)).toBeNull();
  });
});

describe('a draw', () => {
  it('is a full board with no four anywhere', () => {
    expect(isFull(DRAWN)).toBe(true);
    expect(outcomeOf(DRAWN)).toEqual({ kind: 'full' });
  });

  it('comes from a real game, move by move', () => {
    const moves = movesFor(DRAWN)!;
    expect(moves).toHaveLength(COLS * ROWS);
    // Nobody has four on the way, so every move is allowed.
    const played = playAll(moves);
    expect(boardOf(played)).toEqual(DRAWN);
    expect(outcome(played)).toEqual({ kind: 'full' });
    expect(outcome(played.slice(0, -1))).toBeNull();
  });
});

describe('looking ahead', () => {
  it('finds the columns that would make four now', () => {
    const grid = boardOf([0, 6, 1, 6, 2, 6]);
    expect(winningColumns(grid, 'red')).toEqual([3]);
    expect(winningColumns(grid, 'yellow')).toEqual([6]);
  });

  it('knows a space can make four before it can be reached', () => {
    // Red has (1,1), (2,2) and (3,3); (0,0) is empty and reachable, (4,4) is up in the air.
    const grid = emptyGrid();
    grid[1] = ['yellow', 'red', null, null, null, null];
    grid[2] = ['yellow', 'yellow', 'red', null, null, null];
    grid[3] = ['red', 'yellow', 'yellow', 'red', null, null];
    expect(makesFour(grid, 0, 0, 'red')).toBe(true);
    expect(makesFour(grid, 4, 4, 'red')).toBe(true);
    expect(makesFour(grid, 4, 0, 'red')).toBe(false);
    expect(winningColumns(grid, 'red')).toEqual([0]);
  });

  it('spots a counter that would let the other side drop on top and win', () => {
    // Yellow has three across the second row with a gap at (3,1); column 3 is empty.
    const grid = emptyGrid();
    grid[0] = ['red', 'yellow', null, null, null, null];
    grid[1] = ['red', 'yellow', null, null, null, null];
    grid[2] = ['yellow', 'yellow', null, null, null, null];
    expect(giftColumns(grid, 'red')).toEqual([3]);
    expect(giftColumns(grid, 'yellow')).toEqual([]);
  });

  it('counts the counters already in the best open line through a space', () => {
    const grid = boardOf([0, 6, 1, 6]);
    expect(bestLine(grid, 2, 0, 'red')).toBe(2);
    expect(bestLine(grid, 6, 2, 'yellow')).toBe(2);
    expect(bestLine(grid, 5, 4, 'red')).toBe(0);
  });
});

describe('taking back', () => {
  it("goes back to the family's last turn, taking the computer's reply too", () => {
    const moves = playAll([3, 4, 2, 5]);
    expect(takeBackTo(moves, moves, 'red')).toEqual([3, 4]);
    // The family plays yellow after the computer opened as red.
    const second = playAll([3, 4, 2]);
    expect(takeBackTo(second, second, 'yellow')).toEqual([3]);
  });

  it('has nothing to take back before the family has had a turn', () => {
    expect(takeBackTo([], [], 'red')).toBeNull();
    expect(takeBackTo([3], [3], 'yellow')).toBeNull();
  });

  it("refuses when someone has moved since it was pressed, so it doesn't undo their move", () => {
    const seen = playAll([3, 4]);
    // Dad dropped a counter and the computer replied before Mum's take back arrived.
    const now = playAll([3, 4, 2, 5]);
    expect(takeBackTo(now, seen, 'red')).toBeNull();
    // Two presses at once: the second lands on the board the first already took back.
    const once = takeBackTo(now, now, 'red')!;
    expect(takeBackTo(once, now, 'red')).toBeNull();
  });

  it('tells a board apart from one with as many counters after a take back', () => {
    expect(sameMoves([3, 4, 2, 5], [3, 4, 2, 5])).toBe(true);
    // Taken back to [3, 4], then a counter in 1 and the reply: still four moves, but a different board.
    expect(sameMoves([3, 4, 1, 5], [3, 4, 2, 5])).toBe(false);
    expect(sameMoves([3, 4], [3, 4, 2])).toBe(false);
  });
});
