import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { api } from '../../lib/api';
import { confirmFirst } from '../../components/confirm';
import { useStore } from '../../lib/store';
import { Avatar, Button, Field, Segmented, Select } from '../../components/ui';
import type { Game } from '../../lib/types';
import type { GameDef, GameProps, OptionsProps, Update } from '../common';
import { nameOf } from '../common';
import { chooseSequence, type Level } from './ai';
import { TipNote, useLearn, useTips } from '../learn';
import { bandOf, type Band } from '../bands';
import { backgammonBasics, backgammonGuide, endTip, pickTips, stepTips, theirTurnTip, turnTips } from './learn';
import {
  applyMove,
  canMove,
  diceFor,
  endTurn,
  initial,
  legalFirstMoves,
  pipCount,
  rollDice,
  useDie,
  winKind,
  winner,
  type Move,
  type Position,
  type Side,
} from './rules';

type Seat = 'white' | 'black';

interface Turn {
  side: Side;
  roll: [number, number];
  moves: Move[];
}

interface State {
  turn: Seat;
  pos: Position;
  roll: [number, number] | null;
  dice: number[];
  last: Turn | null;
  level?: Level;
}

interface Options {
  opponent: number | 'open';
  /** Against the computer: everyone in the chat as one team, or just the person starting it. */
  who: 'team' | 'me';
}

const seatOf = (s: Side): Seat => (s === 'w' ? 'white' : 'black');
const levels: Record<Level, string> = { 1: 'gentle', 2: 'steady', 3: 'tricky' };
/** How well the computer plays for each age band. */
const levelFor: Record<Band, Level> = { '5-7': 1, '8-10': 2, '11-13': 3, '14+': 3 };

/** Point number as the mover counts it: 1 is the last point before home. */
function pointName(i: number | 'bar' | 'off', side: Side): string {
  if (i === 'bar') return 'bar';
  if (i === 'off') return 'off';
  return String(side === 'w' ? i + 1 : 24 - i);
}

export function describe(moves: Move[], side: Side): string {
  return moves.map((m) => `${pointName(m.from, side)}/${pointName(m.to, side)}`).join(', ');
}

function finishLine(pos: Position, game: Game<State>, people: GameProps<State>['people']) {
  const w = winner(pos)!;
  const kind = winKind(pos);
  const extra = kind === 'gammon' ? ' with a gammon' : kind === 'backgammon' ? ' with a backgammon' : '';
  const who = game.seats[seatOf(w)];
  if (who === 'team') return `The family beat the computer at backgammon${extra} 🎉`;
  if (who === 'computer') return `The computer won at backgammon${extra} this time`;
  const other = game.seats[seatOf(w === 'w' ? 'b' : 'w')];
  if (other === 'computer') return `${nameOf(people, who)} beat the computer at backgammon${extra} 🎉`;
  return `${nameOf(people, who)} beat ${nameOf(people, other)} at backgammon${extra}`;
}

/** The computer takes a whole turn: roll, move, pass back. */
function computerTurn(st: State): State {
  const roll = rollDice();
  const dice = diceFor(roll);
  const moves = chooseSequence(st.pos, dice, st.level ?? 2);
  let pos = st.pos;
  for (const m of moves) pos = applyMove(pos, m);
  const last: Turn = { side: st.pos.turn, roll, moves };
  if (winner(pos)) return { ...st, pos, last, roll: null, dice: [] };
  const next = endTurn(pos);
  return { ...st, pos: next, turn: seatOf(next.turn), roll: null, dice: [], last };
}

// Board geometry, in SVG units.
const PW = 50;
const M = 16;
const BAR = 50;
const TRAY = 60;
const H = 560;
const TRI = 220;
const R = 21;
const W = M + PW * 6 + BAR + PW * 6 + 10 + TRAY + M;

function colX(col: number) {
  return col < 6 ? M + col * PW : M + PW * 6 + BAR + (col - 6) * PW;
}

/** Where a point is drawn, with `bottom` the side sitting nearest the viewer. */
function slot(i: number, bottom: Side): { top: boolean; x: number } {
  const j = bottom === 'w' ? i : 23 - i;
  return j < 12 ? { top: false, x: colX(11 - j) } : { top: true, x: colX(j - 12) };
}

