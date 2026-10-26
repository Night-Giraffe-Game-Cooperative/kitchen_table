// Snakes and Ladders: roll the die, hop along the winding board, climb the
// ladders and slide down the smiling snakes. The family (or one player) races
// the Night Giraffe, who rolls straight after them in the same move, or 2 to 6
// players take turns. Each age band has its own fixed board, in rules.ts.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button } from '../../components/ui';
import type { Colour, Game, Me, Person } from '../../lib/types';
import type { GameDef, GameProps, Mode, OptionsProps, PlayerSeat } from '../common';
import { nameOf, playerSeats, seatOrder, startGame } from '../common';
import { bandOf, type Band } from '../bands';
import { TipNote, useLearn, useTips, type Lesson, type Tip } from '../learn';
import type { Who } from '../opponents';
import { JoinBanner, defaultPlayers, winnerText } from '../word-garden/Players';
import { CELL, centre, ladderArt, snakeShapes, type Pt } from './art';
import {
  FAMILY,
  GIRAFFE,
  boardFor,
  cellOf,
  describeRoll,
  hopPath,
  ladders,
  latestRolls,
  newGame,
  rollTurn,
  rowsOf,
  sayRoll,
  snakes,
  squareAt,
  type Board,
  type Roll,
  type State,
} from './rules';

interface Options {
  mode: Mode;
  /** Against the Night Giraffe: everyone in the chat as one team, or just the person starting it. */
  who: Who;
  players: PlayerSeat[];
}

type People = Map<number, Person>;

const TYPE = 'snakes_ladders';
const GAME_NAME = 'Snakes and Ladders';

const TIPS = {
  start: { key: 'start', basic: true, text: 'Press Roll to throw the die. Your counter hops forward that many squares.' },
  count: {
    key: 'count',
    basic: true,
    text: 'Count the squares as your counter hops: along the row, up, then back the other way. The board winds up to the top like a path.',
  },
  ladder: { key: 'ladder', basic: true, text: 'You landed at the bottom of a ladder, so up you climbed. Ladders are the good bits!' },
  snake: { key: 'snake', basic: true, text: "You landed on a snake's head, so you slid down to its tail. It happens to everyone." },
  exact: { key: 'exact', text: 'You need the exact number to land on the last square. Roll too many and you bounce back the extra.' },
  giraffe: { key: 'giraffe', text: 'The Night Giraffe rolls straight after you, so watch his counter 🦒 hop along too.' },
} satisfies Record<string, Tip>;

/** The seats in turn order: the family then the giraffe, or p1, p2, … */
function orderOf(game: Pick<Game<State>, 'seats'>): string[] {
  return FAMILY in game.seats ? [FAMILY, GIRAFFE] : seatOrder(game.seats);
}

/** "You", "Mia", "The family" or "The Night Giraffe". */
function nameFor(game: Pick<Game<State>, 'seats'>, seat: string, people: People, me?: number): string {
  const id = game.seats[seat];
  if (id === 'computer') return 'The Night Giraffe';
  if (id === 'open') return 'Someone';
  return nameOf(people, id, me);
}

/** "You're on 23", "Mia is on 41". */
const whereText = (name: string, square: number) => (name === 'You' ? `You're on ${square}` : `${name} is on ${square}`);

const possessive = (name: string) => (name === 'You' ? 'Your' : `${name}'s`);

/** A name in the middle of a sentence: "you", "the family", "Mia". */
const inSentence = (name: string) => (name === 'You' ? 'you' : name.replace(/^The /, 'the '));

/** Whoever is in a seat may roll for it: its person, or anyone when it's the family's. */
function mayRoll(game: Pick<Game<State>, 'seats'>, seat: string, me: Me): boolean {
  const id = game.seats[seat];
  return me.permissions.play_games && (id === me.id || id === 'team');
}

