// Where's the Giraffe? Hide and seek in a family photo. Whoever starts it
// hides the Night Giraffe somewhere in the picture; everyone else taps the
// photo to guess, with warmer and colder clues for the younger ages, until a
// guess lands close enough and he pops out to say hello.
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { confirmFirst } from '../../components/confirm';
import { Button } from '../../components/ui';
import type { Media } from '../../lib/types';
import type { GameDef, GameProps, OptionsProps } from '../common';
import { nameOf, startGame } from '../common';
import { bandOf } from '../bands';
import { PhotoPicker, chosenPicture } from '../photos';
import { TipNote, useLearn, useTips, type Lesson, type Tip } from '../learn';
import { FACE, HEAD_SHARE, NightGiraffe } from './NightGiraffe';
import {
  AREA_TIMES,
  HEAT,
  NOBODY,
  RADIUS,
  areaShown,
  canShow,
  cluesFor,
  cluesOf,
  foundSummary,
  fresh,
  guess,
  guessesText,
  hide,
  nudge,
  placeWords,
  spotAt,
  widthPct,
  type Clue,
  type Spot,
  type State,
} from './rules';

const TYPE = 'wheres_giraffe';

interface Options {
  media: Media | null;
  file: File | null;
}

/** Guesses listed under the photo; the rest are still on it as dots. */
const LISTED = 6;

const TIPS = {
  hide: {
    key: 'hide',
    basic: true,
    text: 'Tap the photo to hide the Night Giraffe. Tap somewhere else to move him. When you like his spot, press Hide him here.',
  },
  watch: { key: 'watch', basic: true, text: "You know where he is, so you can't guess. Watch the dots appear as everyone looks for him." },
  guess: { key: 'guess', basic: true, text: 'Tap the photo where you think the Night Giraffe is hiding. Every guess leaves a dot.' },
  warmer: { key: 'warmer', basic: true, text: 'Warmer means a guess is closer to him than the guess before. Colder means it is further away.' },
  heat: { key: 'heat', basic: true, text: 'Each dot shows how close it is. ❄️ Blue is far away and 🔥 red is very close.' },
  area: { key: 'area', text: "The glow shows the area he's in. He's somewhere inside it, but not always in the middle." },
  others: { key: 'others', text: "Look at where other people guessed. He isn't on any of their dots, so try somewhere new." },
} satisfies Record<string, Tip>;

/** What the latest clue means, for learn mode. */
function explain(c: Clue): string {
  if (c.found) return '';
  if (c.heat === 4) return 'Very hot means that guess is really close to him.';
  if (c.trend === 'warmer') return 'Warmer means that guess was closer to him than the one before.';
  if (c.trend === 'colder') return 'Colder means that guess was further from him than the one before.';
  if (c.trend === 'same') return 'About the same means that guess was just as far from him as the one before.';
  return 'The colour shows how close a guess is: ❄️ blue is far away and 🔥 red is close.';
}

const symbolOf = (c: Clue | undefined) => (!c ? '' : c.found ? '⭐' : c.heat === null ? '✕' : HEAT[c.heat].symbol);

/** Places something on the photo by its middle. */
const at = (p: Spot): CSSProperties => ({ left: `${p.x * 100}%`, top: `${p.y * 100}%` });

