import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Field, Segmented, TextArea } from '../../components/ui';
import { Avatar } from '../../components/ui';
import { Icon } from '../../components/icons';
import { canSpeak, speak, stopSpeaking } from '../../lib/speech';
import type { Game } from '../../lib/types';
import type { GameDef, GameProps, OptionsProps, PlayerSeat, Update } from '../common';
import { listNames, nameOf, nextSeat, pick, playerSeats, seatOf, seatOrder, startGame } from '../common';
import { JoinBanner, PlayerPicker, SeatList, Standings, defaultPlayers } from '../word-garden/Players';
import { bandOf, type Band } from '../bands';
import { HINT, TipNote, useLearn, useTips } from '../learn';
import { TIPS, helpFor, ideaFor, isStarter, lineHint, partOf, shape, startersFor, storyBasics, writingTips, type Help, type Part } from './help';
import {
  addLine,
  bestLines,
  everyoneStarred,
  markDone,
  newStory,
  standings,
  starWinners,
  starsFor,
  starsText,
  storySummary,
  toggleStar,
  totals,
  type Line,
  type StoryVersus,
} from './versus';

interface CoopState {
  turn: 'anyone';
  starter: string;
  lines: Line[];
  length: number;
  band?: Band;
}

type State = CoopState | StoryVersus;

interface Options {
  mode: 'coop' | 'versus';
  starter: string;
  length: number;
  players: PlayerSeat[];
  /** Lines each player writes in versus. */
  each: number;
}

const MIN_LINES = 4;

function Board(props: GameProps<State>) {
  return props.game.mode === 'versus' ? (
    <VersusBoard {...(props as unknown as GameProps<StoryVersus>)} />
  ) : (
    <CoopBoard {...(props as unknown as GameProps<CoopState>)} />
  );
}

function ReadAloud({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  if (!canSpeak) return null;
  return (
    <Button
      size="sm"
      icon={speaking ? 'stop' : 'speaker'}
      onClick={() => {
        if (speaking) {
          stopSpeaking();
          setSpeaking(false);
        } else {
          setSpeaking(true);
          speak(text, () => setSpeaking(false));
        }
      }}
    >
      {speaking ? 'Stop' : 'Read aloud'}
    </Button>
  );
}

/** Learn mode: the three parts of a story, with the one being written now picked out. */
function StoryShape({ part }: { part: Part }) {
  return (
    <ol className="story-shape" aria-label="The shape of a story">
      {(['beginning', 'middle', 'end'] as Part[]).map((p) => (
        <li key={p} aria-current={p === part ? 'step' : undefined}>
          <strong>{shape[p].title}</strong>
          <span>{shape[p].text}</span>
        </li>
      ))}
    </ol>
  );
}

/** Under the writing box: words to start a line with, and an Idea button, as the age band allows. */
function WritingHelp({ help, empty, onStart, onIdea }: { help: Help; empty: boolean; onStart: (word: string) => void; onIdea: () => void }) {
  if (!help.ideas && !(help.openers.length && empty)) return null;
  return (
    <div className="story-help">
      {help.openers.length > 0 && empty && (
        <div className="story-openers" role="group" aria-label="Start your line with">
          {help.openers.map((w) => (
            <button key={w} type="button" className="story-opener" onClick={() => onStart(w)}>
              {w}
            </button>
          ))}
        </div>
      )}
      {help.ideas && (
        <Button size="sm" variant="ghost" icon="sparkle" onClick={onIdea}>
          Idea
        </Button>
      )}
    </div>
  );
}

/** Tips, the Idea button and learn mode's story shape, for whoever is about to write line `lineNo`. */
function useWritingHelp(band: Band, lineNo: number, length: number, writing: boolean) {
  const learn = useLearn('story_chain');
  const tips = useTips('story_chain', { band, learn });
  const help = helpFor(band, learn);
  const part = partOf(lineNo, length);
  const form = useRef<HTMLFormElement>(null);
  const lastIdea = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (writing) tips.offer(...writingTips(lineNo, length));
    else if (tips.tip?.key !== HINT) tips.dismiss();
    // When the line to write changes.
  }, [lineNo, writing, tips.offer]);

  function idea() {
    lastIdea.current = ideaFor(part, lastIdea.current);
    tips.show({ key: HINT, text: lastIdea.current });
  }

  /** Puts a starting word in the box, ready to carry on typing. */
  function starter(setText: (t: string) => void) {
    return (word: string) => {
      setText(`${word} `);
      const box = form.current?.querySelector('textarea');
      box?.focus();
      requestAnimationFrame(() => box?.setSelectionRange(box.value.length, box.value.length));
    };
  }

  return { learn, tips, help, part, form, idea, starter };
}

