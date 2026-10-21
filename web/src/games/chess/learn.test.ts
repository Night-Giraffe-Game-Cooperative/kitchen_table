import { describe, expect, it } from 'vitest';
import { explainMove, pieceTips, turnTips } from './learn';
import { START_FEN, makeMove, movesFrom, parseFen, squareIndex as sq, type Move } from './rules';

const mv = (from: string, to: string): Move => ({ from: sq(from), to: sq(to) });
const tipsFor = (fen: string, square: string) => {
  const pos = parseFen(fen);
  return pieceTips(pos, sq(square), movesFrom(pos, sq(square))).map((t) => t.key);
};

describe('tips for the piece picked up', () => {
  it('starts with how that piece moves, then what the dots mean', () => {
    expect(tipsFor(START_FEN, 'b1')).toEqual(['piece:n', 'piece:dots']);
    expect(tipsFor('4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1', 'd1')).toEqual(['piece:q', 'piece:capture', 'piece:dots']);
  });

  it('explains special moves first', () => {
    expect(tipsFor('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1')[0]).toBe('piece:castle');
    expect(tipsFor('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5')[0]).toBe('piece:en-passant');
  });

  it("says why a piece can't move", () => {
    expect(tipsFor('4k3/8/8/8/4r3/8/4N3/4K3 w - - 0 1', 'e2')).toEqual(['piece:pinned']);
    expect(tipsFor('4k3/8/8/8/8/8/P7/4K2r w - - 0 1', 'a2')).toEqual(['piece:stuck-check']);
    expect(tipsFor(START_FEN, 'a1')).toEqual(['piece:blocked']);
  });
});

describe('tips at the start of a turn', () => {
  it('explains check, and a castle the other side just made', () => {
    const before = parseFen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
    const after = makeMove(before, mv('e8', 'g8'));
    expect(turnTips(after, before, [sq('e8'), sq('g8')], false).map((t) => t.key)).toEqual(['they-castled']);
    expect(turnTips(parseFen('4k3/8/8/8/8/8/8/4K2r w - - 0 1'), null, null, false).map((t) => t.key)).toEqual(['check']);
    expect(turnTips(parseFen(START_FEN), null, null, true).map((t) => t.key)).toEqual(['start']);
  });
});

describe('hints say why', () => {
  const why = (fen: string, from: string, to: string) => explainMove(parseFen(fen), mv(from, to));

  it('names checkmate, castling and a free capture', () => {
    expect(why('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1', 'a8')).toMatch(/checkmate/);
    expect(why('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1', 'e1', 'g1')).toMatch(/^Try castling\. It tucks your king/);
    expect(why('4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1', 'd1', 'd5')).toMatch(/takes their queen, and nothing of theirs can take back/);
  });

  it('explains quiet opening moves', () => {
    expect(why(START_FEN, 'g1', 'f3')).toMatch(/^Try your knight from g1 to f3\. Getting knights and bishops off the back row/);
    expect(why(START_FEN, 'e2', 'e4')).toMatch(/Pawns in the middle/);
  });

  it('notices escaping an attack and making a threat', () => {
    // The knight on c3 is attacked by the pawn on b4.
    expect(why('4k3/8/8/8/1p6/2N5/8/4K3 w - - 0 1', 'c3', 'e2')).toMatch(/was under attack on c3, and on e2 it's safe/);
    // From c7 the knight forks the king and the rook.
    expect(why('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5', 'c7')).toMatch(/check.*attacks their rook/);
  });
});
