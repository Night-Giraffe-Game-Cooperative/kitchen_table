// Chess explained as it's played: what the piece you picked up can do, the
// special rules at the moment they come up, and why a hinted move is good.
// Tips teach the idea and leave the choice to the player.
import type { GuideSection, Tip } from '../learn';
import { fileOf, inCheck, isAttacked, makeMove, movesFrom, outcome, squareName, type Kind, type Move, type Position, type Side } from './rules';

export const KIND_NAMES: Record<Kind, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VALUE: Record<Kind, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const PIECES: Record<Kind, string> = {
  p: 'Pawns step one square forward, or two on their very first move. They never go back, and they take pieces one square diagonally forward, never straight ahead.',
  n: 'Knights move in an L: two squares one way, then one to the side. They are the only piece that can jump over others.',
  b: 'Bishops slide diagonally as far as the way is clear. Each bishop stays on its own colour of square all game.',
  r: 'Rooks slide straight up, down or across, as far as the way is clear.',
  q: 'The queen slides any distance in any direction, straight or diagonal. She is worth more than any other piece, so think twice before swapping her.',
  k: 'The king steps one square in any direction. He can never step onto a square where he could be taken.',
};

const other = (s: Side): Side => (s === 'w' ? 'b' : 'w');
const isCastle = (pos: Position, m: Move) => pos.board[m.from]?.kind === 'k' && Math.abs(fileOf(m.to) - fileOf(m.from)) === 2;
const isEnPassant = (pos: Position, m: Move) => pos.board[m.from]?.kind === 'p' && m.to === pos.enPassant && fileOf(m.to) !== fileOf(m.from);

/** The same position with `side` to move, to ask what a piece could do next. */
function asTurn(pos: Position, side: Side): Position {
  return { ...pos, turn: side, enPassant: null };
}

/** Tips for the piece just picked up, most useful first. Their keys start "piece:". */
export function pieceTips(pos: Position, square: number, targets: Move[]): Tip[] {
  const piece = pos.board[square];
  if (!piece) return [];
  if (!targets.length) {
    if (inCheck(pos))
      return [
        {
          key: 'piece:stuck-check',
          text: "You're in check, so this move has to rescue your king: move the king, put a piece in the way, or take the attacker. This piece can't do any of those.",
        },
      ];
    const without = { ...pos, board: pos.board.map((p, i) => (i === square ? null : p)) };
    if (piece.kind !== 'k' && inCheck(without, piece.side))
      return [{ key: 'piece:pinned', text: "This piece is pinned: it's standing between your king and an attacker, and moving it would leave the king in check." }];
    return [{ key: 'piece:blocked', text: 'This piece has nowhere to go just now because its way is blocked. Moving other pieces can free it.' }];
  }

  const tips: Tip[] = [];
  if (targets.some((m) => isCastle(pos, m)))
    tips.push({
      key: 'piece:castle',
      text: "Castling: the king can hop two squares towards a rook, and the rook jumps over to land beside him. It tucks the king away safely. It's only allowed when neither has moved yet, nothing stands between them, and the king isn't in check or crossing an attacked square.",
    });
  if (targets.some((m) => isEnPassant(pos, m)))
    tips.push({
      key: 'piece:en-passant',
      text: "En passant: their pawn just rushed two squares and landed beside yours. Just this once, you can take it as if it had only moved one, by stepping diagonally behind it.",
    });
  tips.push({ key: `piece:${piece.kind}`, text: PIECES[piece.kind] });
  if (targets.some((m) => pos.board[m.to]))
    tips.push({ key: 'piece:capture', text: 'A ring means you can take the piece there. Before you do, look at whether one of theirs could take back.' });
  tips.push({ key: 'piece:dots', text: 'Dots are the empty squares this piece can reach. Tap one to move, or tap a different piece of yours.' });
  return tips;
}

/** Tips for the start of a turn: check, and special moves the other side just made. */
export function turnTips(pos: Position, before: Position | null, last: [number, number] | null, firstMoves: boolean): Tip[] {
  const tips: Tip[] = [];
  if (inCheck(pos))
    tips.push({
      key: 'check',
      text: 'Check! Your king is under attack. This move must get him out of it: move the king, put a piece in the way, or take the attacker.',
    });
  if (before && last) {
    const move = movesFrom(before, last[0]).find((m) => m.to === last[1]);
    if (move && isCastle(before, move))
      tips.push({ key: 'they-castled', text: 'They just castled: the king hopped two squares and the rook jumped over beside him. It tucks the king away safely.' });
    else if (move && isEnPassant(before, move))
      tips.push({
        key: 'they-en-passant',
        text: 'They just took a pawn en passant. When a pawn rushes two squares past an enemy pawn, that pawn may take it on the very next move as if it had moved one.',
      });
    else if (move?.promotion) tips.push({ key: 'they-promoted', text: 'Their pawn reached the far side, so it became a new piece of their choice.' });
  }
  if (firstMoves)
    tips.push({
      key: 'start',
      text: "Tap one of your pieces to see where it can go. The aim is checkmate: attacking the other king so that it can't escape.",
    });
  return tips;
}

export const PROMOTE_TIP: Tip = {
  key: 'promote',
  text: 'A pawn that reaches the far side becomes any piece you like. Most people choose the queen, the strongest of all.',
};

export function endTip(ended: string | undefined): Tip | null {
  const text: Record<string, string> = {
    checkmate: "Checkmate: the king is under attack and there's no move that saves him. That ends the game.",
    stalemate:
      "Stalemate: the player to move isn't in check but has no move they're allowed to make, so it's a draw. When you're ahead, leave the other king a square to step to.",
    fifty: "Fifty moves each went by without a capture or a pawn move, so it's a draw.",
    material: "Neither side has enough pieces left to checkmate, so it's a draw.",
    repetition: "The same position came round three times, so it's a draw.",
  };
  return ended && text[ended] ? { key: `end-${ended}`, text: text[ended] } : null;
}