function endSummary(game: Pick<Game<State>, 'seats' | 'mode'>, seat: string, people: People): string {
  const id = game.seats[seat];
  if (id === 'computer') return `The Night Giraffe won ${GAME_NAME} this time`;
  if (game.mode === 'coop') return `${nameOf(people, id)} beat the Night Giraffe at ${GAME_NAME} 🎉`;
  return `${nameOf(people, id)} won ${GAME_NAME}`;
}

interface Token {
  face: string;
  colour: Colour;
}

function tokenOf(game: Pick<Game<State>, 'seats'>, seat: string, people: People): Token {
  const id = game.seats[seat];
  if (id === 'computer') return { face: '🦒', colour: 'sunflower' };
  if (id === 'team') return { face: '🏡', colour: 'sea' };
  if (typeof id !== 'number') return { face: '?', colour: 'slate' };
  const p = people.get(id);
  return { face: p?.avatar || p?.name.slice(0, 1).toUpperCase() || '?', colour: p?.colour ?? 'slate' };
}

/** Where counters sit when they share a square, in squares from its centre, and how big they are. */
const SHARED: Record<number, { size: number; at: [number, number][] }> = {
  1: { size: 0.62, at: [[0, 0.05]] },
  2: { size: 0.46, at: [[-0.22, 0.06], [0.22, 0.06]] },
  3: { size: 0.42, at: [[-0.22, -0.12], [0.22, -0.12], [0, 0.24]] },
  4: { size: 0.4, at: [[-0.21, -0.17], [0.21, -0.17], [-0.21, 0.23], [0.21, 0.23]] },
  6: { size: 0.31, at: [[-0.3, -0.15], [0, -0.15], [0.3, -0.15], [-0.3, 0.23], [0, 0.23], [0.3, 0.23]] },
};
const sharedFor = (n: number) => SHARED[n] ?? SHARED[n <= 4 ? 4 : 6];

const prefersLess = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Step {
  seat: string;
  roll: Roll;
}

/** What the board shows while rolls play out, which can lag a little behind the saved game. */
interface Show {
  /** The square each counter is drawn on. */
  spots: Record<string, number>;
  /** A counter on its way up a ladder or down a snake, in board units. */
  slide: { seat: string; at: Pt; ms: number } | null;
  mover: string | null;
  /** Goes up by one each hop, to start the hop animation again. */
  hops: number;
  die: { face: number; seat: string | null; rolling: boolean };
  /** Squares counted so far this roll: square → 1, 2, 3… */
  lit: Record<number, number>;
  say: { seat: string; text: string; kind: string } | null;
  /** The rolls played out in the latest move, for the status line. */
  news: Step[];
  playing: boolean;
}

function startShow(s: State): Show {
  const news = latestRolls(s);
  return {
    spots: { ...s.pos },
    slide: null,
    mover: null,
    hops: 0,
    die: { face: news[news.length - 1]?.roll.roll ?? 6, seat: news[news.length - 1]?.seat ?? null, rolling: false },
    lit: {},
    say: null,
    news,
    playing: false,
  };
}

/**
 * Plays new rolls out on the board as they arrive: the die tumbles, the
 * counter hops square by square (counting them out for the youngest), then
 * climbs its ladder or slides down its snake. A move against the Night
 * Giraffe holds two rolls, played one after the other.
 */
