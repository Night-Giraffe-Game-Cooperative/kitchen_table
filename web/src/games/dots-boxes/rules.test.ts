import { describe, expect, it } from 'vitest';
import {
  across,
  boxesBeside,
  down,
  drawLine,
  endSummary,
  isOver,
  lastRun,
  lineAt,
  lineCount,
  lineName,
  lineToward,
  nearestLine,
  newBoard,
  scoresOf,
  sidesOf,
  sizeFor,
  winners,
  type DotsState,
} from './rules';

const TWO = ['p1', 'p2'];

/** Draws lines in turn, whoever's turn it is. */
function play(s: DotsState, lines: number[], seats = TWO): DotsState {
  for (const l of lines) {
    const next = drawLine(s, l, seats);
    if (!next) throw new Error(`line ${l} can't be drawn`);
    s = next.state;
  }
  return s;
}

describe('the grid', () => {
  it('numbers lines across first, then down', () => {
    expect(lineCount(3)).toBe(24);
    expect(lineCount(6)).toBe(84);
    expect(across(3, 0, 0)).toBe(0);
    expect(across(3, 3, 2)).toBe(11);
    expect(down(3, 0, 0)).toBe(12);
    expect(down(3, 2, 3)).toBe(23);
    expect(lineAt(4, across(4, 2, 1))).toEqual({ dir: 'across', row: 2, col: 1 });
    expect(lineAt(4, down(4, 3, 4))).toEqual({ dir: 'down', row: 3, col: 4 });
  });

  it('finds every line again from its place, at every size', () => {
    for (const n of Object.values(sizeFor)) {
      const seen = new Set<number>();
      for (let i = 0; i < lineCount(n); i++) {
        const { dir, row, col } = lineAt(n, i);
        expect(dir === 'across' ? across(n, row, col) : down(n, row, col)).toBe(i);
        seen.add(i);
      }
      expect(seen.size).toBe(2 * n * (n + 1));
    }
  });

  it('names lines the way a screen reader says them, counting from 1', () => {
    expect(lineName(3, across(3, 1, 2))).toBe('Line across, row 2, between dots 3 and 4');
    expect(lineName(3, down(3, 1, 0))).toBe('Line down, column 1, between dots 2 and 3');
  });

  it('agrees on which lines make each box', () => {
    for (const n of [3, 4, 5, 6]) {
      for (let b = 0; b < n * n; b++) for (const l of sidesOf(n, b)) expect(boxesBeside(n, l)).toContain(b);
      const edges = Array.from({ length: lineCount(n) }, (_, l) => boxesBeside(n, l).length);
      expect(edges.filter((k) => k === 1)).toHaveLength(4 * n);
      expect(edges.every((k) => k === 1 || k === 2)).toBe(true);
    }
    expect(sidesOf(3, 4)).toEqual([across(3, 1, 1), across(3, 2, 1), down(3, 1, 1), down(3, 1, 2)]);
  });

  it('moves between lines with the arrow keys', () => {
    const n = 3;
    const open = Array.from({ length: lineCount(n) }, (_, i) => i);
    expect(lineToward(n, open, across(n, 1, 0), 1, 0)).toBe(across(n, 1, 1));
    expect(lineToward(n, open, across(n, 1, 0), 0, 1)).toBe(across(n, 2, 0));
    expect(lineToward(n, open, down(n, 0, 1), 1, 0)).toBe(down(n, 0, 2));
    // At the end of a row the next line is the one down the edge.
    expect(lineToward(n, open, across(n, 0, 2), 1, 0)).toBe(down(n, 0, 3));
    expect(lineToward(n, open, down(n, 0, 3), 1, 0)).toBeNull();
    // Drawn lines are skipped.
    expect(lineToward(n, open.filter((i) => i !== across(n, 1, 1)), across(n, 1, 0), 1, 0)).toBe(across(n, 1, 2));
    expect(nearestLine(n, [across(n, 3, 2), down(n, 1, 1)], across(n, 1, 1))).toBe(down(n, 1, 1));
  });
});

