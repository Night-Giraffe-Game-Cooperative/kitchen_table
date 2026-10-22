// Four in a Row explained as it's played: how dropping works, lines of three
// that could become four, and the trap of filling the space under theirs.
// Tips say what's on the board and leave the choice to the player; a hint
// someone asks for names a column and says why.
import type { GuideSection, Lesson, Tip } from '../learn';
import { bestColumn } from './ai';
import { bestLine, boardOf, giftColumns, height, other, outcomeOf, turnOf, winningColumns, type Grid } from './rules';

/** "column 3" or "columns 2 and 6". */
export function columnWords(cols: number[]): string {
  const names = cols.map((c) => String(c + 1));
  if (names.length === 1) return `column ${names[0]}`;
  return `columns ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export const TIPS = {
  start: {
    key: 'start',
    basic: true,
    text: 'Tap a column to drop a counter in. It falls to the lowest empty space. Four of yours in a line wins: across, straight up or on a slant.',
  },
  full: { key: 'full', basic: true, text: 'That column is full to the top. Try another one.' },
  middle: {
    key: 'middle',
    text: 'The middle column is part of more lines of four than any other, so counters there have the most ways to grow.',
  },
  twoThreats: {
    key: 'two-threats',
    text: "They could make four in two places at once. Only one can be blocked, so this is a hard one to stop. It's a clever trick to try yourself!",
  },
  gift: {
    key: 'gift',
    text: 'Careful: there is a space where they could make four, but it is up in the air. Fill the space just under it and they can drop on top and win.',
  },
} satisfies Record<string, Tip>;

/** Tips at the start of a turn about lines of three: one you could finish, or one of theirs. */
export function threatTips(moves: number[], markers: boolean): Tip[] {
  const grid = boardOf(moves);
  const mine = turnOf(moves);
  const wins = winningColumns(grid, mine);
  const theirs = winningColumns(grid, other(mine));
  const tips: Tip[] = [];
  if (wins.length)
    tips.push({
      key: 'can-win',
      text: markers
        ? 'You have three in a line with a space for a fourth. The star shows where.'
        : "You have three in a line, and there's a space for a fourth. Can you find it?",
    });
  if (theirs.length > 1) tips.push(TIPS.twoThreats);
  else if (theirs.length)
    tips.push({
      key: 'block',
      text: markers
        ? 'They have three in a line with a space for a fourth. The warning sign shows where. A counter of yours there stops them.'
        : 'They have three in a line with a space for a fourth. If they get there first, they win.',
    });
  if (giftColumns(grid, mine).length) tips.push(TIPS.gift);
  return tips;
}

/** Learn mode, at the start of a turn: what the other side just did, and what it means for the lines on the board. */
export function turnTip(moves: number[], who: string): Tip | null {
  if (!moves.length) return null;
  const before = boardOf(moves.slice(0, -1));
  const grid = boardOf(moves);
  const last = moves[moves.length - 1];
  const theirs = turnOf(moves.slice(0, -1));
  const mine = other(theirs);
  const parts = [`${who} dropped a counter in column ${last + 1}.`];
  if (winningColumns(before, mine).includes(last)) parts.push('That blocked a line of yours.');
  const wins = winningColumns(grid, mine);
  const threats = winningColumns(grid, theirs);
  const gifts = giftColumns(grid, mine);
  if (wins.length) parts.push(`You could make four in ${columnWords(wins)}!`);
  else if (threats.length > 1) parts.push(`Now they could make four in ${columnWords(threats)}. Only one can be blocked, so this is hard to stop.`);
  else if (threats.length) parts.push(`Now they could make four in ${columnWords(threats)}. A counter of yours there stops them.`);
  else if (gifts.length) parts.push(`Careful with ${columnWords(gifts)}: a counter there fills the space under one where they could make four.`);
  else parts.push('Nobody can make four next go.');
  return { key: `turn:${moves.length}`, text: parts.join(' ') };
}

/** Why a column is a good one, in a few words. */
function reason(grid: Grid, col: number, moves: number[]): string {
  const mine = turnOf(moves);
  const row = height(grid, col);
  if (bestLine(grid, col, row, mine) >= 2) return 'It adds to a line of yours.';
  if (bestLine(grid, col, row, other(mine)) >= 2) return 'It gets in the way of a line of theirs.';
  if (col === 3) return 'Counters in the middle are part of the most lines of four.';
  return "It keeps your lines open and doesn't give them a space they want.";
}

/** A hint someone asked for: a column to try, and why. */
export function hintFor(moves: number[]): { col: number; text: string } | null {
  const grid = boardOf(moves);
  if (outcomeOf(grid)) return null;
  const mine = turnOf(moves);
  const wins = winningColumns(grid, mine);
  if (wins.length) return { col: wins[0], text: `Column ${wins[0] + 1} makes four in a row for you!` };
  const threats = winningColumns(grid, other(mine));
  if (threats.length) {
    const more = threats.length > 1 ? ' They have another one too, so this is a tricky spot.' : '';
    return { col: threats[0], text: `They could make four in column ${threats[0] + 1} next go. A counter of yours there stops them.${more}` };
  }
  const col = bestColumn(moves);
  if (col === null) return null;
  return { col, text: `Try column ${col + 1}. ${reason(grid, col, moves)}` };
}

export const fourBasics: Lesson[] = [
  { art: '🔴', title: 'The aim', text: 'Take turns dropping counters into the frame. The first to get four of their colour in a line wins.' },
  { art: '⬇️', title: 'Dropping', text: 'Tap a column. Your counter falls all the way down to the lowest empty space in it.' },
  { art: '↗️', title: 'Lines of four', text: 'A line can go across, straight up, or on a slant. They all count.' },
  { art: '🛑', title: 'Blocking', text: 'If they have three in a line with a space for a fourth, drop a counter of yours in that space to stop them.' },
  {
    art: '⭐',
    title: 'Stars and warnings',
    text: 'A star above a column means you could make four there. A warning sign means they could, so think about blocking it.',
  },
  { art: '🦒', title: 'A sneaky trick', text: 'The Night Giraffe likes to make two lines of three at once. Only one can be blocked, so the other one wins!' },
];

export const fourGuide: GuideSection[] = [
  { title: 'The aim', body: 'Be the first to get four of your counters in a line: across, straight up, or on a slant. If the frame fills up first, it is a draw.' },
  {
    title: 'Taking turns',
    body: 'Red always goes first. Each turn, drop one counter into any column that has space. It falls to the lowest empty space.',
  },
  {
    title: 'On this board',
    body: [
      'Tap a column to drop your counter, or use the arrow keys to choose a column and press Enter.',
      'For ages 5 to 7, and in learn mode, a star above a column means you could make four there, and a warning sign means they could.',
      "Against the computer, Take back undoes your last move and the computer's reply.",
      'Each new game swaps who goes first.',
    ],
  },
  {
    title: 'Thinking it through',
    body: [
      'The middle column is part of the most lines of four, so it is a strong place to start.',
      'Before you drop, look for any three of theirs with a space for a fourth.',
      'Try not to fill the space just under one where they could make four: they can drop on top.',
      'Two lines of three at once is the best trick of all, because only one can be blocked.',
    ],
  },
];