/** The biggest piece of theirs that the piece on `square` could take next. */
function biggestTarget(pos: Position, square: number, side: Side): { kind: Kind; guarded: boolean } | null {
  let best: { kind: Kind; guarded: boolean } | null = null;
  for (const m of movesFrom(asTurn(pos, side), square)) {
    const victim = pos.board[m.to];
    if (!victim || victim.kind === 'k') continue;
    if (!best || VALUE[victim.kind] > VALUE[best.kind]) best = { kind: victim.kind, guarded: isAttacked(pos, m.to, other(side)) };
  }
  return best;
}

/** Says what a move does and why it's worth playing, for the Hint button. */
export function explainMove(pos: Position, move: Move): string {
  const piece = pos.board[move.from]!;
  const name = KIND_NAMES[piece.kind];
  const them = other(piece.side);
  const after = makeMove(pos, move);
  const castle = isCastle(pos, move);
  const what = castle ? 'Try castling.' : `Try your ${name} from ${squareName(move.from)} to ${squareName(move.to)}.`;
  if (outcome(after)?.kind === 'checkmate') return `${what} That's checkmate: their king is attacked and has no way out.`;

  const why: string[] = [];
  const victim = pos.board[move.to]?.kind ?? (isEnPassant(pos, move) ? 'p' : null);
  if (castle) why.push('It tucks your king safely towards the corner and brings a rook towards the middle.');
  if (move.promotion) why.push(`Your pawn reaches the far side and becomes a ${KIND_NAMES[move.promotion]}.`);
  if (victim) {
    const answered = isAttacked(after, move.to, them);
    why.push(
      !answered
        ? `It takes their ${KIND_NAMES[victim]}, and nothing of theirs can take back.`
        : VALUE[victim] > VALUE[piece.kind]
          ? `It takes their ${KIND_NAMES[victim]}, which is worth more than your ${name}, so you come out ahead even if they take back.`
          : `It takes their ${KIND_NAMES[victim]}.`,
    );
  }
  if (inCheck(after)) why.push('It puts their king in check, so they have to deal with that first.');
  if (!victim && piece.kind !== 'k' && isAttacked(pos, move.from, them) && !isAttacked(after, move.to, them))
    why.push(`Your ${name} was under attack on ${squareName(move.from)}, and on ${squareName(move.to)} it's safe.`);
  if (why.length < 2) {
    const target = biggestTarget(after, move.to, piece.side);
    if (target && (!target.guarded || VALUE[target.kind] > VALUE[piece.kind])) why.push(`From there it attacks their ${KIND_NAMES[target.kind]}.`);
  }
  if (!why.length) {
    const home = piece.side === 'w' ? 7 : 0;
    const centre = [27, 28, 35, 36].includes(move.to);
    if ((piece.kind === 'n' || piece.kind === 'b') && move.from >> 3 === home && pos.fullmove <= 12)
      why.push('Getting knights and bishops off the back row early brings them into the game.');
    else if (piece.kind === 'p' && centre) why.push('Pawns in the middle give your pieces room to move and squeeze theirs.');
    else {
      const was = movesFrom(asTurn(pos, piece.side), move.from).length;
      const now = movesFrom(asTurn(after, piece.side), move.to).length;
      why.push(
        now > was
          ? `On ${squareName(move.to)} your ${name} can reach ${now} squares instead of ${was}.`
          : 'It keeps your pieces safe and looked the strongest choice a couple of moves ahead.',
      );
    }
  }
  return [what, ...why.slice(0, 2)].join(' ');
}

export const chessGuide: GuideSection[] = [
  {
    title: 'The aim',
    body: "Checkmate the other king: attack it so that it has no way to escape. You never actually take the king. White moves first, then you take turns, one move each.",
  },
  {
    title: 'How the pieces move',
    body: [
      'Pawn: one square forward, two on its first move. It takes diagonally forward.',
      'Knight: an L shape, two then one. It jumps over pieces.',
      'Bishop: any distance diagonally.',
      'Rook: any distance straight up, down or across.',
      'Queen: any distance in any direction.',
      'King: one square in any direction.',
    ],
  },
  {
    title: 'Taking pieces',
    body: "Move onto a square with one of their pieces to take it. Taken pieces sit beside each player's name. A rough guide to what they're worth: pawn 1, knight 3, bishop 3, rook 5, queen 9.",
  },
  {
    title: 'Check and checkmate',
    body: "When a king is under attack it's in check, and its player must fix that straight away: move the king, block the attack, or take the attacker. If none of those works, it's checkmate and the game is over.",
  },
  {
    title: 'Special moves',
    body: [
      'Castling: the king hops two squares towards a rook and the rook jumps over beside him. Only if neither has moved and the king is not in check.',
      'Promotion: a pawn that reaches the far side becomes any piece you like, usually a queen.',
      'En passant: if a pawn rushes two squares to land beside yours, you may take it on your very next move as if it had moved one.',
    ],
  },
  {
    title: 'Draws',
    body: "If the player to move has no allowed move but isn't in check, that's stalemate and the game is a draw. It's also a draw when neither side can checkmate, or the same position comes up three times.",
  },
  {
    title: 'On this board',
    body: 'Tap a piece to pick it up. Dots show where it can go and rings show pieces it can take. Playing as a family, Hint suggests a move and says why, and Take back undoes your last move.',
  },
];
