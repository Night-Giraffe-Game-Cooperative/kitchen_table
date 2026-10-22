import type { Game, Person } from '../lib/types';
import type { GameDef } from './common';
import { nameOf } from './common';
import { doodleTogether } from './doodles/DoodleTogether';
import { doodleDuel } from './doodles/DoodleDuel';
import { doodleTelephone } from './doodles/DoodleTelephone';
import { wordGarden } from './word-garden/WordGarden';
import { picturePuzzle } from './picture-puzzle/PicturePuzzle';
import { storyChain } from './story-chain/StoryChain';
import { chess } from './chess/Chess';
import { backgammon } from './backgammon/Backgammon';
import { wheresGiraffe } from './giraffe/WheresGiraffe';
import { familyQuiz } from './family-quiz/FamilyQuiz';
import { pairs } from './pairs/Pairs';
import { fourInARow } from './four-in-a-row/FourInARow';
import { dotsAndBoxes } from './dots-boxes/DotsAndBoxes';
import { snakesAndLadders } from './snakes-ladders/SnakesAndLadders';

/**
 * The games on shelves, for the New game picker. Games played together come
 * first on each shelf: the family plays together more than against each other.
 */
export const gameShelves: { title: string; games: GameDef[] }[] = [
  { title: 'Drawing and stories', games: [doodleTogether, doodleTelephone, storyChain, doodleDuel] },
  { title: 'Puzzles, memory and quizzes', games: [wordGarden, picturePuzzle, pairs, wheresGiraffe, familyQuiz] },
  { title: 'Board games', games: [snakesAndLadders, fourInARow, dotsAndBoxes, chess, backgammon] },
];

export const gameDefs: GameDef[] = gameShelves.flatMap((s) => s.games);

const byType = new Map(gameDefs.map((d) => [d.type, d]));

export function gameDef(type: string): GameDef | undefined {
  return byType.get(type);
}

/** Whether a game is waiting on this person in particular. */
export function isMyTurn(game: Game, me: number): boolean {
  if (game.status !== 'active') return false;
  const waiting = gameDef(game.type)?.waitingOn;
  if (waiting) return waiting(game, me);
  const turn = game.state.turn;
  return typeof turn === 'string' && turn !== 'anyone' && game.seats[turn] === me;
}

export function gameStatusLine(game: Game, me: number, people: Map<number, Person>): string {
  const def = gameDef(game.type);
  if (def?.status) return def.status(game, me, people);
  if (game.status === 'finished') return game.summary || 'Finished';
  const turn = game.state.turn;
  if (!turn || turn === 'anyone') return 'Anyone can play';
  const who = game.seats[turn];
  return who === me ? 'Your turn' : `${nameOf(people, who)}'s turn`;
}