describe('drawing lines', () => {
  it('passes the turn when no box is finished', () => {
    const s = drawLine(newBoard(3), across(3, 0, 0), TWO)!;
    expect(s.claimed).toEqual([]);
    expect(s.state.lines[0]).toBe('p1');
    expect(s.state.order).toEqual([0]);
    expect(s.state.turn).toBe('p2');
  });

  it("won't draw a line twice, or one that isn't there", () => {
    const s = play(newBoard(3), [5]);
    expect(drawLine(s, 5, TWO)).toBeNull();
    expect(drawLine(s, -1, TWO)).toBeNull();
    expect(drawLine(s, 24, TWO)).toBeNull();
    expect(drawLine(s, 1.5, TWO)).toBeNull();
  });

  it('claims a box with its fourth side, and that player goes again', () => {
    const [top, bottom, left, right] = sidesOf(3, 0);
    const s = play(newBoard(3), [top, bottom, left]);
    expect(s.turn).toBe('p2');
    const next = drawLine(s, right, TWO)!;
    expect(next.claimed).toEqual([0]);
    expect(next.state.boxes[0]).toBe('p2');
    expect(next.state.turn).toBe('p2');
    expect(scoresOf(next.state, TWO)).toEqual({ p1: 0, p2: 1 });
    // The extra go is used up by a line that finishes nothing.
    expect(drawLine(next.state, across(3, 3, 2), TWO)!.state.turn).toBe('p1');
  });

  it('claims two boxes with one line between them', () => {
    // Boxes 0 and 1 both have three sides; the line between them is their last.
    const middle = down(3, 0, 1);
    const others = [...sidesOf(3, 0), ...sidesOf(3, 1)].filter((l) => l !== middle);
    let s = play(newBoard(3), [...new Set(others)]);
    s = { ...s, turn: 'p1' };
    const next = drawLine(s, middle, TWO)!;
    expect(next.claimed).toEqual([0, 1]);
    expect(scoresOf(next.state, TWO).p1).toBe(2);
    expect(next.state.turn).toBe('p1');
  });

  it('goes round every player in turn', () => {
    const three = ['p1', 'p2', 'p3'];
    let s = newBoard(4);
    const turns: string[] = [];
    for (const l of [across(4, 0, 0), across(4, 4, 3), down(4, 2, 2), down(4, 0, 4)]) {
      turns.push(s.turn);
      s = drawLine(s, l, three)!.state;
    }
    expect(turns).toEqual(['p1', 'p2', 'p3', 'p1']);
  });

  it('says what the last player did', () => {
    const [top, bottom, left, right] = sidesOf(3, 4);
    let s = play(newBoard(3), [top, bottom, left]);
    expect(lastRun(s)).toEqual({ seat: 'p1', lines: [left], boxes: 0 });
    // p2 takes the box, then draws a line that gives nothing.
    s = play(s, [right, across(3, 0, 0)]);
    expect(lastRun(s)).toEqual({ seat: 'p2', lines: [right, across(3, 0, 0)], boxes: 1 });
    expect(s.turn).toBe('p1');
    expect(lastRun(newBoard(3))).toBeNull();
  });
});

describe('the end of the game', () => {
  it('ends when every line is drawn, with every box claimed', () => {
    let s = newBoard(4);
    for (let l = 0; l < lineCount(4); l++) {
      expect(isOver(s)).toBe(false);
      s = drawLine(s, l, TWO)!.state;
    }
    expect(isOver(s)).toBe(true);
    expect(s.boxes.every((b) => b !== null)).toBe(true);
    const scores = scoresOf(s, TWO);
    expect(scores.p1 + scores.p2).toBe(16);
    expect(drawLine(s, 0, TWO)).toBeNull();
  });

  const finished = (owners: string[]): DotsState => ({ ...newBoard(3), lines: Array(24).fill('p1'), boxes: owners });

  it('the most boxes wins, and a tie is shared', () => {
    const mia = finished(['p1', 'p1', 'p1', 'p1', 'p1', 'p2', 'p2', 'p2', 'p2']);
    expect(winners(mia, TWO)).toEqual(['p1']);
    const tie = { ...newBoard(4), boxes: [...Array(8).fill('p1'), ...Array(8).fill('p2')] };
    expect(winners(tie, TWO)).toEqual(['p1', 'p2']);
  });

  it('writes a summary for the chat', () => {
    const names: Record<string, string> = { p1: 'Mia', p2: 'Sam', p3: 'Dad' };
    const name = (k: string) => names[k];
    const seats = { p1: 1, p2: 2 };
    expect(endSummary(finished(['p1', 'p1', 'p1', 'p1', 'p1', 'p2', 'p2', 'p2', 'p2']), seats, name)).toBe('Mia won Dots and Boxes with 5 boxes');
    const tie = { ...newBoard(4), boxes: [...Array(6).fill('p1'), ...Array(6).fill('p2'), ...Array(4).fill('p3')] };
    expect(endSummary(tie, { p1: 1, p2: 2, p3: 3 }, name)).toBe('Mia and Sam shared Dots and Boxes with 6 boxes each');

    const family = { p1: 'team', p2: 'computer' };
    const fam = (k: string) => (k === 'p1' ? 'The family' : 'The computer');
    expect(endSummary(finished(['p1', 'p1', 'p1', 'p1', 'p1', 'p1', 'p2', 'p2', 'p2']), family, fam)).toBe(
      'The family beat the computer at Dots and Boxes, 6 boxes to 3 🎉',
    );
    expect(endSummary(finished(['p2', 'p2', 'p2', 'p2', 'p2', 'p1', 'p1', 'p1', 'p1']), family, fam)).toBe(
      'The computer won Dots and Boxes this time, 5 boxes to 4',
    );
    const even = { ...newBoard(4), boxes: [...Array(8).fill('p1'), ...Array(8).fill('p2')] };
    expect(endSummary(even, { p1: 7, p2: 'computer' }, () => 'Mia')).toBe('Mia and the computer shared Dots and Boxes with 8 boxes each');
  });
});
