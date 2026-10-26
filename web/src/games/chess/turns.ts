// A turn in a saved chess game, played on the game's latest state: the move
// someone chose and, against the computer, its reply straight after. Pure, so
// the board and the tests share it.
import { chooseMove, type Level } from './ai';
import { makeMove, movesFrom, outcome, parseFen, san, toFen, type Move, type Outcome, type Side } from './rules';

export type Seat = 'white' | 'black';

export interface ChessState {
  turn: Seat;
  fen: string;
  history: string[]; // positions before each move, for repetition and taking back
  moves: string[];
  last: [number, number] | null;
  /** Kept at 3 or below, as older copies of the app only know three levels. */
  level?: Level;
  /** The computer's real strength, 4 for 14 and up. */
  strength?: Level;
  ended?: string;
}

export const seatOf = (s: Side): Seat => (s === 'w' ? 'white' : 'black');
export const strengthOf = (s: ChessState): Level => s.strength ?? s.level ?? 2;

/** Plays one move and reports whether that ended the game. */
export function play(state: ChessState, move: Move): { state: ChessState; over: Outcome } {
  const pos = parseFen(state.fen);
  const text = san(pos, move);
  const next = makeMove(pos, move);
  const history = [...state.history, state.fen];
  const out: ChessState = {
    ...state,
    fen: toFen(next),
    turn: seatOf(next.turn),
    history,
    moves: [...state.moves, text],
    last: [move.from, move.to],
  };
  return { state: out, over: outcome(next, history) };
}

/**
 * Plays a move chosen while looking at the position `seen`, then the
 * computer's reply if it has the `computer` seat. Null when the move can't be
 * played, or when someone else has moved since: it was chosen for a different
 * position, even if it would still be allowed.
 */
export function playTurn(st: ChessState, seen: string, move: Move, computer?: Seat): { state: ChessState; over: Outcome } | null {
  if (st.fen !== seen) return null;
  const pos = parseFen(st.fen);
  if (seatOf(pos.turn) !== st.turn || !movesFrom(pos, move.from).some((m) => m.to === move.to && m.promotion === move.promotion)) return null;
  const step = play(st, move);
  if (step.over || step.state.turn !== computer) return step;
  const reply = chooseMove(parseFen(step.state.fen), strengthOf(st), undefined, [...step.state.history, step.state.fen]);
  return reply ? play(step.state, reply) : step;
}

/**
 * Back to `seat`'s last turn, taking away the reply after it too. Null when
 * there's nothing to take back, or when someone has moved since the position
 * `seen`, so it would take back a move nobody asked to.
 */
export function takeBackTo(st: ChessState, seen: string, seat: Seat): ChessState | null {
  if (st.fen !== seen) return null;
  let next = st;
  do {
    if (!next.history.length) break;
    const fen = next.history[next.history.length - 1];
    next = { ...next, fen, turn: seatOf(parseFen(fen).turn), history: next.history.slice(0, -1), moves: next.moves.slice(0, -1), last: null };
  } while (next.turn !== seat);
  return next.turn === seat && next.fen !== st.fen ? next : null;
}