function CoopBoard({ game, play, me, people }: GameProps<CoopState>) {
  const s = game.state;
  const [text, setText] = useState('');
  const [anyway, setAnyway] = useState(false);
  const done = game.status === 'finished';
  const last = s.lines[s.lines.length - 1];
  const wroteLast = last?.u === me.id;
  const canPlay = me.permissions.play_games && !done;
  const left = s.length - s.lines.length;
  const band = bandOf(s);
  const writing = canPlay && !(wroteLast && !anyway);
  const w = useWritingHelp(band, s.lines.length + 1, s.length, writing);

  const story = [s.starter, ...s.lines.map((l) => l.text)].join(' ');

  function summary(lines: Line[]) {
    const writers = [...new Set(lines.map((l) => l.u))].map((id) => nameOf(people, id));
    return `A new story by ${listNames(writers)}: "${s.starter.slice(0, 60)}${s.starter.length > 60 ? '…' : ''}"`;
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const line = text.trim().replace(/\s+/g, ' ');
    if (!line) return;
    play.move((st) => {
      const lines = [...st.lines, { u: me.id, text: line }];
      const finished = lines.length >= st.length;
      return finished ? { state: { ...st, lines }, status: 'finished', summary: summary(lines) } : { state: { ...st, lines } };
    }).then((ok) => {
      if (ok) {
        setText('');
        setAnyway(false);
      }
    });
  }

  function theEnd() {
    play.move((st) => ({ state: st, status: 'finished', summary: summary(st.lines) }));
  }

  return (
    <div className="story">
      <article className="story-page sheet">
        <p className="story-line story-starter">{s.starter}</p>
        {s.lines.map((l, i) => {
          const p = people.get(l.u);
          return (
            <p key={i} className={`story-line underline-${p?.colour ?? 'slate'}`} title={p?.name}>
              {l.text}
            </p>
          );
        })}
        {done && <p className="story-end">The End</p>}
      </article>

      <div className="story-tools">
        <div className="story-writers" role="group" aria-label="Writers">
          {[...new Set(s.lines.map((l) => l.u))].map((id) => (
            <span key={id} className="story-writer">
              <Avatar person={people.get(id)} size="xs" />
              <span>{nameOf(people, id, me.id)}</span>
            </span>
          ))}
        </div>
        <ReadAloud text={story + (done ? ' The end.' : '')} />
      </div>

      {writing && w.learn && <StoryShape part={w.part} />}
      {canPlay && <TipNote tip={w.tips.tip} onClose={w.tips.dismiss} />}
      {canPlay &&
        (wroteLast && !anyway ? (
          <div className="notice notice-info">
            <p>You wrote the last bit. Give someone else a turn, and come back after them.</p>
            <Button size="sm" variant="ghost" onClick={() => setAnyway(true)}>
              Add another bit anyway
            </Button>
          </div>
        ) : (
          <form ref={w.form} className="story-add stack" onSubmit={add}>
            <Field label="What happens next?" hint={lineHint(s.lines.length + 1, s.length, w.help, `${left} lines to go.`)}>
              {(p) => <TextArea {...p} rows={2} maxLength={240} value={text} onChange={(e) => setText(e.target.value)} />}
            </Field>
            <WritingHelp help={w.help} empty={!text.trim()} onStart={w.starter(setText)} onIdea={w.idea} />
            <div className="row">
              <Button type="submit" variant="primary" icon="pen" busy={play.busy} disabled={!text.trim()}>
                Add to the story
              </Button>
              {s.lines.length >= MIN_LINES && (
                <Button variant="ghost" onClick={theEnd} disabled={play.busy}>
                  Finish with The End
                </Button>
              )}
            </div>
          </form>
        ))}
    </div>
  );
}

