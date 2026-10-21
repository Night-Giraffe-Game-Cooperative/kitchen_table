import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Avatar, Button, Field, Segmented, Select } from '../../components/ui';
import type { Game } from '../../lib/types';
import type { GameDef, GameProps, OptionsProps, Update } from '../common';
import { nameOf } from '../common';
import { chooseMove, type Level } from './ai';
import {
  START_FEN,
  captured,
  inCheck,
  kingSquare,
  makeMove,
  movesFrom,
  outcome,
  parseFen,
  san,
  squareName,
  toFen,
  type Kind,
  type Move,
  type Side,
} from './rules';
import { PieceIcon, pieceName } from './Pieces';
import { HINT, TipNote, useTips } from '../learn';
import { PROMOTE_TIP, chessGuide, endTip, explainMove, pieceTips, turnTips } from './learn';
import { confirmFirst } from '../../components/confirm';

type Seat = 'white' | 'black';

interface State {
  turn: Seat;
  fen: string;
  history: string[]; // positions before each move, for repetition and taking back
  moves: string[];
  last: [number, number] | null;
  level?: Level;
  ended?: string;
}

interface Options {
  level: Level;
  side: 'white' | 'black' | 'random';
  opponent: number | 'open';
  /** Against the computer: everyone in the chat as one team, or just the person starting it. */
  who: 'team' | 'me';
}

const seatOf = (s: Side): Seat => (s === 'w' ? 'white' : 'black');
const sideOf = (s: Seat): Side => (s === 'white' ? 'w' : 'b');
const levels: Record<Level, string> = { 1: 'Gentle', 2: 'Steady', 3: 'Tricky' };

/** Plays one move and reports whether that ended the game. */
function play(state: State, move: Move): { state: State; over: ReturnType<typeof outcome> } {
  const pos = parseFen(state.fen);
  const text = san(pos, move);
  const next = makeMove(pos, move);
  const history = [...state.history, state.fen];
  const out: State = {
    ...state,
    fen: toFen(next),
    turn: seatOf(next.turn),
    history,
    moves: [...state.moves, text],
    last: [move.from, move.to],
  };
  return { state: out, over: outcome(next, history) };
}

function describeEnd(over: NonNullable<ReturnType<typeof outcome>>, game: Game<State>, people: GameProps<State>['people']): string {
  if (over.kind === 'checkmate') {
    const who = game.seats[seatOf(over.winner)];
    if (who === 'team') return 'Checkmate! The family beat the computer at chess 🎉';
    if (who === 'computer') return 'Checkmate. The computer won this time';
    const loser = game.seats[seatOf(over.winner === 'w' ? 'b' : 'w')];
    if (loser === 'computer') return `Checkmate! ${nameOf(people, who)} beat the computer at chess 🎉`;
    return `Checkmate! ${nameOf(people, who)} beat ${nameOf(people, loser)} at chess`;
  }
  const why = { stalemate: 'stalemate', fifty: 'fifty moves without a capture', material: 'not enough pieces left to win', repetition: 'the same position three times' }[
    over.kind
  ];
  return `A draw at chess (${why})`;
}

