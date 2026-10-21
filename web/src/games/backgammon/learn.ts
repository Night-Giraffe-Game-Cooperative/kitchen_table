// Backgammon explained as it's played: the race and the dice before a roll,
// the bar and bearing off when they come up, and hitting and safe points as
// checkers move. Tips teach the idea and leave the choice to the player.
import type { GuideSection, Tip } from '../learn';
import { canBearOff, count, legalFirstMoves, owner, winKind, type Move, type Position } from './rules';

const RACE: Tip = {
  key: 'race',
  text: 'Backgammon is a race. Your checkers travel anticlockwise: right to left along the top, then left to right along the bottom, into your home in the bottom-right quarter. Get all 15 home, then bear them off.',
};

const DICE: Tip = {
  key: 'dice',
  text: 'Each die moves one checker that many points. You can use both dice on one checker or move two different ones. If a die can be used, it has to be.',
};

const DOUBLES: Tip = { key: 'doubles', text: 'Doubles! A double counts twice, so you get four moves of that number.' };

const BAR: Tip = {
  key: 'bar',
  text: "One of your checkers was hit, so it's on the bar in the middle. It has to come back in before anything else moves. It enters in the top-right quarter: a 1 lands on the far-right point, a 6 right next to the bar.",
};

const BEAR_OFF: Tip = {
  key: 'bear-off',
  text: 'All your checkers are home, so you can bear them off: pick a checker, then tap the tray on the right. A 6 bears off from the point by the bar, a 1 from the far-right point. First to bear off all 15 wins.',
};

const STUCK: Tip = {
  key: 'dice-left',
  text: "None of your checkers can use the dice that are left, so they're lost this turn. Press Done to hand over.",
};

/** Tips at the start of a turn, before and just after the roll. */
export function turnTips(pos: Position, dice: number[], rolled: boolean): Tip[] {
  if (!rolled) return [RACE, DICE];
  const side = pos.turn;
  const tips: Tip[] = [];
  if (pos.bar[side]) tips.push(BAR);
  if (canBearOff(pos, side)) tips.push(BEAR_OFF);
  if (dice.length === 4) tips.push(DOUBLES);
  // Someone joining after the roll still hears the basics.
  return [...tips, RACE, DICE];
}

/** Tips for the checker just picked up. Their keys start "pick:". */
export function pickTips(pos: Position, dests: Move[]): Tip[] {
  const them = pos.turn === 'w' ? 'b' : 'w';
  const tips: Tip[] = [];
  if (dests.some((m) => typeof m.to === 'number' && owner(pos, m.to) === them && count(pos, m.to) === 1))
    tips.push({
      key: 'pick:hit',
      text: "A point with just one of their checkers on it is a blot. Land there and you hit it: it goes to the bar and has to start its journey again.",
    });
  tips.push({
    key: 'pick:points',
    text: "The gold points are where this checker can go with your dice. A point with two or more of their checkers is blocked, so you can't land there.",
  });
  return tips;
}

/** Tips after moving one checker: a checker left alone, and what's next. */
export function stepTips(before: Position, move: Move, after: Position, dice: number[]): Tip[] {
  const side = before.turn;
  const them = side === 'w' ? 'b' : 'w';
  const tips: Tip[] = [];
  if (typeof move.to === 'number' && owner(before, move.to) === them && count(before, move.to) === 1)
    tips.push({ key: 'hit', text: 'Hit! Their checker goes to the bar, and has to come all the way round again.' });
  if (typeof move.to === 'number' && count(after, move.to) === 1 && !canBearOff(after, side))
    tips.push({
      key: 'blot',
      text: 'That checker is on its own now, so it could be hit. Two or more of your checkers on a point make it safe, and block it for them too.',
    });
  if (!dice.length) return tips;
  if (!legalFirstMoves(after, dice).length) tips.push(STUCK);
  else if (canBearOff(after, side) && !canBearOff(before, side)) tips.push(BEAR_OFF);
  return tips;
}

export function endTip(pos: Position): Tip | null {
  const kind = winKind(pos);
  if (kind === 'gammon')
    return { key: 'gammon', text: "A gammon: the winner bore off every checker before the other player had borne off any. It's a bigger win than usual." };
  if (kind === 'backgammon')
    return {
      key: 'backgammon',
      text: "A backgammon: the loser hadn't borne off any checkers and still had one on the bar or in the winner's home. It's the biggest win there is.",
    };
  return null;
}

export const backgammonGuide: GuideSection[] = [
  {
    title: 'The aim',
    body: 'Race all 15 of your checkers round the board into your home, then take them off the board. The first to bear off all 15 wins.',
  },
  {
    title: 'Which way',
    body: "Your checkers travel anticlockwise: right to left along the top, then left to right along the bottom. Your home is the bottom-right quarter. The other player's go the opposite way, so you keep meeting.",
  },
  {
    title: 'The dice',
    body: [
      'Roll both dice, then move a checker by each number. One checker can take both, one after the other.',
      'A double counts twice: four moves of that number.',
      "You must use both dice if you can. If only one can be used, it must be the bigger one when that's possible.",
      "If no move fits, the turn passes.",
    ],
  },
  {
    title: 'Points, blots and hitting',
    body: [
      "A point with two or more checkers belongs to that player. The other side can't land there.",
      'A single checker on its own is a blot. Land on a blot of theirs to hit it.',
      'A hit checker goes on the bar in the middle and must come back in, in the other player\'s home, before its owner moves anything else.',
    ],
  },
  {
    title: 'Bearing off',
    body: "Once all your checkers are in your home, you can bear them off: a 6 takes one off from the point by the bar, a 1 from the far end. If a die is bigger than any checker needs, it bears off the checker furthest from the tray.",
  },
  {
    title: 'Pips',
    body: 'The pip number by each name is how far that player still has to travel in total. Lower is better, so it shows who is ahead in the race.',
  },
  {
    title: 'On this board',
    body: 'Tap Roll the dice, then a checker with a gold ring, then a gold point to move it there. Start the turn again undoes your moves; Done hands over.',
  },
];
