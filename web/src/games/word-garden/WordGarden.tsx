import { useState, type FormEvent } from 'react';
import { Avatar, Button, Field, Input, Segmented, Select } from '../../components/ui';
import { canSpeak, speak } from '../../lib/speech';
import type { Game } from '../../lib/types';
import type { GameDef, GameProps, OptionsProps, PlayerSeat, Update } from '../common';
import { listNames, nameOf, nextSeat, pick, playerSeats, seatOf, seatOrder, startGame } from '../common';
import { JoinBanner, PlayerPicker, SeatList, Standings, defaultPlayers, winnerText } from './Players';
import {
  BONUS,
  chooseWords,
  currentWord,
  flowers,
  guessLetter,
  isOver,
  missesOf,
  newVersus,
  normalise,
  solveWord,
  standings,
  versusSummary,
  winners,
  type Turn,
  type VersusState,
} from './versus';
import { categories, wordsFor, type Length } from './words';

interface CoopState {
  turn: 'anyone';
  word: string;
  emoji: string;
  category: string;
  guessed: string[];
  by: Record<string, number>;
  lives: number;
  length: Length;
  pick: string;
}

type State = CoopState | VersusState;

interface Options {
  mode: 'coop' | 'versus';
  category: string;
  length: Length;
  players: PlayerSeat[];
  /** Words each player opens in versus. */
  rounds: number;
}

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const LIVES = 7;
const FLOWERS = ['🌷', '🌻', '🌼', '🌸', '🌺'];

function solved(s: CoopState) {
  return [...s.word].every((ch) => s.guessed.includes(ch));
}

function misses(s: CoopState) {
  return s.guessed.filter((ch) => !s.word.includes(ch)).length;
}

function newState(o: { category: string; length: Length }, avoid?: string): CoopState {
  const words = wordsFor(o.category, o.length).filter((w) => w.word !== avoid);
  const w = pick(words.length ? words : wordsFor('mixed', 'any'));
  return {
    turn: 'anyone',
    word: w.word,
    emoji: w.emoji,
    category: w.category,
    guessed: [],
    by: {},
    lives: LIVES,
    length: o.length,
    pick: o.category,
  };
}

function Board(props: GameProps<State>) {
  return props.game.mode === 'versus' ? (
    <VersusBoard {...(props as unknown as GameProps<VersusState>)} />
  ) : (
    <CoopBoard {...(props as unknown as GameProps<CoopState>)} />
  );
}

function Sky({ lives, missed }: { lives: number; missed: number }) {
  return (
    <div className="wg-sky" role="img" aria-label={`${lives - missed} suns left out of ${lives}`}>
      {Array.from({ length: lives }, (_, i) => (
        <span key={i} className="wg-sun" data-cloudy={i >= lives - missed || undefined} aria-hidden="true">
          {i >= lives - missed ? '☁️' : '☀️'}
        </span>
      ))}
    </div>
  );
}

function Hint({ category, length, emoji, showArt }: { category: string; length: number; emoji: string; showArt: boolean }) {
  const cat = categories[category];
  return (
    <div className="wg-hint sheet">
      <span className="wg-hint-art" aria-hidden="true">
        {showArt ? emoji : '❔'}
      </span>
      <span>
        <strong>{cat?.hint ?? 'A word'}</strong>
        <span className="muted"> · {length} letters</span>
      </span>
      {canSpeak && (
        <Button size="sm" variant="ghost" icon="speaker" onClick={() => speak(`${cat?.hint ?? 'A word'} with ${length} letters`)}>
          Hear it
        </Button>
      )}
    </div>
  );
}

