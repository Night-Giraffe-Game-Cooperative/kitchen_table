// Four in a Row: drop red and yellow counters into a frame seven columns wide
// and six rows high, and be the first to get four in a line. Play the computer
// on your own or as a family, from a gentle one young children can beat to a
// strong one that looks eight moves ahead, or play each other.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useStore } from '../../lib/store';
import { confirmFirst } from '../../components/confirm';
import { Avatar, Button, Segmented } from '../../components/ui';
import type { Game, Person, Seat as Holder } from '../../lib/types';
import type { GameDef, GameProps, OptionsProps, PlayerSeat, Update } from '../common';
import { joinSeat, nameOf, startGame } from '../common';
import { bandOf, type Band } from '../bands';
import { HINT, TipNote, useLearn, useTips } from '../learn';
import type { Who } from '../opponents';
import { defaultPlayers } from '../word-garden/Players';
import { chooseColumn, type Level } from './ai';
import { TIPS, fourBasics, fourGuide, hintFor, threatTips, turnTip } from './learn';
import {
  COLS,
  DIRECTION_WORDS,
  DISCS,
  ROWS,
  boardOf,
  canDrop,
  discOfMove,
  height,
  moveOrder,
  other,
  outcome,
  playColumn,
  sameMoves,
  takeBackTo,
  turnOf,
  winningColumns,
  type Disc,
  type Outcome,
} from './rules';

const TYPE = 'four_in_a_row';

interface State {
  turn: Disc;
  /** The columns played, in order. Red always goes first, so this is the whole game. */
  moves: number[];
  /** How well the computer plays, against the computer. */
  level?: Level;
  ended?: 'four' | 'full' | 'stopped';
  band?: Band;
}

interface Options {
  /** Against the computer: everyone in the chat as one team, or just the person starting it. */
  who: Who;
  opponent: PlayerSeat;
  /** Who goes first, and so plays red. */
  first: 'me' | 'them' | 'random';
}

const levels: Record<Level, string> = { 1: 'gentle', 2: 'steady', 3: 'tricky', 4: 'strong' };
/** How well the computer plays for each age band. */
const levelFor: Record<Band, Level> = { '5-7': 1, '8-10': 2, '11-13': 3, '14+': 4 };
const COLUMNS = [...Array(COLS).keys()];
const ROWS_DOWN = [...Array(ROWS).keys()].reverse();
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fresh(level?: Level): State {
  return { turn: 'red', moves: [], ...(level ? { level } : {}) };
}

/** The state after a counter in `col`, and whether that ended the game; null if it can't go there. */
function advance(st: State, col: number): { state: State; over: Outcome } | null {
  const moves = playColumn(st.moves, col);
  if (!moves) return null;
  const over = outcome(moves);
  return { state: { ...st, moves, turn: turnOf(moves), ...(over ? { ended: over.kind } : {}) }, over };
}

/** A new game's state. The computer can never take a turn of its own, so if it has red it opens here. */
function opening(seats: Record<Disc, Holder>, level?: Level): State {
  const state = fresh(level);
  if (seats.red !== 'computer') return state;
  const col = chooseColumn([], level ?? 2);
  return (col !== null && advance(state, col)?.state) || state;
}

function summaryOf(over: NonNullable<Outcome>, g: Game<State>, people: Map<number, Person>): string {
  if (over.kind === 'full') return 'Four in a Row ended in a draw';
  const who = g.seats[over.winner];
  if (who === 'computer') return 'The computer won Four in a Row this time';
  if (who === 'team') return 'The family beat the computer at Four in a Row 🎉';
  if (g.seats[other(over.winner)] === 'computer') return `${nameOf(people, who)} beat the computer at Four in a Row 🎉`;
  return `${nameOf(people, who)} won Four in a Row`;
}

