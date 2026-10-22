// Dots and Boxes: a grid of dots on squared exercise-book paper. Take turns
// drawing a line between two dots side by side; draw the fourth side of a box
// to make it yours and go again. Most boxes wins. Play the computer as a family
// or on your own, or 2 to 4 people against each other.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Avatar, Button } from '../../components/ui';
import { confirmFirst } from '../../components/confirm';
import type { Game, Person, Seat } from '../../lib/types';
import type { GameDef, GameProps, OptionsProps, PlayerSeat, Update } from '../common';
import { nameOf, nextSeat, placings, playerSeats, seatOrder, startGame } from '../common';
import { bandOf, step } from '../bands';
import { TipNote, useLearn, useTips, type Lesson, type Tip } from '../learn';
import { WhoPlays, whoHint, type Who } from '../opponents';
import { JoinBanner, PlayerPicker, defaultPlayers, winnerText } from '../word-garden/Players';
import { anySafeLine, computerTurn, giveaway, levelFor, levelName } from './ai';
import {
  boxesBeside,
  boxesText,
  drawLine,
  endSummary,
  isOver,
  lastRun,
  lineAt,
  lineName,
  lineToward,
  nearestLine,
  newBoard,
  scoresOf,
  sidesOf,
  sizeFor,
  winners,
  type DotsState,
} from './rules';

type State = DotsState;

interface Options {
  mode: 'coop' | 'versus';
  /** Against the computer: everyone in the chat as one team, or just the person starting it. */
  who: Who;
  /** Against each other: who else plays, in turn order. */
  players: PlayerSeat[];
}

const TYPE = 'dots_boxes';
/** How long the computer takes over each line it draws, so its turn can be followed. */
const DRAW_GAP = 450;

type Colour = Person['colour'];
/** Pen colours to fall back on when two players share a colour. */
const PENS: Colour[] = ['sky', 'rose', 'meadow', 'apricot', 'lilac', 'sea', 'sunflower', 'slate'];

/** A pen colour for each seat: their own colour unless someone earlier has it. The computer writes in slate. */
function seatColours(seats: Record<string, Seat>, people: Map<number, Person>): Record<string, Colour> {
  const order = seatOrder(seats);
  const out: Record<string, Colour> = {};
  const taken = new Set<Colour>();
  for (const k of order) {
    if (seats[k] !== 'computer') continue;
    out[k] = 'slate';
    taken.add('slate');
  }
  for (const k of order) {
    if (out[k]) continue;
    const who = seats[k];
    const own = typeof who === 'number' ? people.get(who)?.colour : who === 'team' ? 'sky' : undefined;
    const pen = own && !taken.has(own) ? own : (PENS.find((c) => !taken.has(c)) ?? 'slate');
    out[k] = pen;
    taken.add(pen);
  }
  return out;
}

function faceOf(who: Seat, people: Map<number, Person>, colour: Colour): Pick<Person, 'avatar' | 'colour' | 'name'> | undefined {
  if (who === 'computer') return { avatar: '🤖', colour, name: 'The computer' };
  if (who === 'team') return { avatar: '👨‍👩‍👧', colour, name: 'The family' };
  const p = typeof who === 'number' ? people.get(who) : undefined;
  return p && { avatar: p.avatar, name: p.name, colour };
}

/** What goes in a claimed box: an initial, or an emoji for the computer and the family. */
function markOf(who: Seat, people: Map<number, Person>): string {
  if (who === 'computer') return '🤖';
  if (who === 'team') return '👨‍👩‍👧';
  const name = typeof who === 'number' ? people.get(who)?.name.trim() : '';
  return name ? [...name][0].toUpperCase() : '?';
}

