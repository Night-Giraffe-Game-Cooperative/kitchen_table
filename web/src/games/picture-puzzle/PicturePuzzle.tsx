import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { confirmFirst } from '../../components/confirm';
import type { Game, Media } from '../../lib/types';
import { Button } from '../../components/ui';
import type { GameDef, GameProps, OptionsProps, PlayerSeat, Update } from '../common';
import { listNames, nameOf, playerSeats, seatOf, seatOrder, startGame } from '../common';
import { bandOf, type Band } from '../bands';
import { PhotoPicker, chosenPicture } from '../photos';
import { TipNote, useLearn, useTips, type Lesson, type Tip } from '../learn';
import { JoinBanner, PlayerPicker, SeatList, Standings, defaultPlayers, winnerText, type Standing } from '../word-garden/Players';
import {
  begin,
  everyoneFinished,
  fewestSwaps,
  formatTime,
  hasFinished,
  isSolved,
  newRace,
  raceSummary,
  scramble,
  standings,
  swap,
  type RaceState,
} from './race';

interface CoopState {
  turn: 'anyone';
  media: { url: string; width: number; height: number };
  size: number;
  tiles: number[]; // tiles[place] = which piece of the picture sits there
  moves: number;
  by: Record<string, number>;
  band?: Band;
}

type State = CoopState | RaceState;

interface Options {
  mode: 'coop' | 'versus';
  media: Media | null;
  file: File | null;
  players: PlayerSeat[];
}

/** Pieces along each side, by age: 9 big pieces for the youngest up to 36 small ones. */
const sizeFor: Record<Band, number> = { '5-7': 3, '8-10': 4, '11-13': 5, '14+': 6 };

/**
 * The clues a puzzle gives. The youngest see the finished picture all the
 * time and the right space lights up when they pick up a piece; 14 and up
 * get no peeking. Learn mode shows the picture and allows a peek at any age
 * when puzzling together, but not in a race, where it's switched on for one
 * device and would help only that player.
 */
function cluesFor(band: Band, learn: boolean, race: boolean) {
  const help = learn && !race;
  return {
    guide: band === '5-7' || help,
    home: band === '5-7' || help,
    peek: band !== '14+' || help,
  };
}

const TIPS = {
  start: { key: 'start', basic: true, text: 'Tap a piece to pick it up, then tap the space where it belongs. The two pieces swap places.' },
  placed: { key: 'placed', basic: true, text: 'That piece is in its right place, so it stays put. Pieces in place lose their outline.' },
  corners: { key: 'corners', text: 'Look for the corners and edges first. Sky usually goes along the top and the ground along the bottom.' },
  landmarks: { key: 'landmarks', text: 'Faces and bright colours make good landmarks. Find where they go, then fill in around them.' },
  peek: { key: 'peek', text: 'Stuck? Peek shows the whole picture until you hide it again.' },
  fewest: { key: 'fewest', text: 'To keep your swaps low, put every piece you move straight into its right place.' },
} satisfies Record<string, Tip>;

/** Tips as the puzzle goes: how to swap, pieces locking in, where to look. */
function usePuzzleTips(band: Band, learn: boolean, tiles: number[] | null, swaps: number, { race, peek }: { race: boolean; peek: boolean }) {
  const tips = useTips('picture_puzzle', { band, learn });
  const placed = tiles ? tiles.filter((p, i) => p === i).length : 0;
  const before = useRef(placed);
  useEffect(() => {
    const was = before.current;
    before.current = placed;
    if (!tiles) return;
    if (isSolved(tiles)) return void tips.dismiss();
    if (swaps === 0) return void tips.offer(TIPS.start, race ? TIPS.fewest : null);
    if (placed > was) return void tips.offer(TIPS.placed, swaps >= 4 ? TIPS.landmarks : null);
    tips.offer(swaps >= 2 ? TIPS.corners : null, swaps >= 8 && peek && placed * 3 < tiles.length ? TIPS.peek : null);
    // Once a swap.
  }, [swaps, !tiles, tips.offer]);
  return tips;
}

/** The finished picture, small, beside the puzzle: the youngest always have it. */
function GuidePicture({ media }: { media: CoopState['media'] }) {
  return <img className="pp-guide" src={media.url} alt="The finished picture, to copy" />;
}

function Board(props: GameProps<State>) {
  return props.game.mode === 'versus' ? (
    <RaceBoard {...(props as unknown as GameProps<RaceState>)} />
  ) : (
    <CoopBoard {...(props as unknown as GameProps<CoopState>)} />
  );
}