function Board({ game, play, me, people }: GameProps<State>) {
  const { toast } = useStore();
  const s = game.state;
  const coop = game.mode === 'coop';
  const done = game.status === 'finished';
  const mySeat = (Object.keys(game.seats) as Seat[]).find((k) => game.seats[k] === me.id || (coop && game.seats[k] === 'team'));
  const bottom: Side = mySeat === 'black' ? 'b' : 'w';
  const myTurn = !done && me.permissions.play_games && (game.seats[s.turn] === 'team' || game.seats[s.turn] === me.id);
  const openSeat = (Object.keys(game.seats) as Seat[]).find((k) => game.seats[k] === 'open');

  // This turn's moves, made one checker at a time before they're sent.
  const [work, setWork] = useState<{ pos: Position; dice: number[]; moves: Move[] } | null>(null);
  const [from, setFrom] = useState<number | 'bar' | null>(null);
  const [thinking, setThinking] = useState(false);

  useEffect(() => {
    setWork(s.roll && myTurn ? { pos: s.pos, dice: s.dice, moves: [] } : null);
    setFrom(null);
  }, [game.version]);

  const pos = work?.pos ?? s.pos;
  const dice = work?.dice ?? s.dice;
  const choices = useMemo(() => (work && myTurn ? legalFirstMoves(work.pos, work.dice) : []), [work, myTurn]);
  const sources = new Set(choices.map((m) => m.from));
  const dests = from === null ? [] : choices.filter((m) => m.from === from);
  const turnOver = !!work && choices.length === 0;
  const band = bandOf(s);
  const learn = useLearn('backgammon');
  const tips = useTips('backgammon', { band, learn });

  // Before the roll: the race and the dice, and in learn mode what the other side just did. After it: the bar, bearing off, doubles.
  useEffect(() => {
    if (done) return void tips.offer(endTip(s.pos));
    if (!myTurn || openSeat) return;
    const last = s.last;
    const who = last ? game.seats[seatOf(last.side)] : undefined;
    const theirs =
      learn && last && !s.roll && last.side !== s.pos.turn
        ? theirTurnTip(last.roll, last.moves.length, s.pos.bar[s.pos.turn] > 0, who === 'computer' ? 'The computer' : nameOf(people, who), String(game.version))
        : null;
    tips.offer(theirs, ...turnTips(s.pos, s.dice, !!s.roll));
  }, [game.version, myTurn, done, learn]);

  async function roll() {
    setThinking(coop);
    await play.move((st, g) => {
      if (st.roll) return null;
      const r = rollDice();
      const d = diceFor(r);
      if (canMove(st.pos, d)) return { state: { ...st, roll: r, dice: d } };
      // Nothing can move: the turn passes straight on.
      const passed = endTurn(st.pos);
      let next: State = { ...st, pos: passed, turn: seatOf(passed.turn), roll: null, dice: [], last: { side: st.pos.turn, roll: r, moves: [] } };
      if (coop && g.seats[next.turn] === 'computer') next = computerTurn(next);
      if (winner(next.pos)) return { state: next, status: 'finished', summary: finishLine(next.pos, g, people) };
      return { state: next };
    });
    setThinking(false);
  }

  function step(m: Move) {
    if (!work) return;
    const next = { pos: applyMove(work.pos, m), dice: useDie(work.dice, m), moves: [...work.moves, m] };
    setWork(next);
    setFrom(null);
    if (!tips.offer(...stepTips(work.pos, m, next.pos, next.dice)) && tips.tip?.key.startsWith('pick:')) tips.dismiss();
  }

  function pick(point: number | 'bar') {
    if (!myTurn || !work) return;
    if (from !== null) {
      const d = dests.filter((m) => m.to === point);
      if (d.length) return step(d.reduce((a, b) => (a.die <= b.die ? a : b)));
    }
    const picked = sources.has(point) && from !== point ? point : null;
    setFrom(picked);
    if (picked !== null) tips.offer(...pickTips(work.pos, choices.filter((m) => m.from === picked)));
  }

  function bearOff() {
    const d = dests.filter((m) => m.to === 'off');
    if (d.length) step(d.reduce((a, b) => (a.die <= b.die ? a : b)));
  }

  async function finishTurn() {
    if (!work) return;
    const moves = work.moves;
    tips.dismiss();
    setThinking(coop);
    await new Promise((r) => setTimeout(r, 40));
    const ok = await play.move((st, g): Update<State> | null => {
      if (!st.roll) return null;
      // Check the moves are a whole, allowed turn from the saved position.
      if (!replayOk(st, moves)) return null;
      let p = st.pos;
      for (const m of moves) p = applyMove(p, m);
      const mine: Turn = { side: st.pos.turn, roll: st.roll, moves };
      if (winner(p)) return { state: { ...st, pos: p, roll: null, dice: [], last: mine }, status: 'finished', summary: finishLine(p, g, people) };
      const passed = endTurn(p);
      let next: State = { ...st, pos: passed, turn: seatOf(passed.turn), roll: null, dice: [], last: mine };
      if (coop && g.seats[next.turn] === 'computer') {
        next = computerTurn(next);
        if (winner(next.pos)) return { state: next, status: 'finished', summary: finishLine(next.pos, g, people) };
      }
      return { state: next };
    });
    setThinking(false);
    if (!ok) toast("That turn couldn't be saved. Have another go.", 'info');
  }

  async function join(seat: Seat) {
    try {
      await api.post(`/api/games/${game.id}/join`, { seat });
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  const status = done
    ? game.summary
    : thinking
      ? 'The computer is thinking…'
      : openSeat
        ? `Waiting for someone to play ${openSeat}`
        : myTurn
          ? !s.roll
            ? `${game.seats[s.turn] === 'team' ? "The family's" : 'Your'} turn. Roll the dice!`
            : turnOver
              ? 'All done? Press Done to finish the turn.'
              : from !== null
                ? 'Now tap where it goes.'
                : 'Tap a checker to move it.'
          : `${nameOf(people, game.seats[s.turn])} to play`;

  const onKey = (e: KeyboardEvent, fn: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };

  const destPoints = new Set(dests.map((m) => m.to));
  const lastWho = s.last ? game.seats[seatOf(s.last.side)] : undefined;

  const player = (seat: Seat) => {
    const who = game.seats[seat];
    const side: Side = seat === 'white' ? 'w' : 'b';
    return (
      <div className="chess-player" data-turn={(!done && s.turn === seat) || undefined}>
        <span className={`bg-chip bg-chip-${side}`} aria-hidden="true" />
        {typeof who === 'number' ? <Avatar person={people.get(who)} size="xs" /> : null}
        <span>
          {who === 'computer' ? `Computer (${levels[s.level ?? 2]})` : who === 'team' ? 'The family' : nameOf(people, who, me.id)} · {pipCount(pos, side)} pips
          {pos.off[side] > 0 ? ` · ${pos.off[side]} home` : ''}
        </span>
        {who === 'open' && !done && me.permissions.play_games && !Object.values(game.seats).includes(me.id) && (
          <Button size="sm" variant="primary" onClick={() => join(seat)}>
            Play as {seat}
          </Button>
        )}
      </div>
    );
  };

  const topSeat: Seat = bottom === 'w' ? 'black' : 'white';

  return (
    <div className="bg">
      <p className="game-status" aria-live="polite">
        {status}
      </p>
      {s.last && !done && (
        <p className="muted center bg-last">
          {nameOf(people, lastWho, me.id)} rolled {s.last.roll[0]} and {s.last.roll[1]}
          {s.last.moves.length ? ` and moved ${describe(s.last.moves, s.last.side)}` : " but couldn't move"}.
        </p>
      )}
      {player(topSeat)}
      <svg className="bg-board" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Backgammon board">
        <rect className="bg-frame" x="0" y="0" width={W} height={H} rx="18" />
        <rect className="bg-felt" x={M} y={M} width={PW * 6} height={H - 2 * M} rx="4" />
        <rect className="bg-felt" x={M + PW * 6 + BAR} y={M} width={PW * 6} height={H - 2 * M} rx="4" />
        <rect className="bg-bar" x={M + PW * 6} y={M} width={BAR} height={H - 2 * M} />
        <rect className="bg-tray" x={W - M - TRAY} y={M} width={TRAY} height={H - 2 * M} rx="6" />

        {pos.points.map((n, i) => {
          const { top, x } = slot(i, bottom);
          const tipY = top ? M + TRI : H - M - TRI;
          const baseY = top ? M : H - M;
          const dark = i % 2 === 0;
          const count = Math.abs(n);
          const side: Side | null = n > 0 ? 'w' : n < 0 ? 'b' : null;
          const isDest = destPoints.has(i);
          const isSource = sources.has(i);
          const label = `Point ${pointName(i, bottom)}, ${count ? `${count} ${side === 'w' ? 'white' : 'black'}` : 'empty'}${isDest ? ', you can move here' : ''}`;
          return (
            <g
              key={i}
              className="bg-point"
              data-dest={isDest || undefined}
              data-source={(isSource && myTurn) || undefined}
              data-from={from === i || undefined}
              role="button"
              tabIndex={myTurn && (isSource || isDest) ? 0 : -1}
              aria-label={label}
              onClick={() => pick(i)}
              onKeyDown={(e) => onKey(e, () => pick(i))}
            >
              <rect x={x} y={top ? M : H - M - TRI - 20} width={PW} height={TRI + 20} fill="transparent" />
              <polygon className={dark ? 'bg-tri-dark' : 'bg-tri-light'} points={`${x + 3},${baseY} ${x + PW - 3},${baseY} ${x + PW / 2},${tipY}`} />
              {Array.from({ length: Math.min(count, 5) }, (_, k) => {
                const cy = top ? M + R + 2 + k * (2 * R) : H - M - R - 2 - k * (2 * R);
                return <circle key={k} className={`bg-checker bg-checker-${side}`} cx={x + PW / 2} cy={cy} r={R - 1} />;
              })}
              {count > 5 && (
                <text className={`bg-count bg-count-${side}`} x={x + PW / 2} y={top ? M + R + 2 + 4 * 2 * R + 6 : H - M - R - 2 - 4 * 2 * R + 6} textAnchor="middle">
                  {count}
                </text>
              )}
            </g>
          );
        })}

        {(['w', 'b'] as Side[]).map((side) => {
          const n = pos.bar[side];
          if (!n) return null;
          const nearMe = side === bottom;
          const cx = M + PW * 6 + BAR / 2;
          const isSource = sources.has('bar') && pos.turn === side;
          return (
            <g
              key={side}
              className="bg-point"
              data-source={(isSource && myTurn) || undefined}
              data-from={(from === 'bar' && pos.turn === side) || undefined}
              role="button"
              tabIndex={isSource && myTurn ? 0 : -1}
              aria-label={`${n} ${side === 'w' ? 'white' : 'black'} on the bar`}
              onClick={() => pos.turn === side && pick('bar')}
              onKeyDown={(e) => onKey(e, () => pos.turn === side && pick('bar'))}
            >
              {Array.from({ length: Math.min(n, 4) }, (_, k) => (
                <circle key={k} className={`bg-checker bg-checker-${side}`} cx={cx} cy={nearMe ? H / 2 + 40 + k * 2 * R : H / 2 - 40 - k * 2 * R} r={R - 1} />
              ))}
              {n > 4 && (
                <text className={`bg-count bg-count-${side}`} x={cx} y={nearMe ? H / 2 + 46 : H / 2 - 34} textAnchor="middle">
                  {n}
                </text>
              )}
            </g>
          );
        })}

        <g
          className="bg-point"
          data-dest={destPoints.has('off') || undefined}
          role="button"
          tabIndex={destPoints.has('off') ? 0 : -1}
          aria-label="Bear off"
          onClick={bearOff}
          onKeyDown={(e) => onKey(e, bearOff)}
        >
          <rect className="bg-tray-hit" x={W - M - TRAY} y={M} width={TRAY} height={H - 2 * M} rx="6" />
          {(['w', 'b'] as Side[]).map((side) => {
            const nearMe = side === bottom;
            return Array.from({ length: pos.off[side] }, (_, k) => (
              <rect
                key={`${side}${k}`}
                className={`bg-checker bg-checker-${side}`}
                x={W - M - TRAY + 8}
                width={TRAY - 16}
                height={10}
                rx={3}
                y={nearMe ? H - M - 14 - k * 13 : M + 4 + k * 13}
              />
            ));
          })}
        </g>

        <g className="bg-dice" transform={`translate(${bottom === 'w' ? M + PW * 6 + BAR + PW * 1.5 : M + PW * 1.5}, ${H / 2 - 24})`}>
          {s.roll &&
            shownDice(s.roll, dice).map((d, k, all) => (
              <Die key={k} value={d.value} x={k * (all.length > 2 ? 54 : 64) - (all.length > 2 ? 54 : 0)} used={d.used} />
            ))}
        </g>
      </svg>
      {player(bottom === 'w' ? 'white' : 'black')}
      <TipNote tip={tips.tip} onClose={tips.dismiss} />

      {!done && myTurn && (
        <div className="row row-wrap game-actions">
          {!s.roll ? (
            <Button variant="primary" size="lg" icon="dice" busy={play.busy || thinking} onClick={roll}>
              Roll the dice
            </Button>
          ) : (
            <>
              <Button
                icon="undo"
                disabled={!work?.moves.length}
                onClick={() => {
                  setWork({ pos: s.pos, dice: s.dice, moves: [] });
                  setFrom(null);
                }}
              >
                Start the turn again
              </Button>
              <Button variant="primary" icon="check" busy={play.busy || thinking} disabled={!turnOver} onClick={finishTurn}>
                Done
              </Button>
            </>
          )}
        </div>
      )}
      {!done && (myTurn || mySeat) && (
        <div className="row row-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (!(await confirmFirst('Stop this game?', 'Stop the game'))) return;
              play.move((st) => ({ state: st, status: 'finished', summary: 'The backgammon game was stopped' }));
            }}
          >
            Stop the game
          </Button>
        </div>
      )}
    </div>
  );
}