function usePlayback(s: State, { count, words }: { count: boolean; words: boolean }) {
  const [show, setShow] = useState<Show>(() => startShow(s));
  const seen = useRef(s.rolls);
  const queue = useRef<Step[]>([]);
  const running = useRef(false);
  const alive = useRef(true);
  const latest = useRef(s);
  latest.current = s;
  const help = useRef({ count, words });
  help.current = { count, words };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function animate({ seat, roll }: Step) {
    const { count, words } = help.current;
    const b = latest.current.board;
    const hopMs = count ? 430 : words ? 270 : 200;
    setShow((p) => ({
      ...p,
      playing: true,
      mover: seat,
      hops: 0,
      slide: null,
      say: null,
      lit: {},
      spots: { ...p.spots, [seat]: roll.from },
      die: { face: p.die.face, seat, rolling: true },
    }));
    await wait(prefersLess() ? 250 : count ? 750 : 600);
    if (!alive.current) return;
    setShow((p) => ({ ...p, die: { face: roll.roll, seat, rolling: false } }));
    await wait(count ? 380 : 250);

    const path = hopPath(b, roll.from, roll.roll);
    for (let i = 0; i < path.length; i++) {
      if (!alive.current) return;
      const square = path[i];
      setShow((p) => ({ ...p, hops: p.hops + 1, spots: { ...p.spots, [seat]: square }, lit: count ? { ...p.lit, [square]: i + 1 } : p.lit }));
      await wait(hopMs);
    }

    const said = words ? sayRoll(roll, b) : null;
    if (said) setShow((p) => ({ ...p, say: { seat, ...said } }));
    if (roll.via) {
      await wait(count ? 550 : 320);
      if (!alive.current) return;
      if (roll.to > roll.via) {
        setShow((p) => ({ ...p, slide: { seat, at: centre(b, roll.via!), ms: 0 } }));
        await wait(30);
        setShow((p) => ({ ...p, slide: { seat, at: centre(b, roll.to), ms: 750 } }));
        await wait(800);
      } else {
        // Down the snake's wiggly back, a few points at a time.
        const spine = snakeShapes(b).get(roll.via)?.spine ?? [centre(b, roll.via), centre(b, roll.to)];
        const points = spine.filter((_, i) => i % 2 === 0 || i === spine.length - 1);
        const each = Math.max(22, Math.min(60, 950 / points.length));
        for (const at of points) {
          if (!alive.current) return;
          setShow((p) => ({ ...p, slide: { seat, at, ms: each } }));
          await wait(each);
        }
      }
      setShow((p) => ({ ...p, slide: null, spots: { ...p.spots, [seat]: roll.to } }));
    }
    setShow((p) => ({ ...p, news: [...p.news, { seat, roll }] }));
    await wait(count ? 900 : words ? 450 : 300);
    setShow((p) => ({ ...p, lit: {} }));
  }

  async function run() {
    running.current = true;
    setShow((p) => ({ ...p, news: [] }));
    try {
      while (queue.current.length && alive.current) await animate(queue.current.shift()!);
    } finally {
      running.current = false;
    }
    if (!alive.current) return;
    const now = latest.current;
    setShow((p) => ({ ...p, spots: { ...now.pos }, slide: null, mover: null, lit: {}, playing: false, die: { ...p.die, rolling: false } }));
  }

  useEffect(() => {
    // Only rolls newer than the ones already shown; a seat that rolled twice since shows its latest.
    const fresh = Object.entries(s.last)
      .filter(([, r]) => r.n > seen.current)
      .map(([seat, roll]) => ({ seat, roll }))
      .sort((a, b) => a.roll.n - b.roll.n);
    seen.current = Math.max(seen.current, s.rolls);
    if (fresh.length) queue.current.push(...fresh);
    if (!running.current && queue.current.length) void run();
    else if (!running.current) setShow((p) => ({ ...p, spots: { ...s.pos } }));
  }, [s.rolls]);

  return show;
}

const PIPS: Record<number, number[]> = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

/** A big wooden-table die. It tumbles while rolling, showing faces at random. */
function Die({ face, rolling, colour }: { face: number; rolling: boolean; colour: Colour }) {
  const [flicker, setFlicker] = useState(face);
  useEffect(() => {
    if (!rolling || prefersLess()) return;
    const t = setInterval(() => setFlicker(1 + Math.floor(Math.random() * 6)), 95);
    return () => clearInterval(t);
  }, [rolling]);
  const shown = rolling && !prefersLess() ? flicker : face;
  return (
    <span className="sl-die" data-rolling={rolling || undefined} data-colour={colour} aria-hidden="true">
      {(PIPS[shown] ?? PIPS[6]).map((p) => (
        <span key={p} className="sl-pip" style={{ gridArea: `${Math.ceil(p / 3)} / ${((p - 1) % 3) + 1}` }} />
      ))}
    </span>
  );
}