/** A name for the middle of a sentence: "you", "Mia", "the computer". */
function called(who: Seat | undefined, people: Map<number, Person>, me: number): string {
  if (who === me) return 'you';
  if (who === 'computer') return 'the computer';
  if (who === 'team') return 'the family';
  if (typeof who === 'number') return people.get(who)?.name ?? 'someone';
  return 'the next player';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const boxesWord = (n: number) => (n === 1 ? 'a box' : `${n} boxes`);
const calm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const TIPS = {
  start: {
    key: 'start',
    basic: true,
    text: 'Tap the gap between two dots that sit side by side to draw a line. Lines go across or down, never corner to corner.',
  },
  again: { key: 'again', basic: true, text: 'You drew the fourth side, so that box is yours! Finishing a box means you go again.' },
  gift: { key: 'gift', basic: true, text: 'A glowing box has three sides. One more line takes it, and then you go again.' },
  third: { key: 'third', text: 'Watch out for third sides. Draw the third side of a box and the next player can finish it.' },
  fewest: { key: 'fewest', text: 'Every line left gives a box away now. Some give away more than others.' },
  chains: {
    key: 'chains',
    text: 'Every line left gives boxes away now. Boxes joined in a row make a chain: finish one and the next opens up. A short chain gives away less than a long one.',
  },
} satisfies Record<string, Tip>;

function Board({ game, play, me, people }: GameProps<State>) {
  const s = game.state;
  const n = s.size;
  const seats = game.seats;
  const order = seatOrder(seats);
  const coop = game.mode === 'coop';
  const done = game.status === 'finished';
  const band = bandOf(s);
  const learn = useLearn(TYPE);
  const tips = useTips(TYPE, { band, learn });
  // Boxes with three sides glow up to age 10, and for anyone in learn mode.
  const glow = step(band) <= 1 || learn;
  const colours = useMemo(() => seatColours(seats, people), [seats, people]);
  const marks = useMemo(() => Object.fromEntries(order.map((k) => [k, markOf(seats[k], people)])), [seats, people]);
  const turnWho = seats[s.turn];
  const myTurn = !done && me.permissions.play_games && (turnWho === me.id || turnWho === 'team');
  const scores = scoresOf(s, order);

  const [pending, setPending] = useState<State | null>(null);
  const [again, setAgain] = useState(false);
  const [roving, setRoving] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const refocus = useRef(false);
  const keysId = useId();

  // How many of the saved lines are on show. People's lines show at once; the
  // computer's arrive one at a time, as if it were drawing them. Lines from
  // before this board opened (`from`) don't animate at all.
  const [shown, setShown] = useState({ id: game.id, n: s.order.length, from: s.order.length });
  if (shown.id !== game.id) setShown({ id: game.id, n: s.order.length, from: s.order.length });
  let count = Math.min(shown.n, s.order.length);
  while (count < s.order.length && seats[s.lines[s.order[count]] ?? ''] !== 'computer') count++;
  const revealing = count < s.order.length;

  useEffect(() => {
    if (!revealing) return;
    const t = window.setTimeout(() => setShown((v) => ({ ...v, n: count + 1 })), calm() ? 0 : DRAW_GAP);
    return () => window.clearTimeout(t);
  }, [count, revealing]);

  // My own line shows straight away, while it's saved and the computer replies.
  const early = !!pending && pending.order.length > count;
  const view = early ? pending! : s;
  const upto = early ? pending!.order.length : count;
  const drawn = view.order.slice(0, upto);
  const when = new Map(drawn.map((l, i) => [l, i]));
  const open = useMemo(() => view.lines.flatMap((_, l) => (when.has(l) ? [] : [l])), [view, upto]);
  const sides = (b: number) => sidesOf(n, b).filter((l) => when.has(l)).length;
  const boxOwner = (b: number) => (view.boxes[b] != null && sides(b) === 4 ? view.boxes[b] : null);
  // The scores and whose turn it is keep pace with the lines on show.
  const shownScores: Record<string, number> = Object.fromEntries(order.map((k) => [k, 0]));
  for (let b = 0; b < n * n; b++) {
    const owner = boxOwner(b);
    if (owner) shownScores[owner] = (shownScores[owner] ?? 0) + 1;
  }
  const shownTurn = early ? pending!.turn : revealing ? (s.lines[s.order[count]] ?? s.turn) : s.turn;

  const canDraw = myTurn && !play.busy && !pending && !revealing;
  const thinking = !!pending && coop && seats[pending.turn] === 'computer' && !isOver(pending);
  const target = roving !== null && when.has(roving) ? nearestLine(n, open, roving) : (roving ?? open[0] ?? null);

  // A line that's drawn stops being a button, so keyboard focus moves to the nearest line still to draw.
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    if (target !== null && !gridRef.current?.contains(document.activeElement)) buttons.current.get(target)?.focus();
  });

  // Tips at the start of each of my turns: how to draw, going again, boxes ready to take, chains near the end.
  useEffect(() => {
    if (done) return void tips.dismiss();
    if (!myTurn || revealing) return;
    let threes = 0;
    let twos = 0;
    s.boxes.forEach((owner, b) => {
      const k = owner ? 4 : sidesOf(n, b).filter((l) => s.lines[l] != null).length;
      if (k === 3) threes++;
      if (k === 2) twos++;
    });
    const run = lastRun(s);
    tips.offer(
      s.order.every((l) => s.lines[l] !== s.turn) ? TIPS.start : null,
      run && run.seat === s.turn && run.boxes > 0 ? TIPS.again : null,
      glow && threes > 0 ? TIPS.gift : null,
      !threes && !anySafeLine(n, s.lines) ? (step(band) >= 2 ? TIPS.chains : TIPS.fewest) : null,
      twos >= 2 ? TIPS.third : null,
    );
  }, [s.order.length, myTurn, revealing, done, learn]);

  async function draw(line: number) {
    if (!canDraw || s.lines[line] != null) return;
    const before = s.order.length;
    const focused = !!gridRef.current?.contains(document.activeElement);
    // Learn mode asks before handing the next player a box, if there's a line that doesn't.
    const lost = learn ? giveaway(n, s.lines, line) : 0;
    if (lost > 0 && anySafeLine(n, s.lines)) {
      const who = called(seats[nextSeat(order, s.turn)], people, me.id);
      const what = lost === 1 ? `That gives ${who} a box.` : `That lets ${who} take ${lost} boxes.`;
      if (!(await confirmFirst('Careful!', 'Draw it anyway', `${what} Draw it anyway?`))) return;
    }
    const mine = drawLine(s, line, order);
    if (!mine) return;
    tips.dismiss();
    refocus.current = focused;
    setPending(mine.state);
    await play.move((st, g): Update<State> | null => {
      // Someone else drew first: see the new board before choosing again.
      if (g.status !== 'active' || st.order.length !== before || st.lines[line] != null) return null;
      if (g.seats[st.turn] !== me.id && g.seats[st.turn] !== 'team') return null;
      const seatsNow = seatOrder(g.seats);
      const made = drawLine(st, line, seatsNow);
      if (!made) return null;
      let next = made.state;
      if (g.mode === 'coop' && g.seats[next.turn] === 'computer' && !isOver(next)) {
        next = computerTurn({ ...next, level: next.level ?? levelFor[bandOf(next)] }, seatsNow);
      }
      if (isOver(next)) return { state: next, status: 'finished', summary: endSummary(next, g.seats, (k) => nameOf(people, g.seats[k])) };
      return { state: next };
    });
    setPending(null);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const from = Number((e.target as HTMLElement).dataset.line);
    if (!Number.isInteger(from)) return;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    let to: number | null;
    if (arrows[e.key]) to = lineToward(n, open, from, ...arrows[e.key]);
    else if (e.key === 'Home') to = open[0] ?? null;
    else if (e.key === 'End') to = open[open.length - 1] ?? null;
    else return;
    e.preventDefault();
    if (to === null) return;
    setRoving(to);
    buttons.current.get(to)?.focus();
  }

  /** "Line across, row 2, between dots 3 and 4, finishes the box below". */
  function labelFor(line: number): string {
    const { dir, row, col } = lineAt(n, line);
    const notes = boxesBeside(n, line).flatMap((b) => {
      const k = sides(b);
      if (k < 2) return [];
      const where = dir === 'across' ? (Math.floor(b / n) < row ? 'above' : 'below') : b % n < col ? 'on the left' : 'on the right';
      return [k === 3 ? `finishes the box ${where}` : `the box ${where} has 2 sides`];
    });
    return [lineName(n, line), ...notes].join(', ');
  }

  async function playAgain() {
    setAgain(true);
    try {
      let next: Record<string, Seat>;
      if (coop) next = { p1: seats.p1, p2: 'computer' };
      else {
        // Same players, and the next one along goes first.
        const players = order.map((k) => seats[k]).filter((p): p is number => typeof p === 'number');
        const turned: PlayerSeat[] = [...players.slice(1), ...players.slice(0, 1)];
        next = playerSeats(order.some((k) => seats[k] === 'open') ? [...turned, 'open'] : turned);
      }
      const state = newBoard(n, { ...(s.level ? { level: s.level } : {}), ...(s.band ? { band: s.band } : {}) });
      await startGame(game.room_id, TYPE, { mode: game.mode, seats: next, state, ...(game.title ? { title: game.title } : {}) });
    } finally {
      setAgain(false);
    }
  }

  const filled = order.every((k) => seats[k] !== 'open');
  const tally = order.length === 2 && filled ? ` · ${order.map((k) => `${called(seats[k], people, me.id)} ${scores[k]}`).join(', ')}` : '';
  const run = lastRun(s);
  let status: string;
  if (thinking) status = 'The computer is thinking…';
  else if (revealing) status = 'The computer is drawing…';
  else if (done) status = game.summary || 'Finished';
  else if (turnWho === 'open') status = 'Waiting for someone to join';
  else {
    const head = turnWho === me.id ? 'Your turn' : `${nameOf(people, turnWho)}'s turn`;
    if (run && run.boxes > 0 && run.seat !== s.turn) status = `${cap(called(seats[run.seat], people, me.id))} took ${boxesWord(run.boxes)}. ${head}`;
    else if (run && run.boxes > 0) {
      const taker = cap(called(turnWho, people, me.id));
      status = myTurn ? `${taker} took ${boxesWord(run.boxes)}! Go again${tally}` : `${taker} took ${boxesWord(run.boxes)} and goes again${tally}`;
    } else status = `${head}${tally}`;
  }

  let headline = '';
  if (done) {
    const computer = order.find((k) => seats[k] === 'computer');
    const family = order.find((k) => seats[k] !== 'computer') ?? 'p1';
    if (s.ended === 'stopped' || s.ended === 'idle') headline = 'This game was put away';
    else if (computer) {
      const fam = seats[family];
      const name = fam === me.id ? 'You' : nameOf(people, fam);
      const [us, it] = [scores[family], scores[computer]];
      headline = us > it ? `${name} beat the computer! 🎉` : us < it ? 'The computer won this time' : "It's a draw!";
    } else headline = winnerText(winners(s, order), game, me, people);
  }

  return (
    <div className="db">
      <Scores game={game} me={me} people={people} colours={colours} scores={shownScores} turn={done && !revealing ? undefined : shownTurn} />
      <p className="game-status" aria-live="polite">
        {status}
      </p>
      <JoinBanner game={game} me={me} />

      <div className="db-paper sheet" style={{ '--n': n, '--sub': Math.max(2, 7 - n) } as CSSProperties}>
        <div
          ref={gridRef}
          className={`db-grid tint-${colours[shownTurn] ?? 'slate'}`}
          role="group"
          aria-label={`The board, ${n} boxes by ${n}. ${open.length} lines left to draw.`}
          aria-describedby={keysId}
          onKeyDown={onKey}
        >
          {Array.from({ length: n * n }, (_, b) => {
            const owner = boxOwner(b);
            const finishedAt = owner ? Math.max(...sidesOf(n, b).map((l) => when.get(l) ?? 0)) : -1;
            return (
              <span
                key={`b${b}`}
                className={`db-box${owner ? ` tint-${colours[owner] ?? 'slate'}` : ''}`}
                data-owner={owner ? (typeof seats[owner] === 'number' ? 'person' : 'emoji') : undefined}
                data-fresh={(owner && finishedAt >= shown.from) || undefined}
                data-glow={(glow && !done && !revealing && !owner && sides(b) === 3) || undefined}
                style={{ '--r': Math.floor(b / n), '--c': b % n } as CSSProperties}
                aria-hidden="true"
              >
                {owner ? marks[owner] : null}
              </span>
            );
          })}
          {open.map((l) => {
            const { dir, row, col } = lineAt(n, l);
            return (
              <button
                key={`l${l}`}
                ref={(el) => {
                  if (el) buttons.current.set(l, el);
                  else buttons.current.delete(l);
                }}
                type="button"
                className="db-line"
                data-dir={dir}
                data-line={l}
                style={{ '--r': row, '--c': col } as CSSProperties}
                tabIndex={l === target ? 0 : -1}
                aria-label={labelFor(l)}
                aria-disabled={!canDraw || undefined}
                onFocus={() => setRoving(l)}
                onClick={() => draw(l)}
              />
            );
          })}
          {drawn.map((l, i) => {
            const { dir, row, col } = lineAt(n, l);
            const owner = view.lines[l] ?? '';
            return (
              <span
                key={`i${l}`}
                className={`db-ink tint-${colours[owner] ?? 'slate'}`}
                data-dir={dir}
                data-fresh={i >= shown.from || undefined}
                data-last={((!done || revealing) && i === drawn.length - 1) || undefined}
                style={{ '--r': row, '--c': col } as CSSProperties}
                aria-hidden="true"
              />
            );
          })}
          {Array.from({ length: (n + 1) * (n + 1) }, (_, d) => (
            <span key={`d${d}`} className="db-dot" style={{ '--r': Math.floor(d / (n + 1)), '--c': d % (n + 1) } as CSSProperties} aria-hidden="true" />
          ))}
        </div>
        <p id={keysId} className="sr-only">
          Each line still to draw is a button. Arrow keys move between them, and Enter draws one.
        </p>
      </div>

      {!done && <TipNote tip={tips.tip} onClose={tips.dismiss} />}

      {done && !revealing && (
        <div className="result sheet db-result">
          <p className="result-big">{headline}</p>
          <Results game={game} me={me} people={people} colours={colours} scores={scores} />
          {me.permissions.start_games && (
            <Button variant="primary" icon="refresh" busy={again} onClick={playAgain}>
              Play again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

interface ScoreProps {
  game: Game<State>;
  me: GameProps<State>['me'];
  people: Map<number, Person>;
  colours: Record<string, Colour>;
  scores: Record<string, number>;
}

/** Everyone playing, with their pen colour, their boxes so far, and whose turn it is. */
function Scores({ game, me, people, colours, scores, turn }: ScoreProps & { turn?: string }) {
  const level = game.state.level;
  return (
    <ul className="vs-seats db-seats" aria-label="Players and their boxes">
      {seatOrder(game.seats).map((seat) => {
        const who = game.seats[seat];
        const colour = colours[seat] ?? 'slate';
        return (
          <li
            key={seat}
            className={`vs-seat tint-${colour}`}
            data-turn={turn === seat || undefined}
            data-me={who === me.id || undefined}
            data-open={who === 'open' || undefined}
          >
            {who === 'open' ? (
              <span className="vs-open-face" aria-hidden="true">
                ?
              </span>
            ) : (
              <Avatar person={faceOf(who, people, colour)} size="sm" />
            )}
            <span className="vs-seat-text">
              <span className="vs-seat-name">{who === 'open' ? 'Open place' : nameOf(people, who, me.id)}</span>
              <span className="vs-seat-detail">
                <span className="db-pen" aria-hidden="true" />
                {who === 'computer' && level ? `${cap(levelName[level])} · ` : ''}
                {boxesText(scores[seat] ?? 0)}
              </span>
            </span>
            {turn === seat && <span className="sr-only">, their turn</span>}
          </li>
        );
      })}
    </ul>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];

/** Final places, sharing a place on a tie. */
function Results({ game, me, people, colours, scores }: ScoreProps) {
  const seated = seatOrder(game.seats).filter((k) => game.seats[k] !== 'open');
  return (
    <ol className="vs-standings" aria-label="Boxes each">
      {placings(seated, (a, b) => (scores[b] ?? 0) - (scores[a] ?? 0)).map(({ item: seat, place }) => {
        const who = game.seats[seat];
        return (
          <li key={seat} className="vs-standing" data-place={place} data-me={who === me.id || undefined}>
            <span className="vs-medal">
              <span aria-hidden="true">{MEDALS[place - 1] ?? place}</span>
              <span className="sr-only">Place {place}:</span>
            </span>
            <Avatar person={faceOf(who, people, colours[seat] ?? 'slate')} size="sm" />
            <span className="vs-standing-name">{nameOf(people, who, me.id)}</span>
            <span className="vs-standing-main">{boxesText(scores[seat] ?? 0)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Options({ value, onChange, mode, room, me, people }: OptionsProps<Options>) {
  if (mode === 'coop') {
    return (
      <WhoPlays
        value={value.who}
        onChange={(who) => onChange({ ...value, who })}
        hint={`${whoHint(value.who)} ${value.who === 'team' ? 'The family goes first.' : 'You go first.'}`}
      />
    );
  }
  return (
    <>
      <p className="vs-rules">
        Take turns drawing a line between two dots. Draw the fourth side of a box to make it yours, and go again. When every line is drawn, most boxes
        wins!
      </p>
      <PlayerPicker value={value.players} onChange={(players) => onChange({ ...value, players })} room={room} me={me} people={people} max={4} />
    </>
  );
}

const basics: Lesson[] = [
  { art: '✏️', title: 'Draw a line', text: 'Take turns to draw one line between two dots that sit side by side. Lines go across or down.' },
  { art: '🟦', title: 'Finish a box', text: 'Draw the fourth side of a box and it is yours. It fills with your colour.' },
  { art: '🔁', title: 'Go again', text: 'Finishing a box gives you another go. Keep going while you can finish more.' },
  { art: '⚠️', title: 'Beware the third side', text: 'Draw the third side of a box and the next player can finish it. Try not to!' },
  { art: '🔗', title: 'Chains', text: 'Near the end every line gives something away. Boxes in a row make a chain, so give away the shortest one.' },
  { art: '🏆', title: 'Most boxes wins', text: "When every line is drawn, whoever has the most boxes wins. If it's a tie, the win is shared." },
];

export const dotsAndBoxes: GameDef<State, Options> = {
  type: TYPE,
  name: 'Dots and Boxes',
  emoji: '✏️',
  blurb: 'Take turns joining the dots. Draw the last side of a box to make it yours and go again. A pencil-and-paper favourite of the Night Giraffe.',
  modes: ['coop', 'versus'],
  modeLabels: { coop: 'Against the computer', versus: 'Against each other' },
  modeIcons: { coop: 'robot' },
  players: 'The family or one player against the computer, or 2 to 4 players',
  defaults: ({ me, room, mode }) => ({ mode, who: 'team', players: defaultPlayers(room, me) }),
  ready: (o) => o.mode !== 'versus' || o.players.length > 0,
  Options,
  create: (o, { me, mode, band }) => {
    const size = sizeFor[band];
    if (mode === 'coop') {
      const solo = o.who === 'me';
      return {
        mode,
        seats: { p1: solo ? me.id : 'team', p2: 'computer' },
        state: newBoard(size, { level: levelFor[band] }),
        title: solo ? `Dots and Boxes: ${me.name} vs computer` : 'Dots and Boxes: family vs computer',
      };
    }
    return { mode, seats: playerSeats([me.id, ...o.players]), state: newBoard(size) };
  },
  bands: {
    '5-7': '9 boxes, a gentle computer, and boxes with three sides glow so they are easy to spot.',
    '8-10': '16 boxes, a steady computer that always takes a free box, and boxes with three sides glow.',
    '11-13': "25 boxes and a tricky computer that won't hand over boxes if it can help it. Boxes glow only in learn mode.",
    '14+': '36 boxes and a strong computer that counts chains and fights for the last ones. No clues.',
  },
  basics,
  Board,
  guide: [
    { title: 'The aim', body: 'Claim more boxes than anyone else. A box is yours when you draw its fourth side.' },
    {
      title: 'Taking turns',
      body: [
        'On your turn, draw one line between two dots that sit side by side, across or down.',
        'Finish a box and it fills with your colour. Then you go again.',
        'A line between two boxes can finish both at once.',
        'When every line is drawn, the most boxes wins. A tie is shared.',
      ],
    },
    {
      title: 'Against the computer',
      body: 'The family (or just you) goes first. The computer draws its lines straight after yours, one at a time so you can watch. It gets stronger with each age group.',
    },
    {
      title: 'Thinking it through',
      body: [
        'A box with three sides is a gift: whoever goes next can take it. Try not to draw a third side.',
        'Near the end, every line gives something away. Boxes in a row make a chain, and finishing one opens the next. Give away the shortest chain you can.',
        'An expert trick: when you are taking a long chain, you can leave the last two boxes and draw the line at the far end instead. The other side takes those two, then has to open the next chain for you.',
      ],
    },
  ],
  status: (g, me, people) => {
    if (g.status === 'finished') return g.summary || 'Finished';
    const s = g.state;
    const order = seatOrder(g.seats);
    const who = g.seats[s.turn];
    if (who === 'open') return 'Waiting for someone to join';
    const scores = scoresOf(s, order);
    const tally =
      order.length === 2
        ? order.map((k) => `${called(g.seats[k], people, me)} ${scores[k]}`).join(', ')
        : `${s.boxes.filter((b) => b != null).length} of ${s.size * s.size} boxes`;
    return `${who === me ? 'Your turn' : `${nameOf(people, who)}'s turn`} · ${tally}`;
  },
};