function Keyboard({ word, guessed, enabled, onKey }: { word: string; guessed: string[]; enabled: boolean; onKey: (ch: string) => void }) {
  return (
    <div className="keyboard" role="group" aria-label="Letters">
      {ROWS.map((row) => (
        <div key={row} className="keyboard-row">
          {[...row].map((ch) => {
            const used = guessed.includes(ch);
            const good = used && word.includes(ch);
            return (
              <button
                key={ch}
                type="button"
                className="key"
                data-state={used ? (good ? 'good' : 'miss') : undefined}
                disabled={!enabled || used}
                onClick={() => onKey(ch)}
                aria-label={`${ch.toUpperCase()}${used ? (good ? ', found' : ', not in the word') : ''}`}
              >
                {ch.toUpperCase()}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function CoopBoard({ game, play, me, people }: GameProps<CoopState>) {
  const s = game.state;
  const done = game.status === 'finished';
  const won = solved(s);
  const missed = misses(s);
  const canPlay = me.permissions.play_games && !done;
  const [again, setAgain] = useState(false);

  function guess(letter: string) {
    play.move((st) => {
      if (st.guessed.includes(letter) || solved(st) || misses(st) >= st.lives) return null;
      const next = { ...st, guessed: [...st.guessed, letter], by: { ...st.by, [letter]: me.id } };
      if (solved(next)) {
        const helpers = [...new Set(Object.values(next.by))].map((id) => nameOf(people, id));
        return { state: next, status: 'finished', summary: `${listNames(helpers)} grew ${next.word.toUpperCase()} ${next.emoji}` };
      }
      if (misses(next) >= next.lives) {
        return { state: next, status: 'finished', summary: `The garden rested. The word was ${next.word.toUpperCase()} ${next.emoji}` };
      }
      return { state: next };
    });
  }

  return (
    <div className="wg">
      <Sky lives={s.lives} missed={missed} />
      <Hint category={s.category} length={s.word.length} emoji={s.emoji} showArt={done || s.word.length <= 4 || s.guessed.length >= 2} />

      <div className="wg-word" aria-live="polite">
        {[...s.word].map((ch, i) => {
          const shown = s.guessed.includes(ch) || done;
          const finder = s.by[ch];
          return (
            <span key={i} className="wg-plot" data-open={shown || undefined} data-missed={(done && !s.guessed.includes(ch)) || undefined}>
              <span className="wg-flower" aria-hidden="true">
                {shown && s.guessed.includes(ch) ? FLOWERS[i % 5] : done ? '🌱' : ''}
              </span>
              <span className="wg-letter">{shown ? ch.toUpperCase() : <span className="sr-only">blank</span>}</span>
              {finder && shown && <span className={`wg-by ink-${people.get(finder)?.colour ?? 'slate'}`}>{nameOf(people, finder, me.id)}</span>}
            </span>
          );
        })}
      </div>

      {done ? (
        <div className="result sheet">
          <p className="result-big">{won ? `You grew ${s.word.toUpperCase()} together! ${s.emoji}` : `The word was ${s.word.toUpperCase()} ${s.emoji}`}</p>
          <p className="muted">{won ? 'Every letter found is a flower in the garden.' : 'The garden needs a rest. Try another word?'}</p>
          {me.permissions.start_games && (
            <Button
              variant="primary"
              icon="flower"
              busy={again}
              onClick={async () => {
                setAgain(true);
                try {
                  await startGame(game.room_id, 'word_garden', {
                    mode: 'coop',
                    seats: {},
                    state: newState({ category: s.pick, length: s.length }, s.word),
                  });
                } finally {
                  setAgain(false);
                }
              }}
            >
              Grow another word
            </Button>
          )}
        </div>
      ) : (
        <Keyboard word={s.word} guessed={s.guessed} enabled={canPlay && !play.busy} onKey={guess} />
      )}
    </div>
  );
}

/** "Dad found E ×2", "You tried T, not there", and so on. */
function describe(t: Turn, who: string): string {
  switch (t.k) {
    case 'hit': {
      const n = t.p - (t.b ?? 0);
      return `${who} found ${t.l!.toUpperCase()}${n > 1 ? ` ×${n}` : ''}${t.b ? ' and finished the word' : ''}`;
    }
    case 'miss':
      return `${who} tried ${t.l!.toUpperCase()}, not there`;
    case 'solve':
      return `${who} guessed the word: ${t.g!.toUpperCase()}`;
    case 'wrong':
      return `${who} guessed ${t.g!.toUpperCase()}, not it`;
  }
}

function versusEnd(next: VersusState, g: Game<VersusState>, people: GameProps<VersusState>['people']): Update<VersusState> {
  if (!isOver(next)) return { state: next };
  return { state: next, status: 'finished', summary: versusSummary(next, seatOrder(g.seats), (k) => nameOf(people, g.seats[k])) };
}

function VersusBoard({ game, play, me, people }: GameProps<VersusState>) {
  const s = game.state;
  const order = seatOrder(game.seats);
  const mine = seatOf(game.seats, me.id);
  const over = game.status === 'finished' || isOver(s);
  const myTurn = !over && !!mine && s.turn === mine && me.permissions.play_games;
  const waiting = !over && game.seats[s.turn] === 'open';
  const word = currentWord(s);
  const now = s.words[s.at];
  const missed = missesOf(s);
  const [solving, setSolving] = useState(false);
  const [attempt, setAttempt] = useState('');
  const [again, setAgain] = useState(false);
  const who = (seat: string) => nameOf(people, game.seats[seat], me.id);
  const last = s.log[s.log.length - 1];
  const fresh = !over && s.guessed.length === 0 && s.wrong.length === 0;
  const previous = s.played[s.played.length - 1];

  function guess(letter: string) {
    play.move((st, g) => {
      const seat = seatOf(g.seats, me.id);
      const next = seat ? guessLetter(st, seatOrder(g.seats), seat, letter) : null;
      return next ? versusEnd(next, g, people) : null;
    });
  }

  function solve(e: FormEvent) {
    e.preventDefault();
    const g0 = normalise(attempt);
    if (g0.length !== word.length) return;
    play
      .move((st, g) => {
        const seat = seatOf(g.seats, me.id);
        const next = seat ? solveWord(st, seatOrder(g.seats), seat, g0) : null;
        return next ? versusEnd(next, g, people) : null;
      })
      .then((ok) => {
        if (ok) {
          setSolving(false);
          setAttempt('');
        }
      });
  }

  async function playAgain() {
    setAgain(true);
    try {
      // The next game opens with the next player.
      const players = order.map((k) => game.seats[k]).filter((p): p is number => typeof p === 'number');
      const turned = [...players.slice(1), ...players.slice(0, 1)];
      const seats = playerSeats(turned);
      const words = chooseWords(s.pick, s.length, s.words.length);
      await startGame(game.room_id, 'word_garden', { mode: 'versus', seats, state: newVersus(words, seatOrder(seats), { length: s.length, pick: s.pick }) });
    } finally {
      setAgain(false);
    }
  }

  let status: string;
  if (over) status = winnerText(winners(s, order), game, me, people);
  else if (waiting) status = 'Waiting for someone to join';
  else if (myTurn) status = last && last.s === mine && last.k === 'hit' && last.w === s.at ? 'Right! Pick another letter' : 'Your turn: pick a letter';
  else if (mine && nextSeat(order, s.turn) === mine) status = `${who(s.turn)}'s turn. You're next`;
  else status = `${who(s.turn)}'s turn`;

  const hidden = [...word].filter((ch) => !s.guessed.includes(ch)).length;
  const tried = s.wrong.includes(normalise(attempt));

  return (
    <div className="wg wg-vs">
      <SeatList
        game={game}
        me={me}
        people={people}
        turn={over ? undefined : s.turn}
        detail={(seat) => (
          <span className="vs-score" aria-label={flowers(s.scores[seat] ?? 0)}>
            🌼 {s.scores[seat] ?? 0}
          </span>
        )}
      />
      <p className="game-status" aria-live="polite">
        {status}
      </p>
      <JoinBanner game={game} me={me} />

      {over ? (
        <div className="result sheet wg-result">
          <Standings
            game={game}
            me={me}
            people={people}
            rows={standings(s, order).map((r) => ({ seat: r.seat, place: r.place, main: `🌼 ${r.flowers}` }))}
          />
          <ul className="wg-played" aria-label="The words">
            {s.played.map((p, i) => (
              <li key={i}>
                <span aria-hidden="true">{p.emoji}</span> <strong>{p.word.toUpperCase()}</strong>{' '}
                <span className="muted">{p.by ? `· ${who(p.by)}` : '· the suns ran out'}</span>
              </li>
            ))}
          </ul>
          {me.permissions.start_games && (
            <Button variant="primary" icon="flower" busy={again} onClick={playAgain}>
              Play again
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="wg-round">
            <span className="wg-trail" aria-hidden="true">
              {s.words.map((w, i) => (
                <span key={i} className="wg-trail-dot" data-state={i < s.at ? 'done' : i === s.at ? 'now' : undefined}>
                  {i < s.at ? w.emoji : ''}
                </span>
              ))}
            </span>
            <span className="muted">
              Word {s.at + 1} of {s.words.length}
            </span>
          </div>

          {fresh && previous && (
            <p className="wg-last sheet">
              <span className="wg-last-art" aria-hidden="true">
                {previous.emoji}
              </span>
              <span>
                The last word was <strong>{previous.word.toUpperCase()}</strong>.{' '}
                {previous.by ? `${who(previous.by)} finished it for ${BONUS} bonus flowers.` : 'The suns ran out before anyone found it.'}
              </span>
            </p>
          )}

          <Sky lives={s.lives} missed={missed} />
          {/* The picture would give the word away, so it only helps once half the letters are found. */}
          <Hint category={now.category} length={word.length} emoji={now.emoji} showArt={[...word].filter((ch) => s.guessed.includes(ch)).length * 2 >= word.length} />

          <div className="wg-word" aria-live="polite">
            {[...word].map((ch, i) => {
              const shown = s.guessed.includes(ch);
              const finder = s.by[ch];
              const person = finder ? people.get(game.seats[finder] as number) : undefined;
              return (
                <span key={i} className="wg-plot" data-open={shown || undefined}>
                  <span className="wg-flower" aria-hidden="true">
                    {shown ? FLOWERS[i % 5] : ''}
                  </span>
                  <span className="wg-letter">{shown ? ch.toUpperCase() : <span className="sr-only">blank</span>}</span>
                  {finder && shown && <span className={`wg-by ink-${person?.colour ?? 'slate'}`}>{who(finder)}</span>}
                </span>
              );
            })}
          </div>

          {s.log.length > 0 && (
            <ul className="wg-news" aria-label="Latest goes">
              {s.log.slice(-3).map((t, i, list) => {
                const person = people.get(game.seats[t.s] as number);
                return (
                  <li key={s.log.length - list.length + i} data-latest={i === list.length - 1 || undefined}>
                    <Avatar person={person} size="xs" />
                    <span>{describe(t, who(t.s))}</span>
                    {t.p > 0 && <span className="vs-plus">+{t.p} 🌼</span>}
                  </li>
                );
              })}
            </ul>
          )}

          {solving && myTurn ? (
            <form className="wg-solve sheet" onSubmit={solve}>
              <Field
                label="What's the word?"
                hint={`Right: ${flowers(hidden + BONUS)} for you. Wrong: a sun goes behind a cloud and your turn ends.`}
                error={tried ? 'Someone already tried that word.' : null}
              >
                {(p) => (
                  <Input
                    {...p}
                    autoFocus
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="input wg-solve-input"
                    value={attempt}
                    maxLength={word.length}
                    placeholder={`${word.length} letters`}
                    onChange={(e) => setAttempt(e.target.value.replace(/[^a-zA-Z]/g, ''))}
                  />
                )}
              </Field>
              <div className="row row-end">
                <Button variant="ghost" onClick={() => setSolving(false)}>
                  Not yet
                </Button>
                <Button type="submit" variant="primary" icon="sparkle" busy={play.busy} disabled={normalise(attempt).length !== word.length || tried}>
                  That's my guess
                </Button>
              </div>
            </form>
          ) : (
            <>
              <Keyboard word={word} guessed={s.guessed} enabled={myTurn && !play.busy} onKey={guess} />
              {myTurn && (
                <Button variant="secondary" icon="sparkle" onClick={() => setSolving(true)}>
                  I know the word!
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Options({ value, onChange, mode, room, me, people }: OptionsProps<Options>) {
  return (
    <>
      {mode === 'versus' && (
        <>
          <p className="vs-rules">
            Take turns guessing letters. A right letter grows a flower for you each time it's in the word, and you go again. A wrong one passes the
            turn. Finish a word for {BONUS} bonus flowers. Most flowers wins!
          </p>
          <PlayerPicker value={value.players} onChange={(players) => onChange({ ...value, players })} room={room} me={me} people={people} max={4} />
          <div className="field">
            <span className="field-label">How many words</span>
            <Segmented
              label="How many words"
              value={String(value.rounds)}
              onChange={(v) => onChange({ ...value, rounds: Number(v) })}
              options={[
                { value: '1', label: 'One each' },
                { value: '2', label: 'Two each' },
              ]}
            />
            <p className="field-hint">Everyone gets to open the same number of words.</p>
          </div>
        </>
      )}
      <Field label="Words about">
        {(p) => (
          <Select {...p} value={value.category} onChange={(e) => onChange({ ...value, category: e.target.value })}>
            <option value="mixed">A bit of everything</option>
            {Object.entries(categories).map(([k, c]) => (
              <option key={k} value={k}>
                {c.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="field">
        <span className="field-label">Word size</span>
        <Segmented
          label="Word size"
          value={value.length}
          onChange={(length) => onChange({ ...value, length })}
          options={[
            { value: 'short', label: 'Short' },
            { value: 'any', label: 'Any' },
            { value: 'long', label: 'Long' },
          ]}
        />
      </div>
    </>
  );
}

export const wordGarden: GameDef<State, Options> = {
  type: 'word_garden',
  name: 'Word Garden',
  emoji: '🌻',
  blurb: 'Find the hidden word a letter at a time. Every right letter grows a flower.',
  modes: ['coop', 'versus'],
  modeLabels: { coop: 'Together', versus: 'Against each other' },
  players: 'Any number, or 2 to 4 taking turns',
  defaults: ({ me, room, mode }) => ({ mode, category: 'mixed', length: 'short', players: defaultPlayers(room, me), rounds: 1 }),
  ready: (o) => o.mode !== 'versus' || o.players.length > 0,
  Options,
  create: (o, { me, mode }) => {
    if (mode !== 'versus') return { mode: 'coop', seats: {}, state: newState(o) };
    const seats = playerSeats([me.id, ...o.players]);
    const order = seatOrder(seats);
    const words = chooseWords(o.category, o.length, o.rounds * order.length);
    return { mode, seats, state: newVersus(words, order, { length: o.length, pick: o.category }) };
  },
  Board,
  guide: [
    {
      title: 'The aim',
      body: 'Find the hidden word one letter at a time. The clue says what kind of word it is, and the gaps show how many letters it has.',
    },
    {
      title: 'Together',
      body: 'Anyone can pick the next letter. A right letter grows a flower in every gap where it belongs. A wrong one sends a sun behind a cloud. Find the word before all seven suns are gone.',
    },
    {
      title: 'Against each other',
      body: 'Take turns picking letters for the same word. A right letter earns a flower for each gap it fills, and you go again. A wrong one clouds a sun and passes the turn. Finishing a word earns 3 bonus flowers, and the most flowers wins.',
    },
    {
      title: 'Thinking it through',
      body: [
        'Vowels (A, E, I, O and U) are in nearly every word, so they often help first.',
        'S, T, R, N and L turn up a lot too. Q, X and Z hardly ever do.',
        'Once a few letters are in, say the word out loud with gaps and think what could fit.',
      ],
    },
  ],
  status: (g, me, people) => {
    if (g.status === 'finished') return g.summary || 'Finished';
    if (g.mode === 'versus') {
      const s = g.state as VersusState;
      const order = seatOrder(g.seats);
      const turn = g.seats[s.turn];
      const scores =
        order.length === 2 && order.every((k) => typeof g.seats[k] === 'number')
          ? order.map((k) => `${nameOf(people, g.seats[k], me)} ${s.scores[k] ?? 0}`).join(', ')
          : `word ${Math.min(s.at + 1, s.words.length)} of ${s.words.length}`;
      if (turn === 'open') return `Waiting for someone to join · ${scores}`;
      return `${turn === me ? 'Your turn' : `${nameOf(people, turn)}'s turn`} · ${scores}`;
    }
    const s = g.state as CoopState;
    const found = [...new Set(s.word)].filter((ch) => s.guessed.includes(ch)).length;
    return `${found} of ${new Set(s.word).size} letters found · anyone can guess`;
  },
};