function Board({ game, play, me, people }: GameProps<State>) {
  const { toast } = useStore();
  const s = game.state;
  const [preview, setPreview] = useState<number[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<number | null>(null);
  const [focus, setFocus] = useState(3);
  const [again, setAgain] = useState(false);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const coop = game.mode === 'coop';
  const done = game.status === 'finished';
  // My counter shows straight away, while it saves and the computer thinks.
  const moves = preview ?? s.moves;
  const grid = useMemo(() => boardOf(moves), [moves]);
  const order = useMemo(() => moveOrder(moves), [moves]);
  const over = useMemo(() => (done ? outcome(s.moves) : null), [done, s.moves]);
  const win = over?.kind === 'four' ? over : null;
  const band = bandOf(s);
  const learn = useLearn(TYPE);
  const tips = useTips(TYPE, { band, learn });

  const human = DISCS.find((d) => game.seats[d] !== 'computer');
  const mySeat = DISCS.find((d) => game.seats[d] === me.id || (coop && game.seats[d] === 'team' && me.permissions.play_games));
  const turnWho = game.seats[s.turn];
  const openSeat = DISCS.find((d) => game.seats[d] === 'open');
  const myTurn = !done && me.permissions.play_games && (turnWho === 'team' || turnWho === me.id);
  const canPlay = myTurn && !play.busy && !preview;
  // Stars and warnings above the columns: always for the youngest, and in learn mode.
  const markers = myTurn && !preview && (band === '5-7' || learn);
  const stars = markers ? winningColumns(grid, s.turn) : [];
  const warnings = markers ? winningColumns(grid, other(s.turn)).filter((c) => !stars.includes(c)) : [];
  const hints = myTurn && (band === '5-7' || band === '8-10' || (band === '11-13' && learn));
  const humanMoves = human ? s.moves.filter((_, i) => discOfMove(i) === human).length : 0;

  // Counters already there when the board opened don't fall again; ones dropped after a take back do.
  const still = useRef(s.moves.length);
  if (moves.length < still.current) still.current = moves.length;

  // At the start of each turn: how to play, lines of three, and in learn mode what the other side just did.
  useEffect(() => {
    if (done) return void tips.dismiss();
    if (!myTurn) return;
    tips.offer(
      s.moves.length < 2 ? TIPS.start : null,
      learn ? turnTip(s.moves, nameOf(people, game.seats[other(s.turn)])) : null,
      ...threatTips(s.moves, band === '5-7' || learn),
      s.moves.length < 3 ? TIPS.middle : null,
    );
  }, [s.moves.length, myTurn, done, learn]);

  useEffect(() => setHint(null), [s.moves.length]);

  async function drop(col: number) {
    if (!canPlay) return;
    if (!canDrop(grid, col)) return void tips.show(TIPS.full);
    const seen = s.moves;
    const mine = playColumn(s.moves, col);
    if (!mine) return;
    setHint(null);
    tips.dismiss();
    setPreview(mine);
    const computerNext = coop && game.seats[turnOf(mine)] === 'computer' && !outcome(mine);
    setThinking(computerNext);
    const started = Date.now();
    // Let the counter start to fall before the computer thinks.
    await sleep(60);

    const ok = await play.move((st, g): Update<State> | null => {
      // Moves are retried on the newest game: if another counter has gone in since, this one was meant for a different board.
      if (g.status !== 'active' || !sameMoves(st.moves, seen) || (g.seats[st.turn] !== 'team' && g.seats[st.turn] !== me.id)) return null;
      let step = advance(st, col);
      if (!step) return null;
      if (!step.over && g.mode === 'coop' && g.seats[step.state.turn] === 'computer') {
        const reply = chooseColumn(step.state.moves, st.level ?? 2);
        step = (reply !== null && advance(step.state, reply)) || step;
      }
      if (step.over) return { state: step.state, status: 'finished', summary: summaryOf(step.over, g, people) };
      return { state: step.state };
    });
    // A moment to think, so the computer's counter drops after mine rather than with it.
    const wait = 500 - (Date.now() - started);
    if (ok && computerNext && wait > 0) await sleep(wait);
    setThinking(false);
    setPreview(null);
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, col: number) {
    const to = e.key === 'ArrowLeft' ? col - 1 : e.key === 'ArrowRight' ? col + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? COLS - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(COLS - 1, to));
    setFocus(next);
    buttons.current[next]?.focus();
  }

  function giveHint() {
    const h = hintFor(s.moves);
    if (!h) return;
    setHint(h.col);
    tips.show({ key: HINT, text: h.text });
  }

  async function takeBack() {
    setHint(null);
    tips.dismiss();
    const seen = s.moves;
    await play.move((st, g) => {
      const family = DISCS.find((d) => g.seats[d] !== 'computer');
      if (!family || g.status !== 'active') return null;
      // Back to the family's last turn, taking the computer's reply away too, on the board take back was pressed on.
      const back = takeBackTo(st.moves, seen, family);
      return back ? { state: { ...st, moves: back, turn: family } } : null;
    });
  }

  async function stop() {
    if (!(await confirmFirst('Stop this game?', 'Stop the game'))) return;
    play.move((st, g) => (g.status === 'active' ? { state: { ...st, ended: 'stopped' }, status: 'finished', summary: 'The Four in a Row game was stopped' } : null));
  }

  async function join(seat: Disc) {
    try {
      await joinSeat(game.id, seat);
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  // The same players again, swapping who goes first.
  const swapped: Record<Disc, Holder> = { red: game.seats.yellow, yellow: game.seats.red };
  async function playAgain() {
    setAgain(true);
    try {
      const state = opening(swapped, coop ? (s.level ?? levelFor[band]) : undefined);
      await startGame(game, TYPE, { mode: game.mode, seats: swapped, state: { ...state, band }, ...(game.title ? { title: game.title } : {}) });
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setAgain(false);
    }
  }

  let status: string;
  if (done) status = game.summary || 'Finished';
  else if (thinking || (turnWho === 'computer' && !preview)) status = 'The computer is thinking…';
  else if (preview) status = '';
  else if (turnWho === 'open') status = `Waiting for someone to play ${s.turn}`;
  else if (turnWho === 'team') status = "The family's turn";
  else if (myTurn) status = 'Your turn';
  else if (typeof turnWho === 'number' && people.has(turnWho)) status = `${nameOf(people, turnWho)}'s turn`;
  else status = `${capital(s.turn)} to play`;

  const lastBy = s.moves.length ? game.seats[discOfMove(s.moves.length - 1)] : undefined;
  const caption =
    !done && !preview && s.moves.length && lastBy !== me.id ? `${nameOf(people, lastBy)} dropped a counter in column ${s.moves[s.moves.length - 1] + 1}.` : null;

  let result = '';
  if (done) {
    const who = win ? game.seats[win.winner] : undefined;
    if (s.ended === 'stopped' || !over) result = 'The game was stopped';
    else if (over.kind === 'full') result = "It's a draw!";
    else if (who === me.id) result = 'You won! 🎉';
    else if (who === 'team') result = 'The family won! 🎉';
    else if (who === 'computer') result = 'The computer won this time';
    else result = `${nameOf(people, who)} won! 🎉`;
  }

  function label(col: number): string {
    const left = ROWS - height(grid, col);
    const stack = grid[col].filter((d): d is Disc => !!d);
    const parts = [`Column ${col + 1}, ${left === 0 ? 'full' : `${left} ${left === 1 ? 'space' : 'spaces'} left`}`];
    if (stack.length) parts.push(`From the bottom: ${stack.join(', ')}`);
    if (stars.includes(col)) parts.push('You could make four here');
    if (warnings.includes(col)) parts.push('They could make four here');
    if (hint === col) parts.push('The hint is this column');
    if (win?.cells.some(([c]) => c === col)) parts.push('Part of the four in a row');
    return parts.join('. ');
  }

  const player = (disc: Disc) => {
    const who = game.seats[disc];
    return (
      <div className="chess-player fiar-player" data-turn={(!done && s.turn === disc) || undefined}>
        <span className="fiar-disc fiar-chip" data-disc={disc} aria-hidden="true" />
        {typeof who === 'number' ? (
          <Avatar person={people.get(who)} size="xs" />
        ) : (
          <span aria-hidden="true">{who === 'computer' ? '🤖' : who === 'team' ? '👨‍👩‍👧' : '❔'}</span>
        )}
        <span>
          {who === 'computer' ? `Computer (${levels[s.level ?? 2]})` : who === 'open' ? 'Open place' : nameOf(people, who, me.id)}
          <span className="fiar-colour"> · {disc}</span>
        </span>
        {who === 'open' && !done && me.permissions.play_games && !Object.values(game.seats).includes(me.id) && (
          <Button size="sm" variant="primary" onClick={() => join(disc)}>
            Play as {disc}
          </Button>
        )}
      </div>
    );
  };

  const winning = new Set(win?.cells.map(([c, r]) => c * ROWS + r));
  const ends = win && [win.cells[0], win.cells[win.cells.length - 1]];

  return (
    <div className="fiar">
      <p className="game-status" aria-live="polite">
        {status}
      </p>
      <div className="fiar-players">
        {player('red')}
        {player('yellow')}
      </div>
      <p className="muted center fiar-last" aria-live="polite">
        {caption}
      </p>

      <div className="fiar-board" data-won={!!win || undefined}>
        <div className="fiar-markers" aria-hidden="true">
          {COLUMNS.map((c) => {
            const kind = stars.includes(c) ? 'star' : warnings.includes(c) ? 'warn' : hint === c ? 'hint' : undefined;
            return (
              <span key={c} className="fiar-marker" data-kind={kind}>
                {kind === 'star' ? '⭐' : kind === 'warn' ? '⚠️' : kind === 'hint' ? '✨' : ''}
              </span>
            );
          })}
        </div>
        <div className="fiar-frame">
          <div className="fiar-grid" role="toolbar" aria-orientation="horizontal" aria-label="Four in a Row board. Choose a column to drop a counter in.">
            {COLUMNS.map((c) => {
              const free = canDrop(grid, c);
              const playable = canPlay && free;
              const landing = free ? height(grid, c) : -1;
              return (
                <button
                  key={c}
                  ref={(el) => {
                    buttons.current[c] = el;
                  }}
                  type="button"
                  className="fiar-col"
                  tabIndex={c === focus ? 0 : -1}
                  aria-label={label(c)}
                  aria-disabled={!playable || undefined}
                  data-can={playable || undefined}
                  data-hint={hint === c || undefined}
                  onFocus={() => setFocus(c)}
                  onKeyDown={(e) => onKey(e, c)}
                  onClick={() => {
                    setFocus(c);
                    drop(c);
                  }}
                >
                  {ROWS_DOWN.map((r) => {
                    const disc = grid[c][r];
                    const i = order[c][r];
                    return (
                      <span key={r} className="fiar-cell">
                        {disc ? (
                          <span className="fiar-drop" data-still={i < still.current || undefined} style={{ '--fall': ROWS - r } as CSSProperties}>
                            <span
                              className="fiar-disc"
                              data-disc={disc}
                              data-win={winning.has(c * ROWS + r) || undefined}
                              data-last={(!done && i === moves.length - 1) || undefined}
                            />
                          </span>
                        ) : (
                          playable && r === landing && <span className="fiar-disc fiar-ghost" data-disc={s.turn} />
                        )}
                      </span>
                    );
                  })}
                </button>
              );
            })}
            <span className="fiar-front" aria-hidden="true" />
            {ends && (
              <svg className="fiar-line" viewBox={`0 0 ${COLS} ${ROWS}`} aria-hidden="true">
                {['fiar-line-edge', 'fiar-line-mark'].map((k) => (
                  <line key={k} className={k} x1={ends[0][0] + 0.5} y1={ROWS - 0.5 - ends[0][1]} x2={ends[1][0] + 0.5} y2={ROWS - 0.5 - ends[1][1]} pathLength={1} />
                ))}
              </svg>
            )}
          </div>
        </div>
      </div>

      {(stars.length > 0 || warnings.length > 0) && (
        <p className="fiar-legend">
          {stars.length > 0 && (
            <span>
              <span aria-hidden="true">⭐</span> You could make four there
            </span>
          )}
          {warnings.length > 0 && (
            <span>
              <span aria-hidden="true">⚠️</span> They could make four there
            </span>
          )}
        </p>
      )}
      <TipNote tip={tips.tip} onClose={tips.dismiss} />

      {done ? (
        <div className="result sheet">
          <p className="result-big">{result}</p>
          {win && <p className="muted">Four in a line, {DIRECTION_WORDS[win.direction]}.</p>}
          {over?.kind === 'full' && <p className="muted">The frame filled up and nobody made four.</p>}
          {me.permissions.start_games && (
            <>
              <Button variant="primary" icon="refresh" busy={again} onClick={playAgain}>
                Play again
              </Button>
              <p className="muted fiar-next">
                {swapped.red === 'computer'
                  ? 'The computer goes first next time.'
                  : swapped.red === 'open'
                    ? 'Whoever joins goes first next time.'
                    : `${nameOf(people, swapped.red, me.id)} ${swapped.red === me.id ? 'go' : 'goes'} first next time.`}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="row row-wrap game-actions">
          {hints && (
            <Button size="sm" icon="sparkle" onClick={giveHint} disabled={!canPlay}>
              Hint
            </Button>
          )}
          {coop && mySeat && humanMoves > 0 && (
            <Button size="sm" icon="undo" onClick={takeBack} disabled={play.busy || thinking || !!preview}>
              Take back
            </Button>
          )}
          {/* The server takes a move only from whoever's turn it is; the bin above the board removes a game at any time. */}
          {myTurn && (
            <Button size="sm" variant="ghost" onClick={stop} disabled={play.busy || !!preview}>
              Stop the game
            </Button>
          )}
        </div>
      )}
      {openSeat && !done && turnWho !== 'open' && <p className="muted center">{capital(openSeat)} is free for anyone in the chat to join.</p>}
    </div>
  );
}

// Who plays is chosen first, in New game.
function Options({ value, onChange, mode, people }: OptionsProps<Options>) {
  const coop = mode === 'coop';
  const team = coop && value.who === 'team';
  const opponent = typeof value.opponent === 'number' ? people.get(value.opponent)?.name : undefined;
  return (
    <>
      <div className="field">
        <span className="field-label">Who goes first</span>
        <Segmented
          label="Who goes first"
          value={value.first}
          onChange={(first) => onChange({ ...value, first })}
          options={[
            { value: 'me', label: team ? 'The family goes first' : 'You go first' },
            { value: 'them', label: coop ? 'The computer goes first' : opponent ? `${opponent} goes first` : 'They go first' },
            { value: 'random', label: 'Surprise me' },
          ]}
        />
        <p className="field-hint">Whoever goes first plays red. Play again swaps over.</p>
      </div>
    </>
  );
}

export const fourInARow: GameDef<State, Options> = {
  type: TYPE,
  name: 'Four in a Row',
  emoji: '🔴',
  blurb: 'Drop your counters in turn and be the first to get four in a line. Play the computer on your own or as a family, or play each other.',
  modes: ['coop', 'versus'],
  modeLabels: { coop: 'Against the computer', versus: 'Against each other' },
  modeIcons: { coop: 'robot' },
  players: 'The family or one player against the computer, or 2 players',
  against: 'the computer',
  most: 2,
  defaults: ({ me, room }) => ({ who: 'team', opponent: defaultPlayers(room, me)[0] ?? 'open', first: 'me' }),
  ready: () => true,
  Options,
  create: (o, { me, mode, band }) => {
    const meFirst = o.first === 'random' ? Math.random() < 0.5 : o.first === 'me';
    if (mode === 'coop') {
      const level = levelFor[band];
      const solo = o.who === 'me';
      const human = solo ? me.id : 'team';
      const seats: Record<Disc, Holder> = meFirst ? { red: human, yellow: 'computer' } : { red: 'computer', yellow: human };
      return { mode, seats, state: opening(seats, level), title: solo ? `Four in a Row: ${me.name} vs computer` : 'Four in a Row: family vs computer' };
    }
    return { mode, seats: meFirst ? { red: me.id, yellow: o.opponent } : { red: o.opponent, yellow: me.id }, state: fresh() };
  },
  bands: {
    '5-7': 'A gentle computer that young children can beat. Stars and warning signs show where four could be made next go.',
    '8-10': 'A steady computer that always blocks a four. Ask for a hint whenever you like.',
    '11-13': 'A tricky computer that looks a few moves ahead. Hints only in learn mode.',
    '14+': 'A strong computer that looks far ahead, and no hints or tips.',
  },
  basics: fourBasics,
  Board,
  guide: fourGuide,
  status: (g, me, people) => {
    if (g.status === 'finished') return g.summary || 'Finished';
    const who = g.seats[g.state.turn];
    if (who === 'open') return 'Waiting for a second player';
    if (who === 'team') return "The family's turn";
    if (who === 'computer') return 'The computer is thinking';
    if (who === me) return 'Your turn';
    if (typeof who === 'number' && people.has(who)) return `${nameOf(people, who)}'s turn`;
    return `${capital(g.state.turn)} to play`;
  },
};
