// Doodle Battle rules. Everyone in the chat draws the same thing in secret.
// When every picture is in, or someone shows them early, everyone gives a
// star to their favourite, never their own, and the most stars wins.

export interface DuelState {
  turn: 'anyone';
  prompt: string;
  phase: 'drawing' | 'voting' | 'done';
  players: number[];
  entries: Record<string, string>; // person id -> picture url
  votes: Record<string, number>; // voter id -> person whose picture they chose
}

/**
 * Adds someone's picture; someone who wasn't asked to draw joins the players.
 * Once every player's picture is in, they're shown. A picture finished after
 * they were shown early joins them, rather than hiding them again.
 */
export function addEntry(s: DuelState, u: number, url: string): DuelState | null {
  if (s.phase === 'done' || s.entries[u]) return null;
  const entries: Record<string, string> = { ...s.entries, [u]: url };
  const players = s.players.includes(u) ? s.players : [...s.players, u];
  const everyone = players.every((id) => entries[id]);
  return { ...s, entries, players, phase: s.phase === 'voting' || everyone ? 'voting' : 'drawing' };
}

/** Shows the pictures without waiting for everyone, once there are two to choose between. */
export function showNow(s: DuelState): DuelState | null {
  if (s.phase !== 'drawing' || Object.keys(s.entries).length < 2) return null;
  return { ...s, phase: 'voting' };
}

/** A star for someone else's picture, or a change of mind. */
export function vote(s: DuelState, voter: number, choice: number): DuelState | null {
  if (s.phase !== 'voting' || voter === choice || !s.entries[choice]) return null;
  return { ...s, votes: { ...s.votes, [voter]: choice } };
}

/**
 * Whether the stars can be counted without anyone pressing Count: every player
 * has drawn and every artist has given a star. After the pictures were shown
 * early, someone may still be drawing, so it waits for Count instead.
 */
export function allVoted(s: DuelState): boolean {
  return s.players.every((id) => s.entries[id]) && Object.keys(s.entries).every((voter) => s.votes[voter]);
}

/**
 * Whether Count the stars now is offered: once someone has given a star, or
 * when there's only one picture, so nobody else can give it one.
 */
export function canCount(s: DuelState): boolean {
  return s.phase === 'voting' && (Object.keys(s.votes).length > 0 || Object.keys(s.entries).length < 2);
}

export function tally(s: DuelState): Map<number, number> {
  const counts = new Map<number, number>();
  for (const id of Object.values(s.votes)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** Whether the game is waiting on this person: to draw, or, as an artist, to give a star. */
export function waitsOn(s: DuelState, me: number): boolean {
  if (s.phase === 'drawing') return s.players.includes(me) && !s.entries[me];
  if (s.phase === 'voting') return !!s.entries[me] && !s.votes[me] && Object.keys(s.entries).length > 1;
  return false;
}
