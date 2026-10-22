import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  livesFor,
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
import type { Band } from '../bands';
import { TipNote, useLearn, useTips, type Lesson, type Tip } from '../learn';

interface CoopState {
  turn: 'anyone';
  word: string;
  emoji: string;
  category: string;
  guessed: string[];
  by: Record<string, number>;
  lives: number;
  /** Word size, in games from before age bands. */
  length?: Length;
  band?: Band;
  pick: string;
}

type State = CoopState | VersusState;

interface Options {
  mode: 'coop' | 'versus';
  category: string;
  players: PlayerSeat[];
  /** Words each player opens in versus. */
  rounds: number;
}

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const VOWELS = 'aeiou';
const FLOWERS = ['🌷', '🌻', '🌼', '🌸', '🌺'];

/**
 * When the picture clue shows: from the start for 5–7, after a couple of
 * letters for 8–10, once half the word is found for 11–13, and only at the
 * end for 14 and up.
 */
function pictureShown(band: Band, word: string, guessed: string[], done: boolean): boolean {
  if (done || band === '5-7') return true;
  const found = [...word].filter((ch) => guessed.includes(ch)).length;
  if (band === '8-10') return word.length <= 4 || guessed.length >= 2;
  if (band === '11-13') return found * 2 >= word.length;
  return false;
}

const TIPS: Record<'start' | 'miss' | 'twice' | 'nearly', Tip> = {
  start: { key: 'start', basic: true, text: 'Try a vowel first: A, E, I, O or U. Almost every word has at least one.' },
  miss: { key: 'miss', basic: true, text: "Not in this word. E, T, A, O, N, S and R are the letters used most in English, so they're good next tries." },
  twice: { key: 'twice', basic: true, text: 'That letter is in the word more than once, so it grew a flower in each gap.' },
  nearly: { key: 'nearly', text: 'Nearly there! Say the word out loud with the gaps, and think what could fit.' },
};

/** The tip for what just happened on the board, if any. */
function tipFor(word: string, guessed: string[]): Tip | null {
  if (!guessed.length) return TIPS.start;
  const latest = guessed[guessed.length - 1];
  const hidden = new Set([...word].filter((ch) => !guessed.includes(ch)));
  if (!word.includes(latest)) return TIPS.miss;
  if ([...word].filter((ch) => ch === latest).length > 1) return TIPS.twice;
  return hidden.size > 0 && hidden.size <= 2 && word.length >= 4 ? TIPS.nearly : null;
}

/** In learn mode, letters are read out as they're picked, and the word spelled out when it's found. */
function sayLetter(learn: boolean, letter: string) {
  if (learn && canSpeak) speak(letter.toUpperCase());
}

function spellOut(word: string) {
  if (canSpeak) speak(`${[...word.toUpperCase()].join(', ')}. ${word}!`);
}

function solved(s: CoopState) {
  return [...s.word].every((ch) => s.guessed.includes(ch));
}

function misses(s: CoopState) {
  return s.guessed.filter((ch) => !s.word.includes(ch)).length;
}

