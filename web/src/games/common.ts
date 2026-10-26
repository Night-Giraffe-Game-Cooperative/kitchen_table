import type { ComponentType } from 'react';
import { api } from '../lib/api';
import type { GuideSection, Lesson } from './learn';
import type { Band } from './bands';
import type { IconName } from '../components/icons';
import { go } from '../lib/router';
import type { Game, Me, Person, Room } from '../lib/types';

export type Mode = 'coop' | 'versus';

/** What a move sends: the whole new state, and whether the game has ended. */
export interface Update<S> {
  state: S;
  status?: 'finished';
  summary?: string;
}

export interface Play<S> {
  /**
   * Makes a move from the latest state. If someone else moved first, the
   * latest state is fetched and `next` runs again on it; return null when the
   * move no longer makes sense.
   */
  move: (next: (state: S, game: Game<S>) => Update<S> | null) => Promise<boolean>;
  busy: boolean;
  /** Live doodle games add strokes without a version check. */
  append?: (key: string, item: Record<string, unknown>) => void;
}

export interface GameProps<S> {
  game: Game<S>;
  play: Play<S>;
  me: Me;
  people: Map<number, Person>;
  room: Room | undefined;
}

export interface NewGame<S = unknown> {
  mode: Mode;
  seats: Record<string, number | 'team' | 'computer' | 'open'>;
  state: S;
  title?: string;
  summary?: string;
}

export interface OptionsProps<O> {
  value: O;
  onChange: (o: O) => void;
  mode: Mode;
  band: Band;
  room: Room;
  me: Me;
  people: Map<number, Person>;
}

export interface GameDef<S = any, O = any> {
  type: string;
  name: string;
  emoji: string;
  blurb: string;
  /** Modes in order of preference; co-op first where there is one. */
  modes: Mode[];
  modeLabels?: Partial<Record<Mode, string>>;
  modeIcons?: Partial<Record<Mode, IconName>>;
  players: string;
  /**
   * Who co-op plays against, like "the computer", when it isn't everyone
   * together. Then co-op is played by one person or the whole chat, and the
   * options' `who` says which ('me' or 'team').
   */
  against?: string;
  /** Only ever one person's, like a bonsai to look after: no choosing who plays, and it stays out of the chat. */
  solo?: boolean;
  /** Most players against each other, you included. Their ids come in the options' `players`, and the first in `opponent`. */
  most?: number;
  defaults: (ctx: { me: Me; room: Room; mode: Mode; band: Band }) => O;
  Options?: ComponentType<OptionsProps<O>>;
  /** May be async, e.g. to upload a photo or let the computer move first. The band is added to the state afterwards. */
  create: (options: O, ctx: { me: Me; room: Room; mode: Mode; band: Band; people: Map<number, Person> }) => NewGame<S> | Promise<NewGame<S>>;
  /** What each age band means in this game, shown when choosing one. */
  bands: Record<Band, string>;
  /** Options to change when the band changes, such as a suggested idea that was for another age. */
  rebanded?: (options: O, band: Band) => O;
  /** The basics, step by step, for learn mode. A game without them has no learn mode. */
  basics?: Lesson[];
  ready?: (options: O) => boolean;
  Board: ComponentType<GameProps<S>>;
  /** One short line about where the game is at, for lists and chat cards. */
  status?: (game: Game<S>, me: number, people: Map<number, Person>) => string;
  /**
   * Whether the game is waiting on this person, for games everyone plays in
   * their own time (turn 'anyone'), so it shows under "Your turn". Games with
   * seats taking turns don't need it.
   */
  waitingOn?: (game: Game<S>, me: number) => boolean;
  /** How to play, from the book button above the board. */
  guide?: GuideSection[];
}

export function nameOf(people: Map<number, Person>, id: unknown, me?: number): string {
  if (id === me) return 'You';
  if (typeof id === 'number') return people.get(id)?.name ?? 'Someone';
  if (id === 'team') return 'The family';
  if (id === 'computer') return 'The computer';
  return 'Someone';
}

/** Joins names as "Mum, Dad and Mia". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/**
 * Versus games where people take turns or race use seats p1, p2, … in turn
 * order. A seat holds a person, or 'open' until someone joins.
 */
export type PlayerSeat = number | 'open';

export function playerSeats(players: PlayerSeat[]): Record<string, PlayerSeat> {
  return Object.fromEntries(players.map((p, i) => [`p${i + 1}`, p]));
}

/** The player seats of a game in turn order. */
export function seatOrder(seats: Record<string, unknown>): string[] {
  return Object.keys(seats)
    .filter((k) => /^p\d+$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

export function nextSeat(order: string[], seat: string): string {
  return order[(order.indexOf(seat) + 1) % order.length];
}

export function seatOf(seats: Record<string, unknown>, id: number): string | undefined {
  return seatOrder(seats).find((k) => seats[k] === id);
}

/** The keys with the top score: more than one when they tie. */
export function leaders(scores: Record<string, number>, keys: string[] = Object.keys(scores)): string[] {
  const top = Math.max(...keys.map((k) => scores[k] ?? 0));
  return keys.filter((k) => (scores[k] ?? 0) === top);
}

/** Sorts best first and gives places, sharing them on a tie: 1, 2, 2, 4. */
export function placings<T>(items: T[], compare: (a: T, b: T) => number): { item: T; place: number }[] {
  const sorted = [...items].sort(compare);
  const out: { item: T; place: number }[] = [];
  sorted.forEach((item, i) => {
    const place = i > 0 && compare(sorted[i - 1], item) === 0 ? out[i - 1].place : i + 1;
    out.push({ item, place });
  });
  return out;
}

/** Takes an open seat in a game. */
export function joinSeat(gameId: number, seat: string) {
  return api.post(`/api/games/${gameId}/join`, { seat });
}

export function shuffle<T>(xs: T[], random = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(xs: T[], random = Math.random): T {
  return xs[Math.floor(random() * xs.length)];
}

/** Games this device pressed Play again on, so it doesn't announce its own next round. */
export const startedHere = new Set<number>();

/**
 * Starts the next round after a game and opens it, for "play again" buttons.
 * Everyone else looking at the last game moves on to it too, and if someone
 * else got there first, this opens theirs.
 */
export async function startGame(last: { id: number; room_id: number }, type: string, made: NewGame) {
  startedHere.add(last.id);
  const res = await api.post<{ game: { id: number } }>(`/api/rooms/${last.room_id}/games`, { type, ...made, after: last.id });
  go({ name: 'games', gameId: res.game.id });
}
