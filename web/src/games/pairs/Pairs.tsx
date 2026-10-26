// Pairs: the memory game. Cards are dealt face down, two of every picture
// (family photos from the chat, animals or treats), and you turn them over two
// at a time to find the pairs. Together, the family finds them all in as few
// turns as it can; taking turns, a pair scores and earns another go.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Button, Segmented } from '../../components/ui';
import { canSpeak, speak } from '../../lib/speech';
import { useStore } from '../../lib/store';
import type { Game, Media } from '../../lib/types';
import type { GameDef, GameProps, OptionsProps, PlayerSeat, Update } from '../common';
import { listNames, nameOf, nextSeat, playerSeats, seatOf, seatOrder, startGame } from '../common';
import { bandOf, type Band } from '../bands';
import { pictureOf, useChatPhotos } from '../photos';
import { TipNote, useLearn, useTips, type Lesson, type Tip } from '../learn';
import { JoinBanner, SeatList, Standings, defaultPlayers, winnerText } from '../word-garden/Players';
import {
  PAIRS,
  coopSummary,
  faceOf,
  flip,
  isOver,
  lastWasMatch,
  layoutFor,
  missShowing,
  newGame,
  nextPlayers,
  pairsFound,
  pairsText,
  ratingText,
  scoreLine,
  scoresOf,
  standings,
  totalPairs,
  turnsText,
  versusSummary,
  winners,
  type Finder,
  type PairsState,
  type PictureSet,
} from './rules';

interface Options {
  mode: 'coop' | 'versus';
  pictures: PictureSet;
  /** The chat's latest photos, once they've loaded. */
  photos: Media[] | null;
  players: PlayerSeat[];
}

/**
 * The clues a game gives. The youngest get a quick look at every card before
 * the first one is turned, and 5 to 10 get a little mark on cards that have
 * been seen before. Learn mode gives the mark at any age.
 */
function cluesFor(band: Band, learn: boolean) {
  return { look: band === '5-7', seen: band === '5-7' || band === '8-10' || learn };
}

const TIPS = {
  start: { key: 'start', basic: true, text: 'Tap a card to turn it over, then tap another one. If the two pictures match, you have found a pair.' },
  miss: { key: 'miss', basic: true, text: 'Not a pair. Remember where those two are! They turn back over when the next card is tapped.' },
  again: { key: 'again', basic: true, text: 'You found a pair, so you get another go. Keep going until you miss.' },
  seen: { key: 'seen', basic: true, text: 'The little eye marks a card that has been turned over before. Can you remember what it was?' },
  watch: { key: 'watch', text: 'Watch the cards other players turn over too. Every card you see is a clue for your turn.' },
  watchAll: { key: 'watch', text: 'Watch the cards everyone else turns over too. Every card anyone sees is a clue for the whole family.' },
} satisfies Record<string, Tip>;

const LOOKED = 'pairs:looked';