/** The painted board: squares, wooden ladders and friendly snakes. Drawn again only when squares light up, not on every hop. */
const Painted = memo(function Painted({ board, lit }: { board: Board; lit: Record<number, number> }) {
  const rows = rowsOf(board);
  const art = useMemo(
    () => ({
      ladders: ladders(board).map(([from, to]) => ({ from, ...ladderArt(centre(board, from), centre(board, to)) })),
      snakes: [...snakeShapes(board)].map(([from, s]) => ({ from, head: centre(board, from), ...s })),
    }),
    [board],
  );
  const cells: { n: number; tone: string }[] = [];
  for (let vr = 0; vr < rows; vr++) {
    const row = rows - 1 - vr;
    for (let col = 0; col < board.cols; col++) cells.push({ n: squareAt(board, col, row), tone: (row + col) % 2 ? String(row % 7) : 'paper' });
  }
  const line = (a: Pt, b: Pt) => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });

  return (
    <>
      <div className="sl-squares">
        {cells.map(({ n, tone }) => (
          <div key={n} className="sl-sq" data-tone={tone} data-lit={lit[n] ? true : undefined}>
            {n === board.size && <span className="sl-goal">⭐</span>}
          </div>
        ))}
      </div>
      <svg className="sl-art" viewBox={`0 0 ${board.cols * CELL} ${rows * CELL}`} aria-hidden="true" focusable="false">
        {art.ladders.map((l) => (
          <g key={l.from} className="sl-ladder">
            <g className="sl-ladder-shade" transform="translate(4 6)">
              {[...l.rails, ...l.rungs].map(([a, b], i) => (
                <line key={i} {...line(a, b)} />
              ))}
            </g>
            {l.rungs.map(([a, b], i) => (
              <g key={i}>
                <line className="sl-rung-edge" {...line(a, b)} />
                <line className="sl-rung" {...line(a, b)} />
              </g>
            ))}
            {l.rails.map(([a, b], i) => (
              <g key={i}>
                <line className="sl-rail-edge" {...line(a, b)} />
                <line className="sl-rail" {...line(a, b)} />
              </g>
            ))}
          </g>
        ))}
        {art.snakes.map((s) => (
          <g key={s.from} className="sl-snake" data-tone={s.tone}>
            <path className="sl-snake-shade" d={s.body} transform="translate(3 5)" />
            <path className="sl-snake-body" d={s.body} />
            {s.spots.map((d, i) => (
              <circle key={i} className="sl-snake-spot" cx={d.x} cy={d.y} r={d.r} />
            ))}
          </g>
        ))}
        {/* Heads last, so a body never covers a face. */}
        {art.snakes.map((s) => (
          <g key={s.from} className="sl-snake" data-tone={s.tone} transform={`translate(${s.head.x} ${s.head.y})`}>
            <circle className="sl-snake-head" r="21" />
            <circle className="sl-snake-eye" cx="-8" cy="-5" r="6.5" />
            <circle className="sl-snake-eye" cx="8" cy="-5" r="6.5" />
            <circle className="sl-snake-pupil" cx="-7" cy="-4" r="3.2" />
            <circle className="sl-snake-pupil" cx="9" cy="-4" r="3.2" />
            <circle className="sl-snake-cheek" cx="-14" cy="6" r="3.6" />
            <circle className="sl-snake-cheek" cx="14" cy="6" r="3.6" />
            <path className="sl-snake-smile" d="M -9 6 Q 0 15 9 6" />
          </g>
        ))}
      </svg>
      {/* Numbers go on top, so a ladder or snake never hides one. */}
      <div className="sl-labels">
        {cells.map(({ n }) => (
          <div key={n}>
            <span className="sl-num">{n}</span>
          </div>
        ))}
      </div>
    </>
  );
});