function Board({ game, play, me, people }: GameProps<State>) {
  const s = game.state;
  const band = bandOf(s);
  const learn = useLearn(TYPE);
  const clues = cluesFor(band, learn);
  const done = game.status === 'finished';
  const hider = game.seats.hider;
  const iHide = hider === me.id;
  const hiding = !done && s.turn === 'hider';
  const seeking = !done && s.turn === 'anyone' && !!s.spot;
  const canHide = me.permissions.play_games && hiding && iHide;
  const canGuess = me.permissions.play_games && seeking && !iHide;
  const interactive = canHide || canGuess;

  const [draft, setDraft] = useState<Spot | null>(null);
  const [cross, setCross] = useState<Spot>({ x: 0.5, y: 0.5 });
  const [pending, setPending] = useState<Spot | null>(null);
  const [where, setWhere] = useState('');
  const [again, setAgain] = useState(false);

  const marks = cluesOf(s, band, clues.level);
  const n = s.guesses.length;
  const last = n ? s.guesses[n - 1] : null;
  const lastClue = n ? marks[n - 1] : undefined;
  const mine = s.guesses.filter((g) => g.by === me.id).length;
  const glow = seeking && areaShown(s, clues.areaAfter);
  const found = s.foundBy != null;
  const who = (id: unknown) => nameOf(people, id, me.id);

  // Seekers never see him until the game is over; the hider sees him faintly.
  const him: Spot | null = done ? s.spot : !iHide ? null : hiding ? draft : s.spot;
  const r = RADIUS[band];

  const tips = useTips(TYPE, { band, learn });
  useEffect(() => {
    if (done) return void tips.dismiss();
    if (hiding) return void (canHide && tips.offer(TIPS.hide));
    if (iHide) return void tips.offer(TIPS.watch);
    if (!canGuess) return;
    tips.offer(
      mine === 0 ? TIPS.guess : null,
      glow ? TIPS.area : null,
      clues.level === 'words' && n >= 2 ? TIPS.warmer : null,
      clues.level === 'heat' && n >= 1 ? TIPS.heat : null,
      mine >= 1 && n - mine >= 3 ? TIPS.others : null,
    );
  }, [done, hiding, canHide, canGuess, iHide, n, glow, clues.level, tips.offer]);

  function act(p: Spot) {
    if (play.busy) return;
    setCross(p);
    if (canHide) {
      setDraft(p);
      setWhere(`He's hiding ${placeWords(p)}. Press Hide him here when you're happy.`);
    } else if (canGuess) void guessAt(p);
  }

  async function guessAt(p: Spot) {
    setPending(p);
    await play.move((st, g) => {
      const out = guess(st, p, me.id, g.seats.hider);
      if (!out) return null;
      if (out.found) return { state: out.state, status: 'finished', summary: foundSummary(me.name, out.state.guesses.length) };
      return { state: out.state };
    });
    setPending(null);
  }

  async function hideHere() {
    const spot = draft;
    if (!spot) return;
    const ok = await play.move((st) => {
      const next = hide(st, spot);
      return next ? { state: next } : null;
    });
    if (ok) setDraft(null);
  }

  async function showUs() {
    if (!(await confirmFirst('Show where he is hiding?', 'Show us where', 'The game ends and everyone sees where he was.'))) return;
    play.move((st) => (canShow(st) ? { state: { ...st, ended: 'shown' }, status: 'finished', summary: NOBODY } : null));
  }

  async function hideAgain() {
    setAgain(true);
    try {
      await startGame(game.room_id, TYPE, { mode: 'coop', seats: { hider: me.id }, state: fresh(s.media, s.band) });
    } finally {
      setAgain(false);
    }
  }

  function onClick(e: MouseEvent<HTMLDivElement>) {
    // A click with no pointer (from a screen reader) uses the crosshair.
    if (e.detail === 0) return act(cross);
    const box = e.currentTarget.getBoundingClientRect();
    act(spotAt((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const moved = nudge(cross, e.key, s.media, e.shiftKey);
    if (moved) {
      e.preventDefault();
      setCross(moved);
      setWhere(`Crosshair ${placeWords(moved)}`);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      act(cross);
    }
  }

  let status: string;
  if (done) status = found ? (s.foundBy === me.id ? 'Found by you! 🎉' : `Found by ${who(s.foundBy)}`) : s.ended === 'shown' ? NOBODY : game.summary || 'Finished';
  else if (hiding) status = iHide ? 'Hiding him · your turn' : `${who(hider)} is hiding the Night Giraffe`;
  else status = `Seeking · ${n ? `${guessesText(n)} so far` : 'no guesses yet'}`;

  let hint = '';
  if (canHide) hint = draft ? 'Tap somewhere else to move him, or hide him here.' : 'Tap the photo to hide the Night Giraffe.';
  else if (hiding) hint = 'Have a good look at the photo while you wait.';
  else if (seeking && iHide) hint = 'Only you can see him. Watch the guesses come in.';
  else if (canGuess) hint = pending ? 'Looking…' : "Tap where you think he's hiding.";
  else if (seeking) hint = "You're watching.";

  const keysId = `gf-keys-${game.id}`;
  const label = canHide
    ? 'The photo. Choose where the Night Giraffe hides.'
    : canGuess
      ? 'The photo. Guess where the Night Giraffe is hiding.'
      : him
        ? `The photo. The Night Giraffe is ${placeWords(him)}.`
        : `The photo${n ? `, with ${guessesText(n)} on it` : ''}`;
  const reveal = done && him ? (found ? 'found' : 'shown') : undefined;

  const giraffe = him && (
    <span
      className="gf-him"
      data-reveal={reveal}
      data-hidden={!done || undefined}
      style={{ ...at(him), width: `${widthPct((2 * r * 0.85) / HEAD_SHARE, s.media)}%`, transform: `translate(-${FACE.x * 100}%, -${FACE.y * 100}%)` }}
    >
      <NightGiraffe className="gf-him-art" />
      {reveal === 'found' && (
        <>
          <span className="gf-sparkle" data-n="1">
            ✨
          </span>
          <span className="gf-sparkle" data-n="2">
            ✨
          </span>
          <span className="gf-sparkle" data-n="3">
            ⭐
          </span>
        </>
      )}
    </span>
  );

  const listed = s.guesses.map((g, i) => ({ g, c: marks[i], i })).slice(-LISTED).reverse();

  return (
    <div className="gf">
      <p className="game-status" aria-live="polite">
        {status}
        {seeking && last && lastClue && (
          <span className="gf-said">
            <span className="sr-only">. </span>
            <span aria-hidden="true">{symbolOf(lastClue)}</span> {who(last.by)}: {lastClue.word}
          </span>
        )}
      </p>
      {!done && <TipNote tip={tips.tip} onClose={tips.dismiss} />}

      <div className="gf-stage">
        <div
          className="gf-photo"
          style={{ '--ar': `${s.media.width} / ${s.media.height}` } as CSSProperties}
          role={interactive ? 'application' : 'img'}
          tabIndex={interactive ? 0 : undefined}
          aria-label={label}
          aria-describedby={interactive ? keysId : undefined}
          data-live={interactive || undefined}
          data-busy={(interactive && play.busy) || undefined}
          onClick={interactive ? onClick : undefined}
          onKeyDown={interactive ? onKeyDown : undefined}
        >
          <img className="gf-img" src={s.media.url} alt="" draggable={false} />
          {glow && s.area && <span className="gf-glow" style={{ ...at(s.area), width: `${widthPct(2 * AREA_TIMES * r, s.media)}%` }} />}
          {him && !done && <span className="gf-ring" style={{ ...at(him), width: `${widthPct(2 * r, s.media)}%` }} />}
          {!done && giraffe}
          {s.guesses.map((g, i) => {
            const c = marks[i];
            return (
              <span
                key={i}
                className={`gf-dot tint-${people.get(g.by)?.colour ?? 'slate'}`}
                data-heat={c?.heat ?? 'none'}
                data-found={c?.found || undefined}
                data-last={(i === n - 1 && !done) || undefined}
                style={at(g)}
              >
                {symbolOf(c)}
              </span>
            );
          })}
          {seeking && last && lastClue && clues.level !== 'heat' && (
            <span className="gf-say" data-side={last.x > 0.55 ? 'left' : 'right'} data-edge={last.y < 0.1 ? 'top' : last.y > 0.9 ? 'bottom' : undefined} style={at(last)}>
              {lastClue.word}
            </span>
          )}
          {pending && <span className="gf-dot gf-dot-pending" style={at(pending)} />}
          {done && giraffe}
          {interactive && <span className="gf-cross" style={at(cross)} />}
        </div>
      </div>
      {interactive && (
        <p id={keysId} className="sr-only">
          Use the arrow keys to move the crosshair, then press Enter to {canHide ? 'hide him there' : 'guess there'}. Hold Shift for bigger steps.
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {interactive ? where : ''}
      </p>

      {hint && <p className="muted center gf-hint">{hint}</p>}
      {glow && <p className="center gf-hint gf-glow-note">✨ The glow shows the area he's in.</p>}
      {learn && seeking && lastClue && explain(lastClue) && <p className="gf-learn">{explain(lastClue)}</p>}
      {learn && canHide && draft && <p className="gf-learn">Only you can see him. To find him, someone has to tap inside the dashed ring.</p>}

      {canHide && (
        <div className="row row-wrap game-actions">
          <Button variant="primary" icon="check" busy={play.busy} disabled={!draft} onClick={hideHere}>
            Hide him here
          </Button>
        </div>
      )}
      {canGuess && canShow(s) && (
        <div className="row row-wrap game-actions">
          <Button size="sm" variant="ghost" icon="eye" disabled={play.busy} onClick={showUs}>
            Show us where
          </Button>
        </div>
      )}

      {done && (
        <div className="result sheet">
          <p className="result-big">{found ? 'Found him! 🦒' : s.ended === 'shown' ? 'Here he was! 🦒' : 'The game has ended'}</p>
          {(found || him) && (
            <p className="muted">
              {found
                ? `${foundSummary(s.foundBy === me.id ? 'You' : who(s.foundBy), n)}.`
                : s.ended === 'shown'
                  ? `${NOBODY}, after ${guessesText(n)}.`
                  : "Here's where he was hiding."}
            </p>
          )}
          {me.permissions.start_games && (
            <Button variant="primary" icon="sparkle" busy={again} onClick={hideAgain}>
              {s.foundBy === me.id ? 'Hide him next' : iHide ? 'Hide him again' : 'Hide him yourself'}
            </Button>
          )}
        </div>
      )}

      {n > 0 && (
        <section className="gf-log sheet" aria-labelledby={`gf-log-${game.id}`}>
          <h2 id={`gf-log-${game.id}`} className="gf-log-title">
            Guesses<span className="sr-only">, newest first</span>
          </h2>
          <ol className="gf-log-list">
            {listed.map(({ g, c, i }) => (
              <li key={i} className={`gf-log-row tint-${people.get(g.by)?.colour ?? 'slate'}`}>
                <span className="gf-chip" data-heat={c?.heat ?? 'none'} data-found={c?.found || undefined} aria-hidden="true">
                  {symbolOf(c)}
                </span>
                <span className="gf-log-name">{who(g.by)}</span>
                <span className="gf-log-word">
                  {c?.word}
                  {c?.trend && c.heat !== null && <span className="sr-only">, {HEAT[c.heat].name}</span>}
                </span>
              </li>
            ))}
          </ol>
          {n > LISTED && <p className="muted gf-log-more">and {guessesText(n - LISTED)} before those, still on the photo</p>}
        </section>
      )}
    </div>
  );
}

function Options({ value, onChange, room }: OptionsProps<Options>) {
  return (
    <>
      <p className="vs-rules">You hide the Night Giraffe somewhere in a photo. Everyone else in the chat taps the photo to find him.</p>
      <PhotoPicker roomId={room.id} value={value} onChange={(c) => onChange({ ...value, ...c })} legend="The photo he hides in" />
    </>
  );
}

export const wheresGiraffe: GameDef<State, Options> = {
  type: TYPE,
  name: "Where's the Giraffe?",
  emoji: '🦒',
  blurb: 'Hide the Night Giraffe somewhere in a family photo. Everyone else taps the photo to find him, with warmer and colder clues.',
  modes: ['coop'],
  modeLabels: { coop: 'Hide and seek' },
  players: 'One hider and any number of seekers',
  defaults: () => ({ media: null, file: null }),
  ready: (o) => !!(o.media || o.file),
  Options,
  create: async (o, { room, me }) => ({ mode: 'coop', seats: { hider: me.id }, state: fresh(await chosenPicture(o, room.id)) }),
  bands: {
    '5-7': 'A big giraffe with warmer and colder clues, and a glow that shows his area after 8 guesses.',
    '8-10': 'A smaller giraffe with warmer and colder clues, and a glow that shows his area after 15 guesses.',
    '11-13': 'A small giraffe, and each guess only shows how hot or cold it is.',
    '14+': 'A tiny giraffe and no clues at all, just "Not there".',
  },
  basics: [
    { art: '🦒', title: 'Hide and seek', text: 'The Night Giraffe loves hide and seek. One person hides him somewhere in a family photo.' },
    { art: '🙈', title: 'Hiding', text: "The hider taps the photo to choose his spot. Only the hider can see him, so the hider can't guess." },
    { art: '👆', title: 'Seeking', text: 'Everyone else taps the photo where they think he is. Every guess leaves a dot for everyone to see.' },
    { art: '🔥', title: 'Warmer or colder', text: 'Warmer means closer than the guess before. Colder means further away. Red dots are close and blue dots are far.' },
    { art: '🎉', title: 'Found him!', text: 'Tap close enough and he pops out to say hello. Whoever found him can hide him next.' },
  ] satisfies Lesson[],
  Board,
  guide: [
    { title: 'The aim', body: 'One person hides the Night Giraffe somewhere in a family photo. Everyone else looks for him by tapping the photo.' },
    {
      title: 'Hiding',
      body: "Whoever starts the game is the hider. Tap the photo to choose his spot, tap again to move him, then press Hide him here. Only the hider can see him, and the hider can't guess.",
    },
    {
      title: 'Seeking',
      body: "Tap where you think he's hiding. Every guess leaves a dot on the photo for everyone to see. Land close enough and he pops out to say hello.",
    },
    {
      title: 'Clues',
      body: [
        "Ages 5 to 7: each guess says warmer, colder or very hot, and the dots go from cold blue to hot red. After 8 guesses, a glow shows the area he's in.",
        'Ages 8 to 10: the same words and colours, and the glow after 15 guesses.',
        'Ages 11 to 13: hot and cold colours only.',
        'Ages 14 and up: no clues, just "Not there".',
        'Learn mode gives the words and colours at any age.',
      ],
    },
    { title: 'Stuck?', body: 'After 10 guesses, anyone looking for him can press Show us where. He comes out and the game ends.' },
    {
      title: 'With a keyboard',
      body: 'Tab to the photo and move the crosshair with the arrow keys. Hold Shift for bigger steps. Press Enter or Space to guess, or to hide him if you are the hider.',
    },
    {
      title: 'Thinking it through',
      body: [
        "Look at where other people guessed. He isn't on any of their dots.",
        'Warmer means closer than the guess before, so keep going that way. Colder means turn back.',
        'Big, bright places are easy to search first. Then try the corners and the shadows.',
      ],
    },
  ],
  status: (g, me, people) => {
    if (g.status === 'finished') return g.summary || 'Finished';
    const s = g.state as State;
    if (s.turn === 'hider') return g.seats.hider === me ? 'Hiding him · your turn' : `${nameOf(people, g.seats.hider)} is hiding the Night Giraffe`;
    const n = s.guesses?.length ?? 0;
    return `Seeking · ${n ? `${guessesText(n)} so far` : 'no guesses yet'}`;
  },
};