/** Games this device has had its first look at, so a reload doesn't give another. */
function looked(): number[] {
  try {
    const ids = JSON.parse(localStorage.getItem(LOOKED) ?? '[]');
    return Array.isArray(ids) ? ids.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

function rememberLook(id: number) {
  try {
    localStorage.setItem(LOOKED, JSON.stringify([...looked().filter((x) => x !== id), id].slice(-20)));
  } catch {
    /* private browsing: it just isn't remembered */
  }
}

type Look = 'ready' | 'look' | null;

/**
 * The youngest players' look at every card, just on this device: a "Ready?"
 * moment, then three seconds with every card face up. Once started it runs to
 * the end, even if someone turns a card meanwhile.
 */
function useFirstLook(gameId: number, wanted: boolean) {
  const [look, setLook] = useState<Look>(null);
  useEffect(() => {
    if (!wanted || looked().includes(gameId)) return;
    rememberLook(gameId);
    setLook('ready');
  }, [wanted, gameId]);
  useEffect(() => {
    if (!look) return;
    const t = setTimeout(() => setLook(look === 'ready' ? 'look' : null), look === 'ready' ? 1500 : 3000);
    return () => clearTimeout(t);
  }, [look]);
  return { look, skip: () => setLook(null) };
}

const seatedOf = (g: Game<PairsState>) => seatOrder(g.seats).filter((k) => typeof g.seats[k] === 'number');

function Board({ game, play, me, people, room }: GameProps<PairsState>) {
  const { toast } = useStore();
  const s = game.state;
  const versus = game.mode === 'versus';
  const done = game.status === 'finished';
  const over = isOver(s);
  const order = seatOrder(game.seats);
  const seated = seatedOf(game);
  const mine = versus ? seatOf(game.seats, me.id) : undefined;
  const playing = me.permissions.play_games && (!versus || !!mine);
  const myTurn = !done && playing && (!versus || s.turn === mine);
  const waiting = versus && !done && game.seats[s.turn] === 'open';
  const band = bandOf(s);
  const learn = useLearn('pairs');
  const clues = cluesFor(band, learn);
  const { look, skip } = useFirstLook(game.id, clues.look && !done && playing && s.seen.length === 0);
  const tips = useTips('pairs', { band, learn });
  const [pending, setPending] = useState<number | null>(null);
  const queued = useRef<number | null>(null);
  const [again, setAgain] = useState(false);
  const pairs = totalPairs(s);
  const { cols, rows } = layoutFor(pairs);
  const who = (id: unknown) => nameOf(people, id, me.id);
  const seatName = (seat: string) => who(game.seats[seat]);
  const finderName = (f: Finder) => (versus ? seatName(String(f)) : who(f));
  const finderColour = (f: Finder) => {
    const id = versus ? game.seats[String(f)] : f;
    return typeof id === 'number' ? (people.get(id)?.colour ?? 'slate') : 'slate';
  };

  // What has just happened, as a tip: how to play, a miss to remember, another go, the seen marks.
  useEffect(() => {
    if (done) return void tips.dismiss();
    if (!playing || look) return;
    const l = s.last;
    const mineLast = l?.by === me.id;
    if (!l) return void tips.offer(TIPS.start);
    if (missShowing(s)) {
      if (!tips.offer(mineLast ? TIPS.miss : versus ? TIPS.watch : TIPS.watchAll, TIPS.miss) && tips.tip?.key === TIPS.again.key) tips.dismiss();
      return;
    }
    if (versus && mineLast && lastWasMatch(s)) return void tips.offer(TIPS.again);
    if (clues.seen && s.seen.some((i) => s.found[i] === null && !s.up.includes(i))) tips.offer(TIPS.seen);
    // Once a move, and when the first look ends.
  }, [game.version, !look, done]);

  // A card tapped while the last one is still saving waits its turn, rather than being lost.
  useEffect(() => {
    if (play.busy || pending !== null || queued.current === null) return;
    const i = queued.current;
    queued.current = null;
    if (canTap(i)) void turnOver(i);
  }, [play.busy, pending]);

  function canTap(i: number) {
    return myTurn && !look && s.found[i] === null && !(s.up.length === 1 && s.up[0] === i) && pending !== i;
  }

  function settle(next: PairsState, g: Game<PairsState>): Update<PairsState> {
    if (!isOver(next)) return { state: next };
    const summary =
      next.turn === 'anyone' ? coopSummary(next, (id) => nameOf(people, id)) : versusSummary(next, seatedOf(g), (k) => nameOf(people, g.seats[k]));
    return { state: next, status: 'finished', summary };
  }

  async function turnOver(i: number) {
    setPending(i);
    const face = faceOf(s, i);
    if (learn && canSpeak && face.emoji) speak(face.name);
    await play.move((st, g) => {
      // Whoever's turn it is now, the card must still be face down and it must still be my go.
      const seat = st.turn === 'anyone' ? undefined : seatOf(g.seats, me.id);
      if (st.turn !== 'anyone' && !seat) return null;
      const next = flip(st, i, seat ? { finder: seat, person: me.id, order: seatOrder(g.seats) } : { finder: me.id, person: me.id });
      return next ? settle(next, g) : null;
    });
    setPending(null);
  }

  function tap(i: number) {
    if (!canTap(i)) return;
    if (play.busy || pending !== null) {
      queued.current = i;
      return;
    }
    void turnOver(i);
  }

  // Arrow keys move between the cards like a grid.
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols } as Record<string, number>)[e.key];
    const at = Number((e.target as HTMLElement).dataset.card);
    if (!step || Number.isNaN(at)) return;
    const to = at + step;
    if (to < 0 || to >= s.cards.length) return;
    e.preventDefault();
    e.currentTarget.querySelector<HTMLElement>(`[data-card="${to}"]`)?.focus();
  }

  async function playAgain() {
    setAgain(true);
    try {
      if (!versus) {
        await startGame(game, 'pairs', { mode: 'coop', seats: {}, state: newGame({ set: s.set, band, photos: s.photos }) });
        return;
      }
      // The same players, and the next game opens with the next player.
      const seats = playerSeats(nextPlayers(seated.map((k) => game.seats[k] as number), room?.member_ids));
      await startGame(game, 'pairs', { mode: 'versus', seats, state: newGame({ set: s.set, band, photos: s.photos, order: seatOrder(seats) }) });
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setAgain(false);
    }
  }

  // The cards this device shows face up: the saved ones, with a tapped card turned straight away.
  const showingUp = pending === null ? s.up : missShowing(s) ? [pending] : [...s.up, pending];

  let status: string;
  const line = scoreLine(s, seated, seatName);
  if (!versus) {
    if (done) status = over ? `All ${pairs} pairs found!` : game.summary || 'Finished';
    else status = `The family has found ${pairsFound(s)} of ${pairs} pairs · ${turnsText(s.turns)}`;
  } else if (done) status = over ? winnerText(winners(s, seated), game, me, people) : game.summary || 'Finished';
  else if (waiting) status = `Waiting for someone to join · ${line}`;
  else if (myTurn && s.up.length === 1) status = 'Now turn over another card';
  else if (s.turn === mine) status = `${lastWasMatch(s) && s.last?.by === me.id ? 'A pair! Have another go' : 'Your turn'} · ${line}`;
  else status = `${seatName(s.turn)}'s turn${mine && nextSeat(order, s.turn) === mine ? ". You're next" : ''} · ${line}`;

  function news(): string {
    const l = s.last;
    if (!l) return versus ? 'Turn over two cards to look for a pair.' : 'Anyone can turn over a card.';
    const [a, b] = l.cards.map((c) => faceOf(s, c).name);
    const name = who(l.by);
    if (l.cards.length === 1) return `${name} turned over ${a}.`;
    if (lastWasMatch(s)) return `${name} found a pair: ${a}!`;
    return `${name} turned over ${a} and ${b}. Not a pair.`;
  }

  function label(i: number, faceUp: boolean, seenMark: boolean): string {
    const f = s.found[i];
    const name = faceOf(s, i).name;
    if (f !== null) return `Card ${i + 1}, ${name}, found by ${finderName(f)}`;
    if (faceUp) return `Card ${i + 1}, ${name}`;
    return `Card ${i + 1}, face down${seenMark ? ', seen before' : ''}`;
  }

  /** Together: who found how many, as "Mia found 3 pairs and you found 5 pairs." */
  function foundBy(): string {
    const finders = Object.entries(scoresOf(s)).map(([id, n]) => ({ name: who(Number(id)), n }));
    if (finders.length === 1) return `${finders[0].name} found every pair.`;
    return listNames(finders.map((f, i) => `${i > 0 && f.name === 'You' ? 'you' : f.name} found ${pairsText(f.n)}`)) + '.';
  }

  return (
    <div className="pairs">
      {versus && (
        <SeatList
          game={game}
          me={me}
          people={people}
          turn={done ? undefined : s.turn}
          detail={(seat) => (
            <span className="vs-score">
              <span aria-hidden="true">🃏</span> {scoresOf(s)[seat] ?? 0}
              <span className="sr-only"> {(scoresOf(s)[seat] ?? 0) === 1 ? 'pair' : 'pairs'}</span>
            </span>
          )}
        />
      )}
      <p className="game-status" aria-live="polite">
        {status}
      </p>
      {versus && <JoinBanner game={game} me={me} />}

      {done && (
        <div className="result sheet">
          {versus ? (
            <Standings
              game={game}
              me={me}
              people={people}
              label={over ? 'Results' : 'When the game stopped'}
              rows={standings(s, seated).map((r) => ({ seat: r.seat, place: r.place, main: pairsText(r.pairs) }))}
            />
          ) : over ? (
            <>
              <p className="result-big">Found in {turnsText(s.turns)}! 🎉</p>
              <p>{ratingText(pairs, s.turns)}</p>
              <p className="muted">{foundBy()}</p>
            </>
          ) : (
            <p className="muted">
              {pairsFound(s)} of {pairs} pairs were found in {turnsText(s.turns)}.
            </p>
          )}
          {me.permissions.start_games && (
            <Button variant="primary" icon="refresh" busy={again} onClick={playAgain}>
              Play again
            </Button>
          )}
        </div>
      )}

      {!done &&
        (look ? (
          <div className="pairs-look sheet" role="status">
            <span className="pairs-look-art" aria-hidden="true">
              🦒
            </span>
            <p>{look === 'ready' ? 'Ready? Here they are…' : 'Have a good look! They turn back over in a moment.'}</p>
            <Button size="sm" variant="ghost" onClick={skip}>
              Skip
            </Button>
            {look === 'look' && <span className="pairs-look-bar" aria-hidden="true" />}
          </div>
        ) : (
          <p className="pairs-news" aria-live="polite">
            {news()}
          </p>
        ))}
      {!done && <TipNote tip={tips.tip} onClose={tips.dismiss} />}

      <div className="pairs-table" style={{ '--cols': cols, '--rows': rows } as CSSProperties}>
        <div className="pairs-grid" role="group" aria-label="Cards" onKeyDown={onKey}>
          {s.cards.map((faceIndex, i) => {
            const face = s.faces[faceIndex];
            const f = s.found[i];
            const faceUp = f !== null || showingUp.includes(i) || look === 'look';
            const seenMark = clues.seen && !faceUp && s.seen.includes(i);
            const tint = f !== null ? ` tint-${finderColour(f)}` : '';
            return (
              <button
                key={i}
                type="button"
                className={`pairs-card${tint}`}
                data-card={i}
                data-up={faceUp || undefined}
                data-found={f !== null || undefined}
                data-miss={(pending === null && missShowing(s) && s.up.includes(i)) || undefined}
                data-pop={(f !== null && lastWasMatch(s) && s.last?.cards.includes(i)) || undefined}
                aria-disabled={!canTap(i) || undefined}
                aria-label={label(i, faceUp, seenMark)}
                onClick={() => tap(i)}
              >
                <span className="pairs-inner" aria-hidden="true">
                  <span className="pairs-back">{seenMark && <span className="pairs-seen" />}</span>
                  <span
                    className={face.url ? 'pairs-face pairs-photo' : 'pairs-face'}
                    style={face.url ? { backgroundImage: `url(${JSON.stringify(face.url)})` } : undefined}
                  >
                    {face.emoji && <span className="pairs-emoji">{face.emoji}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Options({ value, onChange, mode, band, room }: OptionsProps<Options>) {
  const photos = useChatPhotos(room.id, 12);
  const need = PAIRS[band];

  // Keep the chat's photos with the options. A chat with none starts on animals.
  useEffect(() => {
    if (!photos || value.photos === photos) return;
    const none = !photos.length && value.photos === null && value.pictures === 'photos';
    onChange({ ...value, photos, pictures: none ? 'animals' : value.pictures });
  }, [photos, value.photos]);

  let hint: string;
  if (value.pictures === 'animals') hint = 'Foxes, owls, pandas, hedgehogs and lots more.';
  else if (value.pictures === 'treats') hint = "The Night Giraffe's favourite snacks: strawberries, biscuits, cupcakes and more.";
  else if (!photos) hint = 'Finding the photos in this chat…';
  else if (!photos.length) hint = 'This chat has no photos yet, so the cards will be animals.';
  else if (photos.length < need) hint = `This chat has ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}, so the rest are animals.`;
  else hint = `The latest ${need} photos in this chat.`;

  return (
    <>
      {mode === 'versus' && (
        <>
          <p className="vs-rules">
            Take turns to turn over two cards. Find a pair and it's yours, and you go again. Miss, and it's the next player's turn. Most pairs wins!
          </p>
        </>
      )}
      <div className="field">
        <span className="field-label">Pictures</span>
        <Segmented
          label="Pictures"
          value={value.pictures}
          onChange={(pictures) => onChange({ ...value, pictures })}
          options={[
            { value: 'photos', label: 'Family photos', icon: 'photo' },
            { value: 'animals', label: 'Animals' },
            { value: 'treats', label: 'Treats' },
          ]}
        />
        <p className="field-hint">{hint}</p>
        {value.pictures === 'photos' && !!photos?.length && (
          <div className="pairs-strip" aria-hidden="true">
            {photos.slice(0, need).map((m) => (
              <img key={m.key} src={m.url} alt="" />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export const pairs: GameDef<PairsState, Options> = {
  type: 'pairs',
  name: 'Pairs',
  emoji: '🃏',
  blurb: "Turn over two cards and look for a matching pair. Play with family photos, animals or the Night Giraffe's favourite treats.",
  modes: ['coop', 'versus'],
  modeLabels: { coop: 'Together', versus: 'Taking turns' },
  players: 'Any number together, or 2 to 6 taking turns',
  most: 6,
  defaults: ({ me, room, mode }) => ({ mode, pictures: 'photos', photos: null, players: defaultPlayers(room, me) }),
  ready: (o) => (o.mode !== 'versus' || o.players.length > 0) && (o.pictures !== 'photos' || o.photos !== null),
  Options,
  create: (o, { me, mode, band }) => {
    const photos = o.pictures === 'photos' ? (o.photos ?? []).map(pictureOf) : [];
    const set: PictureSet = o.pictures === 'photos' && !photos.length ? 'animals' : o.pictures;
    if (mode === 'versus') {
      const seats = playerSeats([me.id, ...o.players]);
      return { mode, seats, state: newGame({ set, band, photos, order: seatOrder(seats) }) };
    }
    return { mode: 'coop', seats: {}, state: newGame({ set, band, photos }) };
  },
  bands: {
    '5-7': '6 pairs (12 cards). A quick look at every card before you start, and a little mark on cards that have been seen.',
    '8-10': '8 pairs (16 cards), and a little mark on cards that have been turned over before.',
    '11-13': '10 pairs (20 cards), and no clues.',
    '14+': '12 pairs (24 cards), and nothing to help but your memory.',
  },
  basics: [
    { art: '🃏', title: 'The aim', text: 'Every picture is on two cards, and all the cards start face down. Find all the pairs.' },
    {
      art: '👆',
      title: 'Turn two cards',
      text: 'Tap a card to turn it over, then tap another. If the two pictures match, they stay face up. You found a pair!',
    },
    {
      art: '🔄',
      title: 'Not a pair?',
      text: 'Both cards stay up so everyone can see them. Remember where they are! They turn back over when the next card is tapped.',
    },
    {
      art: '👀',
      title: 'Watch everything',
      text: 'Every card that is turned over is a clue, even when someone else turns it. A little eye marks cards seen before.',
    },
    {
      art: '🏆',
      title: 'Together or taking turns',
      text: 'Together, the family finds every pair in as few turns as it can. Taking turns, a pair gives you another go, and the most pairs wins.',
    },
  ] satisfies Lesson[],
  Board,
  guide: [
    { title: 'The aim', body: 'Every picture is on two cards. All the cards start face down. Find all the pairs.' },
    {
      title: 'Turning cards',
      body: "Tap a card to turn it over, then tap another. If they match, they stay face up and they're yours. If not, both stay up for everyone to see, and they turn back over when the next card is tapped.",
    },
    { title: 'Together', body: 'Anyone in the chat can turn cards. Every two cards is one turn. Find all the pairs in as few turns as you can.' },
    {
      title: 'Taking turns',
      body: "Find a pair and it's yours, and you go again. Miss, and it's the next player's turn. The most pairs wins, and a tie shares the win.",
    },
    {
      title: 'Thinking it through',
      body: [
        "Watch every card that's turned over, even on someone else's turn.",
        'Say the pictures to yourself as they turn over: "fox in the corner, cat in the middle".',
        "Turn over a card you haven't seen first. If its pair is one you remember, go straight to it.",
      ],
    },
  ],
  status: (g, me, people) => {
    if (g.status === 'finished') return g.summary || 'Finished';
    const s = g.state as PairsState;
    if (g.mode !== 'versus') return `The family has found ${pairsFound(s)} of ${totalPairs(s)} pairs · ${turnsText(s.turns)}`;
    const line = scoreLine(s, seatedOf(g as Game<PairsState>), (k) => nameOf(people, g.seats[k], me));
    const turn = g.seats[s.turn];
    if (turn === 'open') return `Waiting for someone to join · ${line}`;
    return `${turn === me ? 'Your turn' : `${nameOf(people, turn)}'s turn`} · ${line}`;
  },
};