/** People in the player seats, in turn order. */
const playersOf = (g: Game<StoryVersus>) =>
  seatOrder(g.seats)
    .map((k) => g.seats[k])
    .filter((p): p is number => typeof p === 'number');

function VersusBoard({ game, play, me, people }: GameProps<StoryVersus>) {
  const s = game.state;
  const order = seatOrder(game.seats);
  const players = playersOf(game);
  const mine = seatOf(game.seats, me.id);
  const over = game.status === 'finished';
  const writing = !over && s.phase === 'writing';
  const starring = !over && s.phase === 'stars';
  const myTurn = writing && !!mine && s.turn === mine && me.permissions.play_games;
  const [text, setText] = useState('');
  const [again, setAgain] = useState(false);
  const iAmDone = s.done.includes(me.id);
  const canStar = starring && me.permissions.play_games;
  const best = over ? bestLines(s) : [];
  const total = totals(s, players);
  const notDone = players.filter((id) => !s.done.includes(id));
  const lineNo = s.lines.length + 1;
  const who = (seat: string) => nameOf(people, game.seats[seat], me.id);
  const story = [s.starter, ...s.lines.map((l) => l.text)].join(' ');
  const myStars = Object.values(s.stars).filter((v) => v.includes(me.id)).length;
  const seatFor = (id: number) => seatOf(game.seats, id) ?? '';
  const band = bandOf(s);
  const w = useWritingHelp(band, lineNo, s.length, myTurn);
  const tips = w.tips;

  useEffect(() => {
    if (starring && mine && !iAmDone) tips.offer(TIPS.stars);
  }, [starring, iAmDone, tips.offer]);

  function finish(next: StoryVersus, g: Game<StoryVersus>): Update<StoryVersus> {
    return { state: next, status: 'finished', summary: storySummary(next, playersOf(g), (id) => nameOf(people, id)) };
  }

  function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    play
      .move((st, g) => {
        const seat = seatOf(g.seats, me.id);
        const next = seat ? addLine(st, seatOrder(g.seats), seat, me.id, text) : null;
        return next ? { state: next } : null;
      })
      .then((ok) => ok && setText(''));
  }

  function star(line: number) {
    play.move((st) => {
      const next = toggleStar(st, line, me.id);
      return next ? { state: next } : null;
    });
  }

  function done() {
    play.move((st, g) => {
      const next = markDone(st, me.id);
      if (!next) return null;
      return everyoneStarred(next, playersOf(g)) ? finish(next, g) : { state: next };
    });
  }

  function countNow() {
    play.move((st, g) => (st.phase === 'stars' ? finish(st, g) : null));
  }

  async function writeAnother() {
    setAgain(true);
    try {
      const turned = [...players.slice(1), ...players.slice(0, 1)];
      const seats = playerSeats(turned);
      const starter = pick(startersFor[band].filter((x) => x !== s.starter));
      await startGame(game.room_id, 'story_chain', { mode: 'versus', seats, state: { ...newStory(starter, s.each, seatOrder(seats)), band: s.band } });
    } finally {
      setAgain(false);
    }
  }

  let status: string;
  if (over) {
    const winners = starWinners(s, players);
    const names = winners.map((id) => (id === me.id ? 'You' : nameOf(people, id)));
    if (!winners.length) status = 'The End! What a story.';
    else if (winners.length > 1) status = `${listNames(names)} shared the most stars! 🌟`;
    else status = winners[0] === me.id ? 'Your lines got the most stars! 🌟' : `${names[0]}'s lines got the most stars! 🌟`;
  } else if (writing) {
    if (game.seats[s.turn] === 'open') status = 'Waiting for someone to join';
    else if (myTurn) status = 'Your turn to write';
    else status = `${who(s.turn)}'s turn to write${mine && nextSeat(order, s.turn) === mine ? ". You're next" : ''}`;
  } else if (mine && !iAmDone) status = 'The story is finished! Time for stars';
  else if (mine) status = `Waiting for ${listNames(notDone.map((id) => nameOf(people, id)))} to give stars`;
  else status = 'Give a star to every line you love';

  function detail(seat: string) {
    const id = game.seats[seat];
    if (id === 'open') return 'Waiting for someone';
    if (over) return `⭐ ${total[id as number] ?? 0}`;
    if (starring) return s.done.includes(id as number) ? '✓ Stars given' : 'Choosing stars…';
    const n = s.lines.filter((l) => l.u === id).length;
    return `${n} of ${s.each} lines`;
  }

  return (
    <div className="story story-vs">
      <SeatList game={game} me={me} people={people} turn={writing ? s.turn : undefined} detail={detail} />
      <p className="game-status" aria-live="polite">
        {status}
      </p>
      <JoinBanner game={game} me={me} />

      <article className="story-page sheet">
        <p className="story-line story-starter">{s.starter}</p>
        {s.lines.map((l, i) => {
          const p = people.get(l.u);
          const isBest = best.includes(i);
          return (
            <p key={i} className={`story-line underline-${p?.colour ?? 'slate'}`} title={p?.name} data-best={isBest || undefined}>
              {l.text}
              {over && starsFor(s, i) > 0 && (
                <span className="story-stars" aria-label={starsText(starsFor(s, i))}>
                  {isBest ? '👑 ' : ''}⭐ {starsFor(s, i)}
                </span>
              )}
            </p>
          );
        })}
        {!writing && <p className="story-end">The End</p>}
      </article>

      <div className="story-tools">
        <div className="story-writers" role="group" aria-label="Writers">
          {players.map((id) => (
            <span key={id} className="story-writer">
              <Avatar person={people.get(id)} size="xs" />
              <span>{nameOf(people, id, me.id)}</span>
            </span>
          ))}
        </div>
        <ReadAloud text={story + (writing ? '' : ' The end.')} />
      </div>

      {myTurn && w.learn && <StoryShape part={w.part} />}
      <TipNote tip={tips.tip} onClose={tips.dismiss} />
      {myTurn && (
        <form ref={w.form} className="story-add stack" onSubmit={add}>
          <Field label="Your line" hint={lineHint(lineNo, s.length, w.help, `Line ${lineNo} of ${s.length}. After you, it's ${who(nextSeat(order, mine!))}'s turn.`)}>
            {(p) => <TextArea {...p} rows={2} maxLength={240} value={text} onChange={(e) => setText(e.target.value)} />}
          </Field>
          <WritingHelp help={w.help} empty={!text.trim()} onStart={w.starter(setText)} onIdea={w.idea} />
          <div className="row">
            <Button type="submit" variant="primary" icon="pen" busy={play.busy} disabled={!text.trim()}>
              Add to the story
            </Button>
          </div>
        </form>
      )}

      {writing && !myTurn && (
        <p className="notice notice-info">
          {game.seats[s.turn] === 'open'
            ? 'The next line is for whoever joins. Then the story carries on.'
            : `${who(s.turn)} is writing line ${lineNo} of ${s.length}. When the story is done, everyone gives stars to their favourite lines.`}
        </p>
      )}

      {starring && (
        <section className="story-starring" aria-labelledby="give-stars">
          <h2 id="give-stars" className="story-starring-title">
            🌟 Give stars
          </h2>
          <p className="muted">Tap the star on every line you love. You can't star your own, and nobody sees the stars until the end.</p>
          <ul className="story-star-list">
            {s.lines.map((l, i) => {
              if (l.u === me.id) return null;
              const on = (s.stars[i] ?? []).includes(me.id);
              const p = people.get(l.u);
              return (
                <li key={i} className={`story-star-item sheet tint-${p?.colour ?? 'slate'}`} data-on={on || undefined}>
                  <span className="story-star-who">
                    <Avatar person={p} size="xs" />
                    {nameOf(people, l.u)}
                  </span>
                  <p className="story-star-text">{l.text}</p>
                  <button
                    type="button"
                    className="story-star-btn"
                    aria-pressed={on}
                    aria-label={on ? `Take back your star for ${p?.name}'s line` : `Give a star to ${p?.name}'s line`}
                    disabled={!canStar || play.busy}
                    onClick={() => star(i)}
                  >
                    {on ? '⭐' : <Icon name="star" size={28} />}
                  </button>
                </li>
              );
            })}
          </ul>
          {mine && !iAmDone && (
            <div className="row row-end row-wrap">
              <span className="muted">{myStars ? `You've given ${starsText(myStars)}.` : 'No stars given yet.'}</span>
              <Button variant="primary" icon="check" busy={play.busy} onClick={done}>
                I've given my stars
              </Button>
            </div>
          )}
          {mine && iAmDone && (
            <div className="notice notice-success">
              <p>
                Thanks for your stars! {notDone.length ? `Waiting for ${listNames(notDone.map((id) => nameOf(people, id)))}.` : ''} You can still
                change them until everyone's done.
              </p>
              {notDone.length > 0 && (
                <Button size="sm" onClick={countNow} disabled={play.busy}>
                  Count the stars now
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {over && (
        <div className="result sheet">
          {best.length > 0 ? (
            <div className="story-best">
              <p className="story-best-label">👑 {best.length > 1 ? 'Best lines' : 'Best line'}</p>
              {best.map((i) => (
                <blockquote key={i}>
                  <p>"{s.lines[i].text}"</p>
                  <footer>
                    {nameOf(people, s.lines[i].u, me.id)} · {starsText(starsFor(s, i))}
                  </footer>
                </blockquote>
              ))}
            </div>
          ) : (
            <p className="muted">No stars this time, but what a story!</p>
          )}
          <Standings
            game={game}
            me={me}
            people={people}
            label="Stars for each writer"
            rows={standings(s, players).map((r) => ({ seat: seatFor(r.id), place: r.place, main: `⭐ ${r.stars}` }))}
          />
          {me.permissions.start_games && players.length > 1 && (
            <Button variant="primary" icon="book" busy={again} onClick={writeAnother}>
              Write another
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Options({ value, onChange, mode, room, me, people, band }: OptionsProps<Options>) {
  return (
    <>
      {mode === 'versus' && (
        <>
          <p className="vs-rules">
            Take turns writing a line each. When the story is done, everyone gives a star to each line they love. The writer whose lines get the
            most stars wins, and the best line gets a crown.
          </p>
          <PlayerPicker value={value.players} onChange={(players) => onChange({ ...value, players })} room={room} me={me} people={people} max={6} />
        </>
      )}
      <Field label="How the story starts" hint="Write your own, or use this one.">
        {(p) => <TextArea {...p} rows={3} maxLength={240} value={value.starter} onChange={(e) => onChange({ ...value, starter: e.target.value })} />}
      </Field>
      <Button size="sm" variant="ghost" icon="refresh" onClick={() => onChange({ ...value, starter: pick(startersFor[band].filter((x) => x !== value.starter)) })}>
        Another idea
      </Button>
      {mode === 'versus' ? (
        <div className="field">
          <span className="field-label">Lines each</span>
          <Segmented
            label="Lines each"
            value={String(value.each)}
            onChange={(v) => onChange({ ...value, each: Number(v) })}
            options={[
              { value: '2', label: '2' },
              { value: '3', label: '3' },
              { value: '4', label: '4' },
            ]}
          />
        </div>
      ) : (
        <div className="field">
          <span className="field-label">Length</span>
          <Segmented
            label="Length"
            value={String(value.length)}
            onChange={(v) => onChange({ ...value, length: Number(v) })}
            options={[
              { value: '8', label: 'Short' },
              { value: '14', label: 'Medium' },
              { value: '20', label: 'Long' },
            ]}
          />
        </div>
      )}
    </>
  );
}

export const storyChain: GameDef<State, Options> = {
  type: 'story_chain',
  name: 'Story Chain',
  emoji: '📖',
  blurb: "Write a story one line each, then read it aloud when it's done.",
  modes: ['coop', 'versus'],
  modeLabels: { coop: 'Together', versus: 'Against each other' },
  players: 'Any number, or 2 to 6 taking turns',
  defaults: ({ me, room, mode, band }) => ({ mode, starter: pick(startersFor[band]), length: 8, players: defaultPlayers(room, me), each: 2 }),
  rebanded: (o, band) => (isStarter(o.starter) ? { ...o, starter: pick(startersFor[band]) } : o),
  ready: (o) => o.starter.trim().length > 0 && (o.mode !== 'versus' || o.players.length > 0),
  Options,
  create: (o, { me, mode }) => {
    if (mode !== 'versus') return { mode: 'coop', seats: {}, state: { turn: 'anyone', starter: o.starter.trim(), lines: [], length: o.length } };
    const seats = playerSeats([me.id, ...o.players]);
    return { mode, seats, state: newStory(o.starter.trim(), o.each, seatOrder(seats)) };
  },
  bands: {
    '5-7': 'Short, simple story starts, words to begin a line with, and ideas when you get stuck.',
    '8-10': 'Story starts with a twist, words to begin a line with, and ideas when you get stuck.',
    '11-13': 'Mysterious story starts, and ideas when you get stuck.',
    '14+': 'Story starts for older writers, and no help.',
  },
  basics: storyBasics,
  Board,
  guide: [
    { title: 'The aim', body: 'Write a story together, one line at a time, then read the whole thing aloud.' },
    { title: 'Together', body: "Anyone can write the next line, just not two in a row. Give someone else a turn, then you can go again." },
    {
      title: 'Against each other',
      body: "Players take turns in order. When the story is finished, everyone gives a star to every line they love, but never their own. Nobody sees the stars until the end, and the most stars wins.",
    },
    {
      title: 'Writing a good line',
      body: [
        'Read the line before yours and carry it on.',
        'Add something new: a surprise, a problem, a feeling or a sound.',
        'Leave the next writer something to work with.',
        'Make the last line an ending.',
      ],
    },
  ],
  status: (g, me, people) => {
    if (g.status === 'finished') return g.summary || 'Finished';
    if (g.mode === 'versus') {
      const s = g.state as StoryVersus;
      if (s.phase === 'stars') {
        const players = playersOf(g as Game<StoryVersus>);
        const left = players.filter((id) => !s.done.includes(id));
        if (players.includes(me) && !s.done.includes(me)) return 'The story is done · give your stars';
        return `Stars time · waiting for ${listNames(left.map((id) => nameOf(people, id, me)))}`;
      }
      const turn = g.seats[s.turn];
      const where = `line ${s.lines.length + 1} of ${s.length}`;
      if (turn === 'open') return `Waiting for someone to join · ${where}`;
      return turn === me ? `Your turn to write · ${where}` : `${nameOf(people, turn)} is writing · ${where}`;
    }
    const s = g.state as CoopState;
    const last = s.lines[s.lines.length - 1];
    const by = last ? ` · last line by ${nameOf(people, last.u, me)}` : '';
    return `${s.lines.length} of ${s.length} lines${by}`;
  },
};
