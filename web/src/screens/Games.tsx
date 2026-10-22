import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { whoCanChange } from '../lib/permissions';
import { api } from '../lib/api';
import { go } from '../lib/router';
import { ago } from '../lib/time';
import type { Game, Me } from '../lib/types';
import { Avatar, Button, Dialog, EmptyState, Field, IconButton, Notice, Segmented, Select, Spinner } from '../components/ui';
import { Icon } from '../components/icons';
import { gameDefs, gameDef, gameShelves, gameStatusLine, isMyTurn } from '../games/registry';
import { useGame } from '../games/useGame';
import { Basics, HowToPlay, LearnToggle, useLearn } from '../games/learn';
import { BANDS, bandLabel, defaultBand, rememberBand, type Band } from '../games/bands';
import { confirmFirst } from '../components/confirm';
import { useLongPress } from '../components/longPress';
import type { GameDef, Mode } from '../games/common';

export function GamesHub({ gameId }: { gameId?: number }) {
  if (gameId) return <GameView key={gameId} id={gameId} />;
  return <GameList />;
}

function GameList() {
  const { games, me, rooms } = useStore();
  // The New game dialog: closed, open at the list, or open at one game picked from the shelf.
  const [creating, setCreating] = useState<false | { type?: string }>(false);
  const mine = games.filter((g) => isMyTurn(g, me.id));
  const playing = games.filter((g) => g.status === 'active' && !isMyTurn(g, me.id));
  const finished = games.filter((g) => g.status === 'finished');
  const canStart = me.permissions.start_games && me.permissions.play_games;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Games</h1>
        {canStart && rooms.length > 0 && (
          <Button icon="plus" variant="primary" size="sm" onClick={() => setCreating({})}>
            New game
          </Button>
        )}
      </header>

      {!me.permissions.play_games && <Notice tone="info">Games are switched off for you just now. {whoCanChange(me.role)} can switch them on.</Notice>}

      {games.length === 0 ? (
        <>
          <EmptyState art="🎲" title="No games yet">
            <p>Start one and everyone in the chat can join in. Most games are played together, as a team.</p>
          </EmptyState>
          {canStart && <GameShelf onPick={(type) => setCreating({ type })} />}
        </>
      ) : (
        <>
          {mine.length > 0 && <GameSection title="Your turn" games={mine} />}
          {playing.length > 0 && <GameSection title="Playing" games={playing} />}
          {finished.length > 0 && <GameSection title="Finished" games={finished} />}
          <p className="muted games-hint">
            To take a game off your list, press and hold it, or right-click it. A game nobody has played for two days is put away as finished.
          </p>
        </>
      )}
      <NewGameDialog open={!!creating} start={creating ? creating.type : undefined} onClose={() => setCreating(false)} />
    </div>
  );
}