function Board({ game, play, me, people }: GameProps<State>) {
  const s = game.state;
  const b = s.board;
  const rows = rowsOf(b);
  const coop = game.mode === 'coop';
  const done = game.status === 'finished';
  const order = orderOf(game);
  const band = bandOf(s);
  const learn = useLearn(TYPE);
  const tips = useTips(TYPE, { band, learn });
  // Counting the hops out for the youngest and in learn mode; saying what happened up to 8–10.
  const count = band === '5-7' || learn;
  const words = count || band === '8-10';
  const show = usePlayback(s, { count, words });
  const [pressed, setPressed] = useState(false);
  const [again, setAgain] = useState(false);

  const name = (seat: string) => nameFor(game, seat, people, me.id);
  const mySeat = order.find((k) => game.seats[k] === me.id || (coop && game.seats[k] === 'team'));
  const waiting = !done && game.seats[s.turn] === 'open';
  const myTurn = !done && !s.winner && !waiting && mayRoll(game, s.turn, me);
  const canRoll = myTurn && !play.busy && !show.playing && !pressed;
  const rolling = show.die.rolling || (pressed && !show.playing);
  const dieSeat = rolling && !show.die.rolling ? s.turn : (show.die.seat ?? s.turn);

  // When a roll has played out: what the ladder or snake did, then what to know for the next roll.
  useEffect(() => {
    if (done) return void tips.dismiss();
    if (show.playing) return;
    const mine = show.news.find((st) => st.seat === mySeat)?.roll;
    const left = mySeat ? b.size - (s.pos[mySeat] ?? 1) : 99;
    tips.offer(
      mine?.via && mine.to > mine.via ? TIPS.ladder : null,
      mine?.via && mine.to < mine.via ? TIPS.snake : null,
      myTurn && s.rolls === 0 ? TIPS.start : null,
      myTurn && b.exact && left <= 6 ? TIPS.exact : null,
      myTurn && coop && s.rolls > 0 ? TIPS.giraffe : null,
      myTurn && s.rolls > 0 ? TIPS.count : null,
    );
  }, [show.playing, myTurn, done]);

  async function roll() {
    if (!canRoll) return;
    const before = s.rolls;
    setPressed(true);
    tips.dismiss();
    await play.move((st, g) => {
      // Someone else in the family may have rolled first: then this roll is theirs, not another one.
      if (g.status !== 'active' || st.winner || st.rolls !== before || !mayRoll(g, st.turn, me)) return null;
      const next = rollTurn(st, g.seats, orderOf(g), st.turn);
      if (!next) return null;
      return next.winner ? { state: next, status: 'finished', summary: endSummary(g, next.winner, people) } : { state: next };
    });
    setPressed(false);
  }

  async function playAgain() {
    setAgain(true);
    try {
      let seats = { ...game.seats };
      if (!coop) {
        // The same players, with the next one starting.
        const players = order.map((k) => game.seats[k]);
        const seated = players.filter((p): p is number => typeof p === 'number');
        const open = players.filter((p) => p === 'open') as 'open'[];
        seats = playerSeats([...seated.slice(1), ...seated.slice(0, 1), ...open]);
      }
      await startGame(game, TYPE, {
        mode: game.mode,
        seats,
        state: { ...newGame(b, orderOf({ seats })), band: s.band },
        ...(game.title ? { title: game.title } : {}),
      });
    } finally {
      setAgain(false);
    }
  }

  // Where each counter is drawn: side by side when they share a square.
  const tokens = useMemo(() => {
    const groups = new Map<number, string[]>();
    for (const seat of order) {
      if (show.slide?.seat === seat) continue;
      const sq = show.spots[seat] ?? 1;
      groups.set(sq, [...(groups.get(sq) ?? []), seat]);
    }
    const out: { seat: string; x: number; y: number; size: number }[] = [];
    for (const [sq, seats] of groups) {
      const { col, row } = cellOf(b, sq);
      const lay = sharedFor(seats.length);
      seats.forEach((seat, i) => {
        const [dx, dy] = lay.at[i] ?? [0, 0];
        out.push({ seat, x: ((col + 0.5 + dx) / b.cols) * 100, y: ((rows - 1 - row + 0.5 + dy) / rows) * 100, size: lay.size });
      });
    }
    if (show.slide) out.push({ seat: show.slide.seat, x: (show.slide.at.x / (b.cols * CELL)) * 100, y: (show.slide.at.y / (rows * CELL)) * 100, size: 0.62 });
    return out.sort((x, y) => order.indexOf(x.seat) - order.indexOf(y.seat));
  }, [show.spots, show.slide, b, order.join()]);

  const where = order.map((seat) => (game.seats[seat] === 'open' ? 'There is an open place.' : `${whereText(name(seat), show.spots[seat] ?? 1)}.`));
  const boardLabel = [
    `${GAME_NAME} board with ${b.size} squares.`,
    `Ladders go from ${ladders(b)
      .map(([f, t]) => `${f} up to ${t}`)
      .join(', ')}.`,
    `Snakes go from ${snakes(b)
      .map(([f, t]) => `${f} down to ${t}`)
      .join(', ')}.`,
    ...where,
  ].join(' ');

  let turnLine = '';
  if (done) turnLine = show.playing ? '' : game.summary || 'This game has finished';
  else if (show.playing) turnLine = '';
  else if (waiting) turnLine = 'Waiting for someone to join';
  else if (myTurn) turnLine = game.seats[s.turn] === 'team' ? "The family's roll" : 'Your roll';
  else if (!coop && mySeat && order[(order.indexOf(s.turn) + 1) % order.length] === mySeat) turnLine = `${possessive(name(s.turn))} roll. You're next`;
  else turnLine = `${possessive(name(s.turn))} roll`;

  const dieName = name(dieSeat);
  const dieLine = rolling ? `${possessive(dieName)} roll…` : show.playing ? `${dieName} rolled ${show.die.face}` : '';
  const left = mySeat ? b.size - (s.pos[mySeat] ?? 1) : 0;
  const exactHint = myTurn && b.exact && !show.playing && left > 0 && left <= 6 ? `You need exactly ${left} to land on ${b.size}.` : '';
  const winner = s.winner;
  // Up a ladder smoothly; down a snake point by point along its back.
  const slideStyle: CSSProperties = show.slide
    ? { transitionDuration: `${show.slide.ms}ms`, transitionTimingFunction: show.slide.ms > 200 ? 'ease-in-out' : 'linear' }
    : {};

  let headline = game.summary || 'This game has finished';
  let detail = '';
  if (winner) {
    const rollsText = `${s.rolls} rolls of the die in all.`;
    if (game.seats[winner] === 'computer') {
      headline = 'The Night Giraffe won this time 🦒';
      detail = `He says thank you for the game, and he'll leave you a good dream tonight. ${rollsText}`;
    } else if (coop) {
      headline = `${nameFor(game, winner, people, me.id)} beat the Night Giraffe! 🎉`;
      detail = rollsText;
    } else {
      headline = winnerText([winner], game, me, people);
      detail = rollsText;
    }
  }

  return (
    <div className="sl">
      <p className="game-status sl-status" aria-live="polite">
        {show.news.map((st) => (
          <span key={st.roll.n} className="sl-news">
            {describeRoll(name(st.seat), st.roll, b)}{' '}
          </span>
        ))}
        {turnLine && <span className="sl-turn">{turnLine}</span>}
      </p>

      <ul className="vs-seats sl-where" aria-label="Where everyone is">
        {order.map((seat) => {
          const tok = tokenOf(game, seat, people);
          const open = game.seats[seat] === 'open';
          const theirs = !done && s.turn === seat && !show.playing;
          return (
            <li
              key={seat}
              className={`vs-seat tint-${tok.colour}`}
              data-turn={theirs || undefined}
              data-me={seat === mySeat || undefined}
              data-open={open || undefined}
            >
              <span className="sl-token sl-token-mini" data-colour={tok.colour} aria-hidden="true">
                {tok.face}
              </span>
              <span className="vs-seat-text">
                <span className="vs-seat-name">{open ? 'Open place' : whereText(name(seat), show.spots[seat] ?? 1)}</span>
              </span>
              {theirs && <span className="sr-only">, {seat === mySeat ? 'your' : 'their'} roll</span>}
            </li>
          );
        })}
      </ul>

      {!coop && <JoinBanner game={game} me={me} />}
      <TipNote tip={tips.tip} onClose={tips.dismiss} />

      <div className="sl-table">
        <div className="sl-board" role="img" aria-label={boardLabel} style={{ '--cols': b.cols, '--rows': rows } as CSSProperties}>
          <Painted board={b} lit={show.lit} />
          <div className="sl-counts">
            {Object.entries(show.lit).map(([sq, n]) => {
              const { col, row } = cellOf(b, Number(sq));
              return (
                <span key={sq} className="sl-count" style={{ left: `${((col + 0.78) / b.cols) * 100}%`, top: `${((rows - 1 - row + 0.24) / rows) * 100}%` }}>
                  {n}
                </span>
              );
            })}
          </div>
          <div className="sl-tokens">
            {tokens.map(({ seat, x, y, size }) => {
              const tok = tokenOf(game, seat, people);
              const moving = show.mover === seat;
              const sliding = show.slide?.seat === seat;
              return (
                <span
                  key={seat}
                  className="sl-token"
                  data-colour={tok.colour}
                  data-moving={moving || undefined}
                  data-hop={moving && !sliding && show.hops ? (show.hops % 2 ? 'a' : 'b') : undefined}
                  style={
                    {
                      left: `${x}%`,
                      top: `${y}%`,
                      '--s': size,
                      ...(sliding ? slideStyle : {}),
                    } as CSSProperties
                  }
                >
                  {tok.face}
                </span>
              );
            })}
          </div>
        </div>

        <div className="sl-dock">
          <div className="sl-die-spot">
            <Die face={show.die.face} rolling={rolling} colour={tokenOf(game, dieSeat, people).colour} />
            <span className="sl-die-line" aria-hidden="true">
              {dieLine}
            </span>
          </div>
          <div className="sl-dock-main">
            {show.say && (
              <p className="sl-say" data-kind={show.say.kind} aria-hidden="true">
                {show.say.text}
              </p>
            )}
            {/* The button stays put between turns, so it keeps keyboard focus. */}
            {!done && mySeat && me.permissions.play_games && (
              <Button variant="primary" size="lg" icon="dice" className="sl-roll" aria-disabled={!canRoll || undefined} onClick={roll}>
                Roll
              </Button>
            )}
            {!done && !myTurn && !show.say && (
              <p className="muted sl-wait">{waiting ? 'Waiting for someone to join' : `Waiting for ${inSentence(name(s.turn))} to roll`}</p>
            )}
            {exactHint && <p className="muted sl-exact">{exactHint}</p>}
          </div>
        </div>
      </div>

      {done && !show.playing && (
        <div className="result sheet">
          <p className="result-big">{headline}</p>
          {detail && <p className="muted">{detail}</p>}
          {me.permissions.start_games && (
            <Button variant="primary" icon="dice" busy={again} onClick={playAgain}>
              Play again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Who plays is chosen first, in New game.
function Options({ mode }: OptionsProps<Options>) {
  return mode === 'coop' ? (
    <p className="vs-rules">The Night Giraffe 🦒 rolls straight after you.</p>
  ) : (
    <p className="vs-rules">Take turns to roll and move. Ladders take you up, snakes slide you down, and the first to the top wins.</p>
  );
}

const basics: Lesson[] = [
  { art: '🏁', title: 'The aim', text: 'Be the first to get your counter to the last square, right at the top of the board.' },
  { art: '🎲', title: 'Rolling', text: 'Press Roll to throw the die. Your counter hops forward that many squares.' },
  { art: '↩️', title: 'The way round', text: 'Count along the bottom row, go up, then come back the other way. The path winds up to the top.' },
  { art: '🪜', title: 'Ladders', text: 'Land at the bottom of a ladder and you climb straight up it.' },
  { art: '🐍', title: 'Snakes', text: "Land on a snake's head and you slide all the way down to its tail." },
  { art: '🦒', title: 'The Night Giraffe', text: "Playing the Night Giraffe? He rolls straight after you, so it's a race to the top." },
];

export const snakesAndLadders: GameDef<State, Options> = {
  type: TYPE,
  name: GAME_NAME,
  emoji: '🐍',
  blurb: 'Climb the ladders, slide down the smiling snakes and race to the top. Play the Night Giraffe as a family, or play each other.',
  modes: ['coop', 'versus'],
  modeLabels: { coop: 'Against the Night Giraffe', versus: 'Against each other' },
  modeIcons: { coop: 'team' },
  players: 'The family or one player against the Night Giraffe, or 2 to 6 players',
  against: 'the Night Giraffe',
  most: 6,
  defaults: ({ me, room, mode }) => ({ mode, who: 'team', players: defaultPlayers(room, me) }),
  ready: (o) => o.mode !== 'versus' || o.players.length > 0,
  Options,
  create: (o, { me, mode, band }) => {
    const board = boardFor(band);
    if (mode === 'coop') {
      const solo = o.who === 'me';
      return {
        mode,
        seats: { [FAMILY]: solo ? me.id : 'team', [GIRAFFE]: 'computer' },
        state: newGame(board, [FAMILY, GIRAFFE]),
        title: solo ? `${GAME_NAME}: ${me.name} vs the Night Giraffe` : `${GAME_NAME}: the family vs the Night Giraffe`,
      };
    }
    const seats = playerSeats([me.id, ...o.players]);
    return { mode, seats, state: newGame(board, seatOrder(seats)) };
  },
  bands: {
    '5-7': 'A small board of 30 squares with 4 ladders and 2 short snakes. The squares light up as you count, and any roll past the end still wins.',
    '8-10': '100 squares with 8 ladders and 7 snakes. The game says what happened after each roll.',
    '11-13': '100 squares with 7 ladders and 9 snakes, and no counting help.',
    '14+': '100 squares with 6 ladders and 10 snakes, some of them long. You need the exact roll to land on 100.',
  } satisfies Record<Band, string>,
  basics,
  Board,
  guide: [
    { title: 'The aim', body: 'Be the first to get your counter to the last square, at the top of the board.' },
    {
      title: 'Taking a turn',
      body: [
        'Press Roll to throw the die. Your counter hops forward that many squares.',
        'The squares go along the bottom row, then up and back the other way, winding up to the top.',
        'A 6 does not give you another go. Everyone just takes turns.',
      ],
    },
    {
      title: 'Ladders and snakes',
      body: ["Land at the bottom of a ladder and you climb up it.", "Land on a snake's head and you slide down to its tail.", 'Going past one does nothing.'],
    },
    {
      title: 'Finishing',
      body: 'For ages 14 and up you need the exact roll to land on the last square. Roll too many and you bounce back the extra. For younger ages, any roll that reaches the end wins.',
    },
    {
      title: 'The Night Giraffe',
      body: 'Against the Night Giraffe, he rolls straight after you, so watch his counter 🦒 race yours to the top. When the family plays together, anyone in the chat can roll.',
    },
  ],
  status: (g, me, people) => {
    if (g.status === 'finished') return g.summary || 'Finished';
    const s = g.state;
    const id = g.seats[s.turn];
    if (id === 'open') return 'Waiting for someone to join';
    const lead = id === me ? 'Your roll' : `${possessive(nameOf(people, id))} roll`;
    return g.mode === 'coop' ? `${lead} · on ${s.pos[FAMILY] ?? 1}, the giraffe on ${s.pos[GIRAFFE] ?? 1}` : lead;
  },
};