/** A move list is fine if each step was a legal first move at the time. */
function replayOk(st: State, moves: Move[]): boolean {
  let p = st.pos;
  let d = st.dice;
  for (const m of moves) {
    if (!legalFirstMoves(p, d).some((x) => x.from === m.from && x.to === m.to && x.die === m.die)) return false;
    p = applyMove(p, m);
    d = useDie(d, m);
  }
  return legalFirstMoves(p, d).length === 0;
}

/** The dice to show, four for a double, and which have been used. */
function shownDice(roll: [number, number], left: number[]): { value: number; used: boolean }[] {
  if (roll[0] === roll[1]) return [0, 1, 2, 3].map((k) => ({ value: roll[0], used: k < 4 - left.length }));
  return roll.map((value) => ({ value, used: !left.includes(value) }));
}

function Die({ value, x, used }: { value: number; x: number; used: boolean }) {
  const pips: Record<number, [number, number][]> = {
    1: [[24, 24]],
    2: [[14, 14], [34, 34]],
    3: [[14, 14], [24, 24], [34, 34]],
    4: [[14, 14], [34, 14], [14, 34], [34, 34]],
    5: [[14, 14], [34, 14], [24, 24], [14, 34], [34, 34]],
    6: [[14, 13], [34, 13], [14, 24], [34, 24], [14, 35], [34, 35]],
  };
  return (
    <g transform={`translate(${x}, 0)`} className="bg-die" data-used={used || undefined}>
      <rect width="48" height="48" rx="9" />
      {pips[value].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="4.2" />
      ))}
    </g>
  );
}