function GameShelf({ onPick }: { onPick: (type: string) => void }) {
  return (
    <ul className="shelf">
      {gameDefs.map((d) => (
        <li key={d.type}>
          <button type="button" className="shelf-item sheet" onClick={() => onPick(d.type)}>
            <span className="shelf-art" aria-hidden="true">
              {d.emoji}
            </span>
            <strong>{d.name}</strong>
            <span className="muted">{d.blurb}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function GameSection({ title, games }: { title: string; games: Game[] }) {
  return (
    <section className="game-section">
      <h2 className="section-label">{title}</h2>
      <ul className="game-list">
        {games.map((g) => (
          <GameItem key={g.id} game={g} />
        ))}
      </ul>
    </section>
  );
}

function GameItem({ game: g }: { game: Game }) {
  const { me, people, rooms, refreshGames, toast } = useStore();
  const def = gameDef(g.type);
  const room = rooms.find((r) => r.id === g.room_id);
  const players = Object.values(g.seats).filter((s): s is number => typeof s === 'number');
  const press = useLongPress(() => removeGame(g, me, { refreshGames, toast }));
  return (
    <li>
      <a className="game-item sheet" href={`#/games/${g.id}`} data-turn={isMyTurn(g, me.id) || undefined} {...press}>
        <span className="game-item-art" aria-hidden="true">
          {def?.emoji ?? '🎲'}
        </span>
        <span className="game-item-text">
          <strong>{g.title || def?.name || 'Game'}</strong>
          <span className="muted">{gameStatusLine(g, me.id, people)}</span>
          <span className="game-item-room">
            {room ? `${room.emoji} ${room.name}` : ''} · {ago(g.updated_at)}
          </span>
        </span>
        <span className="game-item-faces" aria-hidden="true">
          {g.mode === 'coop' && !players.length && <span className="pill">Together</span>}
          {players.slice(0, 3).map((id) => (
            <Avatar key={id} person={people.get(id)} size="xs" />
          ))}
        </span>
      </a>
    </li>
  );
}

/** Whether someone may stop a game for everyone: whoever started it, anyone playing in a seat, or an admin. */
const mayStop = (g: Game, me: Me) => g.created_by_id === me.id || Object.values(g.seats).includes(me.id) || !!me.permissions.manage_people;

/**
 * Takes a game off this person's list, asking first. A game still going stops
 * for everyone if they may stop it; otherwise it carries on for the others.
 */
async function removeGame(
  g: Game,
  me: Me,
  { refreshGames, toast }: { refreshGames: () => Promise<void>; toast: (t: string, tone?: 'success' | 'danger') => void },
): Promise<boolean> {
  const name = g.title || gameDef(g.type)?.name || 'this game';
  const stops = g.status === 'active' && mayStop(g, me);
  const yes =
    g.status !== 'active'
      ? await confirmFirst(`Take ${name} off your list?`, 'Remove', 'It stays in the chat.')
      : stops
        ? await confirmFirst(`Stop ${name} and take it off your list?`, 'Stop and remove', 'It stops for everyone playing.')
        : await confirmFirst(`Take ${name} off your list?`, 'Remove from my list', 'It carries on for everyone else.');
  if (!yes) return false;
  try {
    const res = await api.post<{ stopped: boolean }>(`/api/games/${g.id}/remove`);
    await refreshGames();
    toast(res.stopped ? `Stopped ${name} and took it off your list.` : `Took ${name} off your list.`, 'success');
    return true;
  } catch (e) {
    toast((e as Error).message, 'danger');
    return false;
  }
}

function GameView({ id }: { id: number }) {
  const { me, people, rooms, refreshGames, toast } = useStore();
  const { game, error, play } = useGame<Record<string, unknown>>(id);
  const def = game ? gameDef(game.type) : undefined;
  const room = game ? rooms.find((r) => r.id === game.room_id) : undefined;
  const [learning, setLearning] = useState(false);
  const learn = useLearn(game?.type ?? '');

  return (
    <div className="game-view">
      <header className="room-head game-head">
        <a className="icon-btn btn-ghost" href="#/games" aria-label="Back to games">
          <Icon name="back" />
        </a>
        <span className="room-emoji" aria-hidden="true">
          {def?.emoji ?? '🎲'}
        </span>
        <div className="room-title">
          <h1>{game?.title || def?.name || 'Game'}</h1>
          <p className="muted room-sub">
            {game ? (
              <>
                <span>{def?.modeLabels?.[game.mode] ?? (Object.values(game.seats).includes('computer') ? 'Against the computer' : game.mode === 'coop' ? 'Together' : 'Against each other')}</span>
                {room && (
                  <>
                    <span aria-hidden="true">·</span>
                    <a href={`#/chats/${room.id}`}>
                      {room.emoji} {room.name}
                    </a>
                  </>
                )}
              </>
            ) : (
              ' '
            )}
          </p>
        </div>
        {def?.guide && (
          <>
            <IconButton icon="book" label="How to play" onClick={() => setLearning(true)} />
            <HowToPlay
              game={def.type}
              name={def.name}
              emoji={def.emoji}
              guide={def.guide}
              learns={!!def.basics}
              open={learning}
              onClose={() => setLearning(false)}
            />
          </>
        )}
        {game && (
          <IconButton
            icon="trash"
            label={game.status === 'active' && mayStop(game, me) ? 'Stop and remove this game' : 'Take this game off your list'}
            onClick={async () => {
              if (await removeGame(game, me, { refreshGames, toast })) go({ name: 'games' });
            }}
          />
        )}
      </header>
      <div className="game-body">
        {error && <Notice tone="danger">{error}</Notice>}
        {!game && !error && <Spinner label="Loading the game" />}
        {game && def?.basics && learn && game.status === 'active' && <Basics game={def.type} gameId={game.id} lessons={def.basics} />}
        {game && def && (
          <BoardGuard>
            <def.Board game={game} play={play} me={me} people={people} room={room} />
          </BoardGuard>
        )}
        {game && !def && <Notice tone="warning">This game needs a newer version of the app. Try reloading.</Notice>}
      </div>
    </div>
  );
}

/** Keeps a game that goes wrong on this device from taking the rest of the app with it. */
class BoardGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Notice tone="warning">
        <p>Something went wrong showing this game on this device. Reloading the app usually sorts it out.</p>
        <Button size="sm" icon="refresh" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </Notice>
    );
  }
}

export function NewGameDialog({ open, onClose, roomId, start: startWith }: { open: boolean; onClose: () => void; roomId?: number; start?: string }) {
  const { rooms, me, people, toast, refreshGames } = useStore();
  const [def, setDef] = useState<GameDef | null>(null);
  const [mode, setMode] = useState<Mode>('coop');
  const [room, setRoom] = useState<number | undefined>(roomId);
  const [options, setOptions] = useState<unknown>(null);
  const [band, setBand] = useState<Band>(() => defaultBand(me));
  const [busy, setBusy] = useState(false);
  const learn = useLearn(def?.type ?? '');

  const playable = rooms.filter((r) => r.member && !r.closed);
  const target = playable.find((r) => r.id === (room ?? roomId)) ?? playable[0];

  useEffect(() => {
    if (!open) {
      setDef(null);
      setBusy(false);
      setRoom(roomId);
    } else {
      setBand(defaultBand(me));
      const first = startWith ? gameDef(startWith) : undefined;
      if (first) choose(first);
    }
  }, [open, roomId]);

  const defaults = useMemo(
    () => (def && target ? def.defaults({ me, room: target, mode, band }) : null),
    // Fresh options when the game, mode or room changes; a new band only adjusts them.
    [def, mode, target?.id],
  );
  useEffect(() => setOptions(defaults), [defaults]);

  function chooseBand(b: Band) {
    setBand(b);
    if (def?.rebanded && options != null) setOptions(def.rebanded(options, b));
  }

  function choose(d: GameDef) {
    setDef(d);
    setMode(d.modes[0]);
  }

  async function start() {
    if (!def || !target) return;
    setBusy(true);
    try {
      const made = await def.create(options, { me, room: target, mode, band, people });
      rememberBand(band);
      const res = await api.post<{ game: Game }>(`/api/rooms/${target.id}/games`, {
        type: def.type,
        ...made,
        mode: made.mode ?? mode,
        state: { ...(made.state as object), band },
      });
      await refreshGames();
      onClose();
      go({ name: 'games', gameId: res.game.id });
    } catch (e) {
      toast((e as Error).message, 'danger');
      setBusy(false);
    }
  }

  const ready = !def?.ready || (options != null && def.ready(options));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={def ? `${def.emoji} ${def.name}` : 'New game'}
      footer={
        def ? (
          <>
            <Button onClick={() => setDef(null)}>Other games</Button>
            <Button variant="primary" icon="sparkle" busy={busy} disabled={!ready || options == null} onClick={start}>
              Start
            </Button>
          </>
        ) : undefined
      }
    >
      {!def ? (
        <div className="game-shelves">
          {gameShelves.map((shelf, i) => (
            <section key={shelf.title} className="game-shelf" aria-labelledby={`shelf-${i}`}>
              <h3 className="section-label" id={`shelf-${i}`}>
                {shelf.title}
              </h3>
              <ul className="game-picker">
                {shelf.games.map((d) => (
                  <li key={d.type}>
                    <button type="button" className="game-pick" onClick={() => choose(d)}>
                      <span className="game-pick-art" aria-hidden="true">
                        {d.emoji}
                      </span>
                      <span className="game-pick-text">
                        <strong>{d.name}</strong>
                        <span className="muted">{d.blurb}</span>
                        <span className="game-pick-tags">
                          {d.modes.includes('coop') && <span className="pill pill-coop">{d.modeLabels?.coop ?? 'Together'}</span>}
                          {d.modes.includes('versus') && <span className="pill">{d.modeLabels?.versus ?? 'Against each other'}</span>}
                          <span className="pill pill-quiet">{d.players}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="stack">
          <p className="lede">{def.blurb}</p>
          {!roomId && playable.length > 1 && (
            <Field label="Play in">
              {(p) => (
                <Select {...p} value={target?.id} onChange={(e) => setRoom(Number(e.target.value))}>
                  {playable.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.emoji} {r.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {def.modes.length > 1 && (
            <div className="field">
              <span className="field-label">Playing</span>
              <Segmented
                label="Playing"
                value={mode}
                onChange={setMode}
                options={def.modes.map((m) => ({
                  value: m,
                  label: def.modeLabels?.[m] ?? (m === 'coop' ? 'Together' : 'Against each other'),
                  icon: def.modeIcons?.[m] ?? (m === 'coop' ? 'team' : 'people'),
                }))}
              />
            </div>
          )}
          <div className="field">
            <span className="field-label">Ages</span>
            <Segmented label="Ages" value={band} onChange={chooseBand} options={BANDS.map((b) => ({ value: b, label: bandLabel[b] }))} />
            <p className="field-hint">{def.bands[band]}</p>
          </div>
          {def.Options && options != null && target && (
            <def.Options value={options} onChange={setOptions} mode={mode} band={band} room={target} me={me} people={people} />
          )}
          {def.basics && <LearnToggle game={def.type} checked={learn} />}
        </div>
      )}
    </Dialog>
  );
}