/** The picture in pieces, in its wooden frame. */
function Grid({
  media,
  size,
  tiles,
  held,
  locked,
  done,
  peek,
  home,
  onTap,
}: {
  media: CoopState['media'];
  size: number;
  tiles: number[];
  held: number | null;
  locked: boolean;
  done: boolean;
  peek: boolean;
  /** Light up the space the picked-up piece belongs in. */
  home: boolean;
  onTap: (place: number) => void;
}) {
  const goes = home && held !== null ? tiles[held] : null;
  return (
    <div className="pp-frame">
      <div
        className="pp-grid"
        data-done={done || undefined}
        style={{ '--n': size, aspectRatio: `${media.width} / ${media.height}` } as CSSProperties}
        role="group"
        aria-label="Puzzle"
      >
        {tiles.map((piece, place) => {
          const x = piece % size;
          const y = Math.floor(piece / size);
          const right = piece === place;
          return (
            <button
              key={place}
              type="button"
              className="pp-tile"
              data-held={held === place || undefined}
              data-right={right || undefined}
              data-home={(goes === place && held !== place) || undefined}
              disabled={locked || right}
              aria-label={`Piece ${piece + 1} at space ${place + 1}${right ? ', in place' : ''}${held === place ? ', picked up' : ''}${goes === place && held !== place ? ', where it goes' : ''}`}
              onClick={() => onTap(place)}
              style={{
                backgroundImage: `url(${media.url})`,
                backgroundSize: `${size * 100}% ${size * 100}%`,
                backgroundPosition: `${(x / (size - 1)) * 100}% ${(y / (size - 1)) * 100}%`,
              }}
            />
          );
        })}
        {peek && <img className="pp-peek" src={media.url} alt="The finished picture" />}
      </div>
    </div>
  );
}

/** Tap a piece, then the place it goes. */
function useHeld(onSwap: (a: number, b: number) => void) {
  const [held, setHeld] = useState<number | null>(null);
  function tap(place: number) {
    if (held === null) return setHeld(place);
    if (held === place) return setHeld(null);
    const a = held;
    setHeld(null);
    onSwap(a, place);
  }
  return { held, tap };
}