function Board({ game, play: actions, me, people }: GameProps<State>) {
  const { toast } = useStore();
  const s = game.state;
  const pos = useMemo(() => parseFen(s.fen), [s.fen]);
  const [selected, setSelected] = useState<number | null>(null);
  const [promoting, setPromoting] = useState<Move[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<Move | null>(null);
  const [preview, setPreview] = useState<{ fen: string; last: [number, number] } | null>(null);

  const coop = game.mode === 'coop';
  const done = game.status === 'finished';
  // Against the computer, the other seat is the family's or one person's.
  const humanSeat = (Object.keys(game.seats) as Seat[]).find((k) => game.seats[k] !== 'computer');
  const mySeat = (Object.keys(game.seats) as Seat[]).find((k) => game.seats[k] === me.id || (coop && game.seats[k] === 'team'));
  const bottom: Side = mySeat ? sideOf(mySeat) : coop && humanSeat ? sideOf(humanSeat) : 'w';
  const myTurn = !done && me.permissions.play_games && (game.seats[s.turn] === 'team' || game.seats[s.turn] === me.id);
  const shownPos = preview ? parseFen(preview.fen) : pos;
  const last = preview?.last ?? s.last;
  const targets = selected !== null && myTurn && !preview ? movesFrom(pos, selected) : [];
  const check = inCheck(shownPos) ? kingSquare(shownPos, shownPos.turn) : -1;
  const lost = captured(shownPos);
  const openSeat = (Object.keys(game.seats) as Seat[]).find((k) => game.seats[k] === 'open');
  const tips = useTips('chess');

  // At the start of each turn: check, and anything unusual the other side just did.
  useEffect(() => {
    if (done) return void tips.offer(endTip(s.ended));
    if (!myTurn) return;
    const before = s.history.length ? parseFen(s.history[s.history.length - 1]) : null;
    tips.offer(...turnTips(pos, before, s.last, s.moves.length < 2));
  }, [s.fen, myTurn, done]);

  // Picking up a piece explains how it moves, and any special move it has.
  useEffect(() => {
    if (selected === null) return;
    if (!tips.offer(...pieceTips(pos, selected, targets)) && tips.tip?.key.startsWith('piece:')) tips.dismiss();
  }, [selected]);

  async function commit(move: Move) {
    setSelected(null);
    setPromoting(null);
    setHint(null);
    tips.dismiss();
    // Show the move straight away, then let the computer think.
    const mine = play(s, move);
    setPreview({ fen: mine.state.fen, last: [move.from, move.to] });
    if (coop && !mine.over) setThinking(true);
    await new Promise((r) => setTimeout(r, 60));

    const ok = await actions.move((st, g): Update<State> | null => {
      const p = parseFen(st.fen);
      if (seatOf(p.turn) !== st.turn || !movesFrom(p, move.from).some((m) => m.to === move.to && m.promotion === move.promotion)) return null;
      let step = play(st, move);
      if (step.over) return { state: { ...step.state, ended: step.over.kind }, status: 'finished', summary: describeEnd(step.over, g, people) };
      if (coop && g.seats[step.state.turn] === 'computer') {
        const reply = chooseMove(parseFen(step.state.fen), st.level ?? 2, undefined, [...step.state.history, step.state.fen]);
        if (reply) {
          step = play(step.state, reply);
          if (step.over) return { state: { ...step.state, ended: step.over.kind }, status: 'finished', summary: describeEnd(step.over, g, people) };
        }
      }
      return { state: step.state };
    });
    setThinking(false);
    setPreview(null);
    if (!ok) setSelected(null);
  }

  function tap(square: number) {
    if (!myTurn || actions.busy || preview) return;
    const piece = pos.board[square];
    if (selected !== null) {
      const options = targets.filter((m) => m.to === square);
      if (options.length > 1) {
        tips.offer(PROMOTE_TIP);
        return setPromoting(options);
      }
      if (options.length === 1) return void commit(options[0]);
    }
    if (piece && piece.side === pos.turn) setSelected(square === selected ? null : square);
    else setSelected(null);
  }

  async function takeBack() {
    await actions.move((st, g) => {
      const fam = (Object.keys(g.seats) as Seat[]).find((k) => g.seats[k] !== 'computer');
      let next = st;
      // Go back to the family's last turn, removing the computer's reply too.
      do {
        if (!next.history.length) break;
        const fen = next.history[next.history.length - 1];
        next = { ...next, fen, turn: seatOf(parseFen(fen).turn), history: next.history.slice(0, -1), moves: next.moves.slice(0, -1), last: null };
      } while (next.turn !== fam);
      return next.turn === fam && next.fen !== st.fen ? { state: next } : null;
    });
  }

  function giveHint() {
    const move = chooseMove(pos, 2, undefined, s.history);
    setHint(move);
    if (move) tips.show({ key: HINT, text: explainMove(pos, move) });
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
          ? `${game.seats[s.turn] === 'team' ? "The family's" : 'Your'} move${inCheck(pos) ? '. Check!' : ''}`
          : `${nameOf(people, game.seats[s.turn])} to move${inCheck(pos) ? '. Check!' : ''}`;

  const files = bottom === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const ranks = bottom === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  const player = (seat: Seat) => {
    const who = game.seats[seat];
    const taken = seat === 'white' ? 'b' : 'w';
    const takenNames = lost[taken].map((k) => pieceName(taken, k).replace(/^\w+ /, ''));
    return (
      <div className="chess-player" data-turn={(!done && s.turn === seat) || undefined}>
        {typeof who === 'number' ? <Avatar person={people.get(who)} size="xs" /> : <span aria-hidden="true">{who === 'computer' ? '🤖' : who === 'team' ? '👨‍👩‍👧' : '❔'}</span>}
        <span>
          {who === 'computer' ? `Computer (${levels[s.level ?? 2].toLowerCase()})` : nameOf(people, who, me.id)} · {seat}
        </span>
        <span
          className="chess-captured"
          role="img"
          aria-label={`Taken from ${taken === 'b' ? 'black' : 'white'}: ${takenNames.join(', ') || 'nothing yet'}`}
        >
          {lost[taken].map((k, i) => (
            <PieceIcon key={i} side={taken} kind={k} size="1.1rem" />
          ))}
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
    <div className="chess">
      <p className="game-status" aria-live="polite">
        {status}
      </p>
      {player(topSeat)}
      <div className="chess-board" role="grid" aria-label="Chess board">
        {ranks.map((r) => (
          <div key={r} role="row" className="chess-rank">
            {files.map((f) => {
              const sq = r * 8 + f;
              const piece = shownPos.board[sq];
              const target = targets.find((m) => m.to === sq);
              const dark = (r + f) % 2 === 1;
              return (
                <button
                  key={sq}
                  type="button"
                  role="gridcell"
                  className="chess-square"
                  data-dark={dark || undefined}
                  data-selected={selected === sq || undefined}
                  data-last={(last && (last[0] === sq || last[1] === sq)) || undefined}
                  data-target={target ? (piece ? 'capture' : 'move') : undefined}
                  data-check={check === sq || undefined}
                  data-hint={(hint && (hint.from === sq || hint.to === sq)) || undefined}
                  aria-label={`${squareName(sq)}${piece ? ', ' + pieceName(piece.side, piece.kind) : ''}${target ? ', can move here' : ''}`}
                  onClick={() => tap(sq)}
                >
                  {piece && <PieceIcon side={piece.side} kind={piece.kind} />}
                </button>
              );
            })}
          </div>
        ))}
        <div className="chess-coords" aria-hidden="true">
          {ranks.map((r, i) => (
            <span key={`r${r}`} className="coord coord-rank" style={{ gridRow: i + 1, gridColumn: 1 }}>
              {8 - r}
            </span>
          ))}
          {files.map((f, i) => (
            <span key={`f${f}`} className="coord coord-file" style={{ gridRow: 8, gridColumn: i + 1 }}>
              {'abcdefgh'[f]}
            </span>
          ))}
        </div>
        {promoting && (
          <div className="chess-promote sheet" role="dialog" aria-label="Choose a piece">
            <p>Your pawn becomes a…</p>
            <div className="row">
              {(['q', 'r', 'b', 'n'] as Kind[]).map((k) => {
                const m = promoting.find((x) => x.promotion === k);
                return (
                  m && (
                    <button key={k} type="button" className="chess-promote-option" onClick={() => commit(m)} aria-label={pieceName(pos.turn, k)}>
                      <PieceIcon side={pos.turn} kind={k} size="2.5rem" />
                    </button>
                  )
                );
              })}
            </div>
          </div>
        )}
      </div>
      {player(bottom === 'w' ? 'white' : 'black')}
      <TipNote tip={tips.tip} onClose={tips.dismiss} />

      {!done && (
        <div className="row row-wrap game-actions">
          {coop && myTurn && (
            <Button size="sm" icon="sparkle" onClick={giveHint}>
              Hint
            </Button>
          )}
          {coop && mySeat && s.history.length > 1 && !thinking && (
            <Button size="sm" icon="undo" onClick={takeBack} disabled={actions.busy}>
              Take back
            </Button>
          )}
          {(myTurn || mySeat) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!(await confirmFirst('Stop this game?', 'Stop the game'))) return;
                actions.move((st) => ({ state: { ...st, ended: 'stopped' }, status: 'finished', summary: 'The chess game was stopped' }));
              }}
            >
              Stop the game
            </Button>
          )}
        </div>
      )}
      {s.moves.length > 0 && (
        <details className="moves">
          <summary>Moves ({Math.ceil(s.moves.length / 2)})</summary>
          <ol>
            {s.moves
              .reduce<string[][]>((rows, m, i) => (i % 2 ? rows[rows.length - 1].push(m) : rows.push([m]), rows), [])
              .map((pair, i) => (
                <li key={i}>{pair.join('  ')}</li>
              ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function Options({ value, onChange, mode, room, me, people }: OptionsProps<Options>) {
  const others = room.member_ids.filter((id) => id !== me.id && people.get(id)?.active);
  return mode === 'coop' ? (
    <>
      <WhoPlays value={value} onChange={onChange} />
      <div className="field">
        <span className="field-label">The computer plays</span>
        <Segmented
          label="The computer plays"
          value={String(value.level)}
          onChange={(v) => onChange({ ...value, level: Number(v) as Level })}
          options={[
            { value: '1', label: 'Gentle' },
            { value: '2', label: 'Steady' },
            { value: '3', label: 'Tricky' },
          ]}
        />
        <p className="field-hint">
          {value.who === 'team' ? "Anyone in the chat can make the family's move." : 'Only you make the moves, and the others can watch.'} Ask for a hint or
          take a move back whenever you like.
        </p>
      </div>
      <SidePicker value={value} onChange={onChange} label={value.who === 'team' ? 'The family plays' : 'You play'} />
    </>
  ) : (
    <>
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
      <SidePicker value={value} onChange={onChange} label="You play" />
    </>
  );
}

function WhoPlays({ value, onChange }: { value: Options; onChange: (o: Options) => void }) {
  return (
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
    </div>
  );
}

function SidePicker({ value, onChange, label }: { value: Options; onChange: (o: Options) => void; label: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <Segmented
        label={label}
        value={value.side}
        onChange={(side) => onChange({ ...value, side })}
        options={[
          { value: 'white', label: 'White' },
          { value: 'black', label: 'Black' },
          { value: 'random', label: 'Surprise me' },
        ]}
      />
    </div>
  );
}

function fresh(level?: Level): State {
  return { turn: 'white', fen: START_FEN, history: [], moves: [], last: null, ...(level ? { level } : {}) };
}

export const chess: GameDef<State, Options> = {
  type: 'chess',
  name: 'Chess',
  emoji: '♟️',
  blurb: 'Play a friendly computer, on your own or as a family, or play each other. Take your time: moves wait for you.',
  modes: ['coop', 'versus'],
  modeLabels: { coop: 'Against the computer', versus: 'Against each other' },
  modeIcons: { coop: 'robot' },
  players: 'The family or one player against the computer, or 2 players',
  defaults: () => ({ level: 1, side: 'white', opponent: 'open', who: 'team' }),
  Options,
  create: (o, { me, mode }) => {
    const side: Seat = o.side === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : o.side;
    const other: Seat = side === 'white' ? 'black' : 'white';
    if (mode === 'coop') {
      let state = fresh(o.level);
      if (side === 'black') {
        // The computer has white, so it opens.
        const first = chooseMove(parseFen(START_FEN), o.level);
        if (first) state = play(state, first).state;
      }
      const solo = o.who === 'me';
      return { mode, seats: { [side]: solo ? me.id : 'team', [other]: 'computer' }, state, title: solo ? `Chess: ${me.name} vs computer` : 'Chess: family vs computer' };
    }
    return { mode, seats: { [side]: me.id, [other]: o.opponent }, state: fresh() };
  },
  Board,
  guide: chessGuide,
  status: (g, me, people) => {
    if (g.status === 'finished') return g.summary || 'Finished';
    const who = g.seats[g.state.turn];
    if (who === 'open') return 'Waiting for a second player';
    if (who === 'team') return `The family's move · ${Math.ceil((g.state.moves.length + 1) / 2)}`;
    return who === me ? 'Your move' : `${nameOf(people, who)} to move`;
  },
};

