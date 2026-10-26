import { describe, expect, it } from 'vitest';
import { START_FEN, squareIndex as sq, type Move } from './rules';
import { play, playTurn, takeBackTo, type ChessState } from './turns';

const mv = (from: string, to: string): Move => ({ from: sq(from), to: sq(to) });
const fresh = (): ChessState => ({ turn: 'white', fen: START_FEN, history: [], moves: [], last: null, level: 1, strength: 1 });

describe('a turn against the computer', () => {
  it('plays the move and the computer replies, back to the family', () => {
    const st = fresh();
    const step = playTurn(st, st.fen, mv('e2', 'e4'), 'black')!;
    expect(step.over).toBeNull();
    expect(step.state.moves).toHaveLength(2);
    expect(step.state.moves[0]).toBe('e4');
    expect(step.state.turn).toBe('white');
  });

  it("doesn't reply against another person", () => {
    const st = fresh();
    const step = playTurn(st, st.fen, mv('e2', 'e4'))!;
    expect(step.state.moves).toEqual(['e4']);
    expect(step.state.turn).toBe('black');
  });

  it('refuses a move that is not allowed', () => {
    const st = fresh();
    expect(playTurn(st, st.fen, mv('e2', 'e5'), 'black')).toBeNull();
  });

  it('refuses a move chosen on a position someone else has since moved from, even when it is still allowed', () => {
    // Mum and Dad both look at the start. Mum plays e4 and the computer replies first.
    const start = fresh();
    const afterMum = playTurn(start, start.fen, mv('e2', 'e4'), 'black')!.state;
    // Dad's d4 is still allowed, but he chose it before seeing the computer's reply.
    expect(playTurn(afterMum, start.fen, mv('d2', 'd4'), 'black')).toBeNull();
    expect(playTurn(afterMum, afterMum.fen, mv('d2', 'd4'), 'black')).not.toBeNull();
  });
});

describe('taking back', () => {
  it("goes back to the family's last turn, taking the computer's reply too", () => {
    const start = fresh();
    const after = playTurn(start, start.fen, mv('e2', 'e4'), 'black')!.state;
    const back = takeBackTo(after, after.fen, 'white')!;
    expect(back.fen).toBe(START_FEN);
    expect(back.moves).toEqual([]);
    expect(back.turn).toBe('white');
  });

  it('works when the computer opened as white', () => {
    const opened = play(fresh(), mv('e2', 'e4')).state;
    // Nothing of the family's to take back yet.
    expect(takeBackTo(opened, opened.fen, 'black')).toBeNull();
    const after = playTurn(opened, opened.fen, mv('e7', 'e5'), 'white')!.state;
    expect(takeBackTo(after, after.fen, 'black')!.fen).toBe(opened.fen);
  });

  it('refuses when someone has moved since, so two take backs at once only go back one turn', () => {
    const start = fresh();
    const one = playTurn(start, start.fen, mv('e2', 'e4'), 'black')!.state;
    const two = playTurn(one, one.fen, mv('d2', 'd4'), 'black')!.state;
    const back = takeBackTo(two, two.fen, 'white')!;
    expect(back.fen).toBe(one.fen);
    // A second press made while looking at `two` lands on the board already taken back.
    expect(takeBackTo(back, two.fen, 'white')).toBeNull();
  });
});