function CoopBoard({ game, play, me, people }: GameProps<CoopState>) {
  const s = game.state;
  const [peek, setPeek] = useState(false);
  const [again, setAgain] = useState(false);
  const done = game.status === 'finished';
  const canPlay = me.permissions.play_games && !done;
  const placed = s.tiles.filter((p, i) => p === i).length;
  const band = bandOf(s);
  const learn = useLearn('picture_puzzle');
  const clues = cluesFor(band, learn, false);
  const tips = usePuzzleTips(band, learn, s.tiles, s.moves, { race: false, peek: clues.peek });
  const smaller = Math.min(6, s.size + 1);

  const { held, tap } = useHeld((a, place) =>
    play.move((st) => {
      if (st.tiles[a] === a || st.tiles[place] === place) return null;
      const tiles = [...st.tiles];
      [tiles[a], tiles[place]] = [tiles[place], tiles[a]];
      const by = { ...st.by, [me.id]: (st.by[me.id] ?? 0) + 1 };
      const next = { ...st, tiles, moves: st.moves + 1, by };
      if (isSolved(tiles)) {
        const helpers = Object.keys(by).map((id) => nameOf(people, Number(id)));
        return { state: next, status: 'finished', summary: `${listNames(helpers)} finished the picture puzzle in ${next.moves} swaps` };
      }
      return { state: next };
    }),
  );

  return (
    <div className="pp">
      <div className="pp-bar">
        {clues.guide && !done && <GuidePicture media={s.media} />}
        <span className="muted">
          {done ? `Finished in ${s.moves} swaps` : `${placed} of ${s.tiles.length} pieces in place · ${s.moves} swaps`}
        </span>
        {!done && clues.peek && (
          <Button size="sm" variant="ghost" icon="eye" onClick={() => setPeek(!peek)}>
            {peek ? 'Hide picture' : 'Peek'}
          </Button>
        )}
      </div>
      {!done && <TipNote tip={tips.tip} onClose={tips.dismiss} />}
      <Grid
        media={s.media}
        size={s.size}
        tiles={s.tiles}
        held={held}
        locked={!canPlay || play.busy}
        done={done}
        peek={peek && clues.peek}
        home={clues.home}
        onTap={(place) => canPlay && s.tiles[place] !== place && tap(place)}
      />
      {!done && <p className="muted center">{held === null ? 'Tap a piece, then tap where it should go.' : 'Now tap where it should go.'}</p>}
      {done && (
        <div className="result sheet">
          <p className="result-big">Picture complete! 🧩</p>
          <p className="muted">{listNames(Object.keys(s.by).map((id) => nameOf(people, Number(id), me.id)))} put it together.</p>
          {me.permissions.start_games && (
            <Button
              variant="primary"
              icon="grid"
              busy={again}
              onClick={async () => {
                setAgain(true);
                try {
                  await startGame(game.room_id, 'picture_puzzle', {
                    mode: 'coop',
                    seats: {},
                    state: { ...s, size: smaller, tiles: scramble(smaller), moves: 0, by: {} },
                  });
                } finally {
                  setAgain(false);
                }
              }}
            >
              {smaller > s.size ? 'Again, with smaller pieces' : 'Again'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const swapsText = (n: number) => `${n} ${n === 1 ? 'swap' : 'swaps'}`;

/** Seats with someone in them, in order. */
const seatedOf = (g: Game<RaceState>) => seatOrder(g.seats).filter((k) => typeof g.seats[k] === 'number');

function RaceBoard({ game, play, me, people }: GameProps<RaceState>) {
  const s = game.state;
  const [peek, setPeek] = useState(false);
  const [again, setAgain] = useState(false);
  const over = game.status === 'finished';
  const mine = seatOf(game.seats, me.id);
  const board = mine ? s.boards[mine] : undefined;
  const finished = hasFinished(board);
  const canPlay = me.permissions.play_games && !over && !!mine;
  const seated = seatedOf(game);
  const best = fewestSwaps(s.start);
  // Other people's swaps stay hidden from you until you've finished too.
  const seeAll = over || finished || !mine;
  const rows = standings(s, seated);
  const stillGoing = seated.filter((k) => !hasFinished(s.boards[k]));
  const name = (seat: string) => nameOf(people, game.seats[seat], me.id);
  const band = bandOf(s);
  const learn = useLearn('picture_puzzle');
  const clues = cluesFor(band, learn, true);
  const tips = usePuzzleTips(band, learn, board && !finished ? board.tiles : null, board?.swaps ?? 0, { race: true, peek: clues.peek });

  function settle(next: RaceState, g: Game<RaceState>): Update<RaceState> {
    if (!everyoneFinished(next, g.seats)) return { state: next };
    return { state: next, status: 'finished', summary: raceSummary(next, seatedOf(g), (k) => nameOf(people, g.seats[k])) };
  }

  const { held, tap } = useHeld((a, b) =>
    play.move((st, g) => {
      const seat = seatOf(g.seats, me.id);
      const next = seat ? swap(st, seat, a, b, Date.now()) : null;
      return next ? settle(next, g) : null;
    }),
  );

  function start() {
    play.move((st, g) => {
      const seat = seatOf(g.seats, me.id);
      const next = seat ? begin(st, seat, Date.now()) : null;
      return next ? { state: next } : null;
    });
  }

  async function endNow() {
    if (!(await confirmFirst('End the race now?', 'End the race', `${listNames(stillGoing.map((k) => nameOf(people, game.seats[k])))} won't get a place.`))) return;
    play.move((st, g) => ({ state: st, status: 'finished', summary: raceSummary(st, seatedOf(g), (k) => nameOf(people, g.seats[k])) }));
  }

  async function raceAgain() {
    setAgain(true);
    try {
      const players = seated.map((k) => game.seats[k] as number);
      await startGame(game.room_id, 'picture_puzzle', { mode: 'versus', seats: playerSeats(players), state: { ...newRace(s.media, s.size), band: s.band } });
    } finally {
      setAgain(false);
    }
  }

  function detail(seat: string) {
    const b = s.boards[seat];
    if (game.seats[seat] === 'open') return 'Waiting for someone';
    if (!b) return over ? "Didn't play" : 'Not started';
    if (hasFinished(b)) return seeAll ? `✓ ${swapsText(b.swaps)}` : '✓ Finished';
    if (seat === mine) return `${swapsText(b.swaps)} so far`;
    return over ? "Didn't finish" : 'Puzzling…';
  }

  const standingRows: Standing[] = rows.map((r) => {
    if (r.place) {
      const perfect = r.swaps === best;
      return { seat: r.seat, place: r.place, main: swapsText(r.swaps!), extra: `${formatTime(r.time!)}${perfect ? ' · ✨ perfect' : ''}` };
    }
    const b = s.boards[r.seat];
    return { seat: r.seat, place: null, main: over ? (b ? "Didn't finish" : "Didn't play") : b ? 'Still puzzling' : 'Not started yet' };
  });

  const others = seated.filter((k) => k !== mine).map((k) => nameOf(people, game.seats[k]));
  const winners = rows.filter((r) => r.place === 1);
  const decidedOnTime = winners.length === 1 && rows[1]?.place === 2 && rows[1].swaps === winners[0].swaps;

  let status: string;
  if (over) status = winnerText(winners.map((r) => r.seat), game, me, people);
  else if (!mine) status = seated.length > 1 ? `${listNames(seated.map(name))} are racing` : 'Waiting for players';
  else if (!board) status = others.length ? `You're racing ${listNames(others)}` : 'Waiting for someone to join';
  else if (!finished) status = `${board.tiles.filter((p, i) => p === i).length} of ${board.tiles.length} pieces in place · ${swapsText(board.swaps)}`;
  else status = `You finished in ${swapsText(board.swaps)}!`;

  const picture = (
    <figure className="pp-done sheet">
      <img src={s.media.url} alt="The finished picture" />
    </figure>
  );

  return (
    <div className="pp pp-race">
      <SeatList game={game} me={me} people={people} detail={(seat) => detail(seat)} />
      <p className="game-status" aria-live="polite">
        {status}
      </p>
      <JoinBanner game={game} me={me}>
        There's a place free in this race. Want to play?
      </JoinBanner>

      {over ? (
        <>
          <div className="result sheet">
            <Standings game={game} me={me} people={people} rows={standingRows} />
            <p className="muted">
              The fewest swaps possible was {best}.{decidedOnTime ? ' Same swaps at the top, so the quicker puzzler won.' : ''}
            </p>
            {me.permissions.start_games && seated.length > 1 && (
              <Button variant="primary" icon="grid" busy={again} onClick={raceAgain}>
                Race again
              </Button>
            )}
          </div>
          {picture}
        </>
      ) : !mine ? (
        <div className="pp-watch sheet">
          <img src={s.media.url} alt="The picture being put back together" />
          <p className="muted">Everyone has the same jumble. Each puzzle stays hidden until its player finishes.</p>
        </div>
      ) : !board ? (
        <div className="pp-ready sheet">
          <img className="pp-ready-art" src={s.media.url} alt="The picture to put back together" />
          <div className="pp-ready-text">
            <p className="result-big">Ready to race?</p>
            <p>Everyone gets the same jumbled picture. The fewest swaps wins. If it's a tie, the quicker puzzler wins.</p>
            <p className="muted">Your time starts when you press Start. Nobody can see your puzzle until you finish.</p>
            <Button variant="primary" size="lg" icon="grid" busy={play.busy} disabled={!canPlay} onClick={start}>
              Start my puzzle
            </Button>
          </div>
        </div>
      ) : finished ? (
        <>
          <div className="result sheet">
            <p className="result-big">{board.swaps === best ? 'Perfect! ✨' : 'Picture complete! 🧩'}</p>
            <p className="muted">
              {swapsText(board.swaps)} in {formatTime(board.ended - board.began)}.{' '}
              {board.swaps === best ? "That's the fewest swaps possible." : `The fewest possible was ${best}.`}
            </p>
            <Standings game={game} me={me} people={people} rows={standingRows} label="So far" />
            {stillGoing.length > 0 && (
              <>
                <p>Waiting for {listNames(stillGoing.map(name))} to finish.</p>
                <Button variant="ghost" size="sm" onClick={endNow} disabled={play.busy}>
                  End the race now
                </Button>
              </>
            )}
          </div>
          {picture}
        </>
      ) : (
        <>
          <div className="pp-bar">
            {clues.guide && <GuidePicture media={s.media} />}
            <span className="muted">Fewest swaps wins</span>
            {clues.peek && (
              <Button size="sm" variant="ghost" icon="eye" onClick={() => setPeek(!peek)}>
                {peek ? 'Hide picture' : 'Peek'}
              </Button>
            )}
          </div>
          <TipNote tip={tips.tip} onClose={tips.dismiss} />
          <Grid
            media={s.media}
            size={s.size}
            tiles={board.tiles}
            held={held}
            locked={!canPlay || play.busy}
            done={false}
            peek={peek && clues.peek}
            home={clues.home}
            onTap={(place) => canPlay && board.tiles[place] !== place && tap(place)}
          />
          <p className="muted center">{held === null ? 'Tap a piece, then tap where it should go.' : 'Now tap where it should go.'}</p>
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
            A race! Everyone gets the same jumbled picture on a board of their own. The fewest swaps wins, and if that's a tie, the quicker
            puzzler wins.
          </p>
          <PlayerPicker value={value.players} onChange={(players) => onChange({ ...value, players })} room={room} me={me} people={people} max={6} race />
        </>
      )}
      <PhotoPicker roomId={room.id} value={value} onChange={(c) => onChange({ ...value, ...c })} />
    </>
  );
}

export const picturePuzzle: GameDef<State, Options> = {
  type: 'picture_puzzle',
  name: 'Picture Puzzle',
  emoji: '🧩',
  blurb: 'A family photo cut into pieces. Swap them until the picture is whole again, together or in a race.',
  modes: ['coop', 'versus'],
  modeLabels: { coop: 'Together', versus: 'Against each other' },
  players: 'Any number, or a race for 2 to 6',
  defaults: ({ me, room, mode }) => ({ mode, media: null, file: null, players: defaultPlayers(room, me) }),
  ready: (o) => !!(o.media || o.file) && (o.mode !== 'versus' || o.players.length > 0),
  Options,
  create: async (o, { room, me, mode, band }) => {
    const picture = await chosenPicture(o, room.id);
    const size = sizeFor[band];
    if (mode === 'versus') {
      return { mode, seats: playerSeats([me.id, ...o.players]), state: newRace(picture, size) };
    }
    return {
      mode: 'coop',
      seats: {},
      state: { turn: 'anyone', media: picture, size, tiles: scramble(size), moves: 0, by: {} },
    };
  },
  bands: {
    '5-7': '9 big pieces. The finished picture stays in view, and the right space lights up when you pick up a piece.',
    '8-10': '16 pieces, with a peek at the finished picture whenever you need it.',
    '11-13': '25 smaller pieces, with a peek when you need it.',
    '14+': '36 small pieces and no peeking.',
  },
  basics: [
    { art: '🧩', title: 'The aim', text: 'A photo has been cut into squares and jumbled up. Put every piece back where it belongs to finish the picture.' },
    { art: '👆', title: 'Swapping', text: 'Tap a piece to pick it up, then tap the space where it should go. The two pieces swap places.' },
    { art: '✅', title: 'Pieces in place', text: "A piece in its right place loses its outline and stays put, so it can't be moved by mistake." },
    { art: '🔍', title: 'Where to look', text: 'Corners, sky, faces and bright colours are the easiest pieces to place. Start with those and fill in around them.' },
    { art: '🏁', title: 'Together or a race', text: 'Together, everyone helps on one puzzle. In a race, everyone gets the same jumble and the fewest swaps wins.' },
  ] satisfies Lesson[],
  Board,
  guide: [
    { title: 'The aim', body: 'A photo is cut into squares and jumbled up. Put it back together.' },
    {
      title: 'Moving pieces',
      body: 'Tap a piece, then tap the space where it belongs. The two pieces swap places. The count above the puzzle says how many are in the right place.',
    },
    {
      title: 'A race',
      body: "Everyone gets the same jumble and nobody can see anyone else's puzzle. The fewest swaps wins, and if that's a tie the quickest puzzler wins.",
    },
    {
      title: 'Thinking it through',
      body: [
        'Corners and edges are often easiest to spot: look for sky, floor and straight lines.',
        'Faces and bright colours make good landmarks.',
        'To use the fewest swaps, put every piece you move straight into its right place.',
      ],
    },
  ],
  status: (g, me, people) => {
    if (g.status === 'finished') return g.summary || 'Finished';
    if (g.mode === 'versus') {
      const s = g.state as RaceState;
      const seated = seatedOf(g as Game<RaceState>);
      const mine = seatOf(g.seats, me);
      const board = mine ? s.boards[mine] : undefined;
      const left = seated.filter((k) => !hasFinished(s.boards[k]));
      const open = seatOrder(g.seats).some((k) => g.seats[k] === 'open');
      if (mine && !board) return 'A picture race · your puzzle is waiting';
      if (board && !hasFinished(board)) return `A picture race · you've made ${swapsText(board.swaps)}`;
      if (left.length) return `A picture race · waiting for ${listNames(left.map((k) => nameOf(people, g.seats[k], me)))}`;
      return open ? 'A picture race · a place is free' : 'A picture race';
    }
    const s = g.state as CoopState;
    const placed = s.tiles.filter((p, i) => p === i).length;
    return `${placed} of ${s.tiles.length} pieces in place · anyone can help`;
  },
};
