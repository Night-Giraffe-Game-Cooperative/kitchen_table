// Computer opponent: a hand-written evaluation plus, at the top level, a light look at the opponent's replies.
import { diceFor, endTurn, legalOutcomes, winKind, winner } from './rules';
import type { Move, Position, Side } from './rules';

export type Level = 1 | 2 | 3; // 1 = gentle (young children can win), 2 = steady, 3 = tricky

interface Option {
  moves: Move[];
  after: Position; // position after the sequence, with the opponent to move
  score: number;
}

export function chooseSequence(
  pos: Position,
  dice: number[],
  level: Level,
  random: () => number = Math.random,
): Move[] {
  const me = pos.turn;
  const options: Option[] = legalOutcomes(pos, dice).map((o) => {
    const after = endTurn(o.position);
    return { moves: o.moves, after, score: evaluate(after, me) };
  });
  if (options.length === 0) return [];
  if (options.length === 1) return options[0].moves;
  if (level === 1) return gentle(options, random);
  if (level === 2) return steady(options, random);
  return tricky(options, me);
}

// Higher is better for `side`. Roughly in pips: a race lead of one pip is worth 1.
export function evaluate(pos: Position, side: Side): number {
  const win = winner(pos);
  if (win) {
    const kind = winKind(pos);
    const value = 1000 * (kind === 'backgammon' ? 3 : kind === 'gammon' ? 2 : 1);
    return win === side ? value : -value;
  }
  const foe = opponent(side);
  const mine = view(pos, side);
  const theirs = view(pos, foe);
  const contact = hasContact(mine, mirror(theirs));
  // The side about to roll can fix its own blots first, so they count for much less.
  const myRisk = pos.turn === side ? 0.25 : 1;
  const theirRisk = pos.turn === foe ? 0.25 : 1;
  return (
    sideScore(mine, mirror(theirs), pos.off[side], contact, myRisk) -
    sideScore(theirs, mirror(mine), pos.off[foe], contact, theirRisk)
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Choosing a sequence.

function gentle(options: Option[], random: () => number): Move[] {
  // Lots of noise, then any of the better half: beatable, but it still mostly avoids silly moves.
  const noisy = options.map((o) => ({ o, value: o.score + (random() - 0.5) * 40 }));
  noisy.sort((a, b) => b.value - a.value);
  const half = noisy.slice(0, Math.ceil(noisy.length / 2));
  return half[Math.min(half.length - 1, Math.floor(random() * half.length))].o.moves;
}

function steady(options: Option[], random: () => number): Move[] {
  let best = options[0];
  let bestValue = -Infinity;
  for (const o of options) {
    const value = o.score + (random() - 0.5) * 3;
    if (value > bestValue) {
      best = o;
      bestValue = value;
    }
  }
  return best.moves;
}

// Only the most promising few sequences get the (comparatively slow) look at every opponent roll, and the look
// stops after a fixed number of opponent replies so a busy position cannot stall a cheap tablet. The cap counts
// work rather than time, so the choice stays the same on every device.
const SHORTLIST = 4;
const MARGIN = 8;
const REPLY_BUDGET = 3000;

function tricky(options: Option[], me: Side): Move[] {
  const ranked = [...options].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const shortlist = ranked.slice(0, SHORTLIST).filter((o) => o.score >= top.score - MARGIN);
  if (shortlist.length === 1 || winner(top.after) || !inContact(top.after)) return top.moves;
  const budget = { left: REPLY_BUDGET };
  let best = top;
  let bestValue = -Infinity;
  for (const o of shortlist) {
    const value = winner(o.after) ? o.score : expectedAfterReply(o.after, me, budget);
    if (value === null) break;
    if (value > bestValue) {
      best = o;
      bestValue = value;
    }
  }
  return best.moves;
}

const ROLLS: Array<[number, number, number]> = [];
for (let a = 1; a <= 6; a++) {
  for (let b = a; b <= 6; b++) ROLLS.push([a, b, a === b ? 1 : 2]);
}

// Average over the 21 opponent rolls of the position after the opponent's best reply (by the same evaluation),
// or null when the reply budget runs out first.
function expectedAfterReply(pos: Position, me: Side, budget: { left: number }): number | null {
  let total = 0;
  for (const [a, b, weight] of ROLLS) {
    const replies = legalOutcomes(pos, diceFor([a, b]));
    budget.left -= Math.max(1, replies.length);
    if (budget.left < 0) return null;
    let worst = Infinity;
    if (replies.length === 0) worst = evaluate({ ...pos, turn: me }, me);
    for (const r of replies) worst = Math.min(worst, evaluate({ ...r.position, turn: me }, me));
    total += weight * worst;
  }
  return total / 36;
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluation. A side's "view" counts its checkers by distance from bearing off: view[p] for p = 1..24 is the
// checkers that still need p pips, view[25] is its bar. mirror(view) shows the same checkers in the other
// side's distances, so mirror(theirs)[0] is the opponent's bar and mirror(theirs)[p] their checkers at my p.

// Value of a made point by distance from home: 4..7 and the home board matter most; 18..24 are anchors.
const POINT_VALUE = [
  0, 0.5, 1, 1.5, 3, 4, 3.5, 3, 2, 1.2, 0.8, 0.5, 0.3, 0.2, 0.2, 0.2, 0.2, 0.2, 1.5, 2, 3, 2.5, 1.5, 1, 0.8,
];
// Bonus for consecutive made points (a prime) with opposing checkers stuck behind it, by length.
const PRIME_VALUE = [0, 0, 0, 1, 2.5, 4.5, 8];

function opponent(side: Side): Side {
  return side === 'w' ? 'b' : 'w';
}

function view(pos: Position, side: Side): number[] {
  const rel = new Array<number>(26).fill(0);
  for (let i = 0; i < 24; i++) {
    const n = pos.points[i];
    if (side === 'w' && n > 0) rel[i + 1] = n;
    else if (side === 'b' && n < 0) rel[24 - i] = -n;
  }
  rel[25] = pos.bar[side];
  return rel;
}

function mirror(rel: number[]): number[] {
  const out = new Array<number>(26);
  for (let p = 0; p <= 25; p++) out[p] = rel[25 - p];
  return out;
}

// Contact lasts while some opposing checker still has to pass one of mine.
function hasContact(me: number[], them: number[]): boolean {
  let myBack = 0;
  for (let p = 25; p >= 1 && myBack === 0; p--) if (me[p] > 0) myBack = p;
  let theirFront = 25;
  for (let p = 0; p <= 24 && theirFront === 25; p++) if (them[p] > 0) theirFront = p;
  return theirFront < myBack;
}

function inContact(pos: Position): boolean {
  return hasContact(view(pos, 'w'), mirror(view(pos, 'b')));
}

function sideScore(me: number[], them: number[], off: number, contact: boolean, risk: number): number {
  let pips = 0;
  for (let p = 1; p <= 25; p++) pips += p * me[p];
  if (!contact) return raceScore(me, pips, off);

  let theirBack = 25;
  for (let p = 0; p <= 24 && theirBack === 25; p++) if (them[p] > 0) theirBack = p;
  let theirHome = 0;
  for (let p = 19; p <= 24; p++) if (them[p] >= 2) theirHome++;

  let score = -0.5 * pips + 0.5 * off;
  // Being on the bar costs more the more of their home board is closed.
  score -= me[25] * (2 + 1.5 * theirHome);

  let run = 0;
  for (let p = 1; p <= 25; p++) {
    const made = p <= 24 && me[p] >= 2;
    if (made && theirBack < p) {
      // Home board points are worth more while they have checkers on the bar.
      score += POINT_VALUE[p] * (p <= 6 ? 1 + 0.5 * them[0] : 1);
    }
    if (made) run++;
    else {
      if (run >= 3 && theirBack < p - run) score += PRIME_VALUE[Math.min(run, 6)];
      run = 0;
    }
    if (p <= 24 && me[p] > 3) score -= 0.4 * (me[p] - 3);
    if (p <= 24 && me[p] === 1 && theirBack < p) {
      // A blot costs the pips it would lose if hit plus the trouble of coming back in, times the chance of a hit.
      const cost = 0.5 * (25 - p) + 2 + theirHome;
      score -= (risk * countShots(p, me, them) * cost) / 36;
    }
  }
  return score;
}

// Once the checkers have passed each other: pips, bringing checkers home, and bearing off without waste.
function raceScore(me: number[], pips: number, off: number): number {
  let outside = 0;
  for (let p = 7; p <= 25; p++) outside += me[p];
  let score = -pips - outside + 2 * off;
  if (outside === 0) {
    let top = 0;
    for (let p = 6; p >= 1 && top === 0; p--) if (me[p] > 0) top = p;
    for (let p = 1; p < top; p++) if (me[p] === 0) score -= 0.5;
    for (let p = 1; p <= 6; p++) if (me[p] > 3) score -= 0.3 * (me[p] - 3);
  }
  return score;
}

// For each distance 1..24, the rolls (index (a-1)*6 + (b-1) of 36) that can cover it, each with the routes
// (offsets of the in-between landing spots that must be open) that get there.
interface Way {
  roll: number;
  routes: number[][];
}

const WAYS: Way[][] = buildWays();

function buildWays(): Way[][] {
  const ways: Way[][] = Array.from({ length: 25 }, () => []);
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      const roll = (a - 1) * 6 + (b - 1);
      const add = (d: number, route: number[]): void => {
        let way = ways[d].find((w) => w.roll === roll);
        if (!way) {
          way = { roll, routes: [] };
          ways[d].push(way);
        }
        way.routes.push(route);
      };
      if (a === b) {
        add(a, []);
        add(2 * a, [a]);
        add(3 * a, [a, 2 * a]);
        add(4 * a, [a, 2 * a, 3 * a]);
      } else {
        add(a, []);
        add(b, []);
        add(a + b, [a]);
        add(a + b, [b]);
      }
    }
  }
  return ways;
}

// Approximate number of the 36 rolls with which the opponent could hit my blot at distance `target`.
// Ignores that the opponent might have better things to do; with checkers on the bar only they can hit.
const rollHits = new Uint8Array(36); // scratch space, cleared on every call

function countShots(target: number, me: number[], them: number[]): number {
  rollHits.fill(0);
  let shots = 0;
  const barOnly = them[0] > 0;
  const lastSource = barOnly ? 0 : target - 1;
  for (let src = barOnly ? 0 : 1; src <= lastSource; src++) {
    if (them[src] === 0) continue;
    for (const way of WAYS[target - src]) {
      if (rollHits[way.roll]) continue;
      for (const route of way.routes) {
        // Two or more on the bar need both dice just to come in.
        if (barOnly && them[0] > 1 && route.length > 0) continue;
        let open = true;
        for (const step of route) if (me[src + step] >= 2) open = false;
        if (open) {
          rollHits[way.roll] = 1;
          shots++;
          break;
        }
      }
    }
  }
  return shots;
}