/** A new word to find together. For 5–7 the first letter is already in. */
function newState(o: { category: string; band?: Band; length?: Length }, avoid?: string): CoopState {
  const size = o.band ?? o.length ?? 'any';
  const words = wordsFor(o.category, size).filter((w) => w.word !== avoid);
  const w = pick(words.length ? words : wordsFor('mixed', size).filter((x) => x.word !== avoid));
  return {
    turn: 'anyone',
    word: w.word,
    emoji: w.emoji,
    category: w.category,
    guessed: o.band === '5-7' ? [w.word[0]] : [],
    by: {},
    lives: livesFor(o.band),
    ...(o.band ? { band: o.band } : { length: o.length ?? 'any' }),
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

function Keyboard({
  word,
  guessed,
  enabled,
  vowels,
  onKey,
}: {
  word: string;
  guessed: string[];
  enabled: boolean;
  /** Learn mode shades the vowels. */
  vowels: boolean;
  onKey: (ch: string) => void;
}) {
  return (
    <div className="keyboard" role="group" aria-label="Letters">
      {vowels && (
        <p className="keyboard-note muted">
          <span className="key-sample" aria-hidden="true" /> Shaded letters are vowels: A, E, I, O and U.
        </p>
      )}
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
                data-vowel={(vowels && VOWELS.includes(ch)) || undefined}
                disabled={!enabled || used}
                onClick={() => onKey(ch)}
                aria-label={`${ch.toUpperCase()}${vowels && VOWELS.includes(ch) ? ', a vowel' : ''}${used ? (good ? ', found' : ', not in the word') : ''}`}
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
  const band = s.band ?? '8-10';
  const learn = useLearn('word_garden');
  const tips = useTips('word_garden', { band, learn });
  const wasDone = useRef(done);
  // The first letter given for 5–7 isn't anyone's guess.
  const tried = s.guessed.filter((ch) => s.by[ch] !== undefined || !s.word.includes(ch));

  useEffect(() => {
    if (done) {
      tips.dismiss();
      if (learn && won && !wasDone.current) spellOut(s.word);
    } else tips.offer(tipFor(s.word, tried.length ? s.guessed : []));
    wasDone.current = done;
  }, [s.guessed.length, done]);

  function guess(letter: string) {
    sayLetter(learn, letter);
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
      <Hint category={s.category} length={s.word.length} emoji={s.emoji} showArt={pictureShown(band, s.word, s.guessed, done)} />

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
                    state: newState({ category: s.pick, band: s.band, length: s.length }, s.word),
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
        <>
          <TipNote tip={tips.tip} onClose={tips.dismiss} />
          <Keyboard word={s.word} guessed={s.guessed} enabled={canPlay && !play.busy} vowels={learn} onKey={guess} />
        </>
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
  // Games from before age bands showed the picture once half the word was found.
  const band = s.band ?? '11-13';
  const learn = useLearn('word_garden');
  const tips = useTips('word_garden', { band, learn });
  const playedBefore = useRef(s.played.length);

  useEffect(() => {
    if (!myTurn) return void tips.dismiss();
    // What someone else just tried isn't a tip for you, but how to start and how to finish are.
    const t = tipFor(word, s.guessed);
    const mineLast = last?.s === mine && last.w === s.at;
    tips.offer(mineLast || t === TIPS.start || t === TIPS.nearly ? t : null);
  }, [s.guessed.length, myTurn, s.at]);

  // In learn mode, a word that has just been found is spelled out.
  useEffect(() => {
    if (learn && s.played.length > playedBefore.current && previous?.by) spellOut(previous.word);
    playedBefore.current = s.played.length;
  }, [s.played.length]);

  function guess(letter: string) {
    sayLetter(learn, letter);
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
      const words = chooseWords(s.pick, s.band ?? s.length ?? 'any', s.words.length);
      await startGame(game.room_id, 'word_garden', {
        mode: 'versus',
        seats,
        state: newVersus(words, seatOrder(seats), { band: s.band, length: s.length, pick: s.pick }),
      });
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
          <Hint category={now.category} length={word.length} emoji={now.emoji} showArt={pictureShown(band, word, s.guessed, false)} />

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
              <TipNote tip={tips.tip} onClose={tips.dismiss} />
              <Keyboard word={word} guessed={s.guessed} enabled={myTurn && !play.busy} vowels={learn} onKey={guess} />
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
  defaults: ({ me, room, mode }) => ({ mode, category: 'mixed', players: defaultPlayers(room, me), rounds: 1 }),
  ready: (o) => o.mode !== 'versus' || o.players.length > 0,
  Options,
  create: (o, { me, mode, band }) => {
    if (mode !== 'versus') return { mode: 'coop', seats: {}, state: newState({ category: o.category, band }) };
    const seats = playerSeats([me.id, ...o.players]);
    const order = seatOrder(seats);
    const words = chooseWords(o.category, band, o.rounds * order.length);
    return { mode, seats, state: newVersus(words, order, { band, pick: o.category }) };
  },
  bands: {
    '5-7': 'Short everyday words, the picture from the start and 9 suns. Playing together, the first letter is filled in.',
    '8-10': 'Everyday words of four to six letters, the picture after a couple of letters and 8 suns.',
    '11-13': 'Longer words, some harder, the picture once half the word is found and 7 suns.',
    '14+': 'The hardest and longest words, only the clue and 6 suns.',
  },
  basics: wordGardenBasics(),
  Board,
  guide: [
    {
      title: 'The aim',
      body: 'Find the hidden word one letter at a time. The clue says what kind of word it is, and the gaps show how many letters it has.',
    },
    {
      title: 'Together',
      body: 'Anyone can pick the next letter. A right letter grows a flower in every gap where it belongs. A wrong one sends a sun behind a cloud. Find the word before all the suns are gone.',
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

function wordGardenBasics(): Lesson[] {
  return [
    { art: '🌻', title: 'Find the hidden word', text: 'Each gap is one letter of a secret word. The clue above says what kind of thing it is, and the picture helps too.' },
    { art: '🔤', title: 'Pick a letter', text: "Tap a letter. If it's in the word, it pops into every gap where it belongs and a flower grows there." },
    { art: '☁️', title: 'Watch the suns', text: "A letter that isn't in the word sends a sun behind a cloud. Find the whole word before the suns run out." },
    { art: '🅰️', title: 'Vowels first', text: "A, E, I, O and U are vowels. Almost every word has one, so they're good first tries. They're shaded on the keyboard." },
    { art: '🗣️', title: 'Sound it out', text: 'Once a few letters are in, say the word out loud with the gaps. Letters are read out as you pick them.' },
  ];
}