function Options({ value, onChange, mode, room, me, people }: OptionsProps<Options>) {
  const others = room.member_ids.filter((id) => id !== me.id && people.get(id)?.active);
  return mode === 'coop' ? (
    <>
      <div className="field">
        <span className="field-label">Who plays the computer</span>
        <Segmented
          label="Who plays the computer"
          value={value.who}
          onChange={(who) => onChange({ ...value, who })}
          options={[
            { value: 'team', label: 'Everyone in the chat', icon: 'team' },
            { value: 'me', label: 'Just me', icon: 'me' },
          ]}
        />
        <p className="field-hint">
          {value.who === 'team' ? 'The family plays white, and anyone in the chat can roll and move for the family.' : 'You play white, and the others can watch.'}
        </p>
      </div>
    </>
  ) : (
    <Field label="Playing against">
      {(p) => (
        <Select {...p} value={String(value.opponent)} onChange={(e) => onChange({ ...value, opponent: e.target.value === 'open' ? 'open' : Number(e.target.value) })}>
          <option value="open">Whoever wants to play</option>
          {others.map((id) => (
            <option key={id} value={id}>
              {people.get(id)?.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export const backgammon: GameDef<State, Options> = {
  type: 'backgammon',
  name: 'Backgammon',
  emoji: '🎲',
  blurb: 'Race your checkers home. Play the computer on your own or as a family, or play each other.',
  modes: ['coop', 'versus'],
  modeLabels: { coop: 'Against the computer', versus: 'Against each other' },
  modeIcons: { coop: 'robot' },
  players: 'The family or one player against the computer, or 2 players',
  defaults: () => ({ opponent: 'open', who: 'team' }),
  Options,
  create: (o, { me, mode, band }) =>
    mode === 'coop'
      ? {
          mode,
          seats: { white: o.who === 'me' ? me.id : 'team', black: 'computer' },
          state: { turn: 'white', pos: initial('w'), roll: null, dice: [], last: null, level: levelFor[band] },
          title: o.who === 'me' ? `Backgammon: ${me.name} vs computer` : 'Backgammon: family vs computer',
        }
      : { mode, seats: { white: me.id, black: o.opponent }, state: { turn: 'white', pos: initial('w'), roll: null, dice: [], last: null } },
  bands: {
    '5-7': 'A gentle computer that young children can beat, and tips about every move.',
    '8-10': 'A steady computer, and tips about every move.',
    '11-13': 'A tricky computer, and tips only for hitting, the bar and bearing off.',
    '14+': 'A tricky computer, and no tips.',
  },
  basics: backgammonBasics,
  Board,
  guide: backgammonGuide,
  status: (g, me, people) => {
    if (g.status === 'finished') return g.summary || 'Finished';
    const who = g.seats[g.state.turn];
    if (who === 'open') return 'Waiting for a second player';
    if (who === 'team') return "The family's turn";
    return who === me ? 'Your turn' : `${nameOf(people, who)} to play`;
  },
};
