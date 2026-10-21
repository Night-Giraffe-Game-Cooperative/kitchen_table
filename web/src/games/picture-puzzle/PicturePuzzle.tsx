import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../../lib/api';
import { confirmFirst } from '../../components/confirm';
import { preparePhoto, upload } from '../../lib/image';
import type { Game, Media, Message } from '../../lib/types';
import { Button, Segmented, Spinner } from '../../components/ui';
import { Icon } from '../../components/icons';
import type { GameDef, GameProps, OptionsProps, PlayerSeat, Update } from '../common';
import { listNames, nameOf, playerSeats, seatOf, seatOrder, startGame } from '../common';
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
}

type State = CoopState | RaceState;

interface Options {
  mode: 'coop' | 'versus';
  size: number;
  media: Media | null;
  file: File | null;
  players: PlayerSeat[];
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
  onTap,
}: {
  media: CoopState['media'];
  size: number;
  tiles: number[];
  held: number | null;
  locked: boolean;
  done: boolean;
  peek: boolean;
  onTap: (place: number) => void;
}) {
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
              disabled={locked || right}
              aria-label={`Piece ${piece + 1} at space ${place + 1}${right ? ', in place' : ''}${held === place ? ', picked up' : ''}`}
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
        <span className="muted">
          {done ? `Finished in ${s.moves} swaps` : `${placed} of ${s.tiles.length} pieces in place · ${s.moves} swaps`}
        </span>
        {!done && (
          <Button size="sm" variant="ghost" icon="eye" onClick={() => setPeek(!peek)}>
            {peek ? 'Hide picture' : 'Peek'}
          </Button>
        )}
      </div>
      <Grid
        media={s.media}
        size={s.size}
        tiles={s.tiles}
        held={held}
        locked={!canPlay || play.busy}
        done={done}
        peek={peek}
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
                  const size = Math.min(6, s.size + 1);
                  await startGame(game.room_id, 'picture_puzzle', {
                    mode: 'coop',
                    seats: {},
                    state: { ...s, size, tiles: scramble(size), moves: 0, by: {} },
                  });
                } finally {
                  setAgain(false);
                }
              }}
            >
              Again, with smaller pieces
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
      await startGame(game.room_id, 'picture_puzzle', { mode: 'versus', seats: playerSeats(players), state: newRace(s.media, s.size) });
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
            <span className="muted">Fewest swaps wins</span>
            <Button size="sm" variant="ghost" icon="eye" onClick={() => setPeek(!peek)}>
              {peek ? 'Hide picture' : 'Peek'}
            </Button>
          </div>
          <Grid
            media={s.media}
            size={s.size}
            tiles={board.tiles}
            held={held}
            locked={!canPlay || play.busy}
            done={false}
            peek={peek}
            onTap={(place) => canPlay && board.tiles[place] !== place && tap(place)}
          />
          <p className="muted center">{held === null ? 'Tap a piece, then tap where it should go.' : 'Now tap where it should go.'}</p>
        </>
      )}
    </div>
  );
}

function Options({ value, onChange, mode, room, me, people }: OptionsProps<Options>) {
  const [photos, setPhotos] = useState<Media[] | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<{ messages: Message[] }>(`/api/rooms/${room.id}/messages`)
      .then((res) => {
        const seen = new Set<string>();
        const list = res.messages
          .filter((m) => m.media && !m.deleted)
          .map((m) => m.media!)
          .reverse()
          .filter((m) => (seen.has(m.key) ? false : (seen.add(m.key), true)))
          .slice(0, 12);
        setPhotos(list);
      })
      .catch(() => setPhotos([]));
    // Once per room.
  }, [room.id]);

  // The latest photo, until one is chosen. Again after the options are reset,
  // as they are when switching between together and against each other.
  useEffect(() => {
    if (photos?.[0] && !value.media && !value.file) onChange({ ...value, media: photos[0] });
  }, [photos, value.media, value.file]);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

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
      <fieldset className="fieldset">
        <legend>Picture</legend>
        {!photos ? (
          <Spinner label="Finding photos" />
        ) : (
          <div className="photo-pick">
            {preview && (
              <button type="button" className="photo-option" aria-pressed={!!value.file}>
                <img src={preview} alt="Your new photo" />
              </button>
            )}
            {photos.map((m) => (
              <button
                key={m.key}
                type="button"
                className="photo-option"
                aria-pressed={!value.file && value.media?.key === m.key}
                onClick={() => onChange({ ...value, media: m, file: null })}
              >
                <img src={m.url} alt="" />
              </button>
            ))}
            <button type="button" className="photo-option photo-add" onClick={() => input.current?.click()}>
              <Icon name="camera" size={26} />
              <span>New photo</span>
            </button>
            <input
              ref={input}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setPreview(URL.createObjectURL(file));
                onChange({ ...value, file, media: null });
              }}
            />
          </div>
        )}
        {photos && photos.length === 0 && !preview && <p className="muted">No photos in this chat yet. Add a new one.</p>}
      </fieldset>
      <div className="field">
        <span className="field-label">Pieces</span>
        <Segmented
          label="Pieces"
          value={String(value.size)}
          onChange={(v) => onChange({ ...value, size: Number(v) })}
          options={[
            { value: '3', label: '9 big' },
            { value: '4', label: '16' },
            { value: '5', label: '25 small' },
          ]}
        />
      </div>
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
  defaults: ({ me, room, mode }) => ({ mode, size: 3, media: null, file: null, players: defaultPlayers(room, me) }),
  ready: (o) => !!(o.media || o.file) && (o.mode !== 'versus' || o.players.length > 0),
  Options,
  create: async (o, { room, me, mode }) => {
    let media = o.media;
    if (o.file) {
      const prepared = await preparePhoto(o.file);
      media = (await upload(room.id, prepared)).media;
    }
    if (!media) throw new Error('Choose a picture first.');
    const picture = { url: media.url, width: media.width ?? 1000, height: media.height ?? 1000 };
    if (mode === 'versus') {
      return { mode, seats: playerSeats([me.id, ...o.players]), state: newRace(picture, o.size) };
    }
    return {
      mode: 'coop',
      seats: {},
      state: { turn: 'anyone', media: picture, size: o.size, tiles: scramble(o.size), moves: 0, by: {} },
    };
  },
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
