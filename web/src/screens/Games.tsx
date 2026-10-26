import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { whoCanChange } from '../lib/permissions';
import { api } from '../lib/api';
import { go } from '../lib/router';
import { ago } from '../lib/time';
import type { Game, Me, Person, Room } from '../lib/types';
import { Avatar, Button, Dialog, EmptyState, IconButton, Notice, Segmented, Spinner } from '../components/ui';
import { Icon } from '../components/icons';
import { gameDefs, gameDef, gameShelves, gameStatusLine, isMyTurn } from '../games/registry';
import { useGame } from '../games/useGame';
import { Basics, HowToPlay, LearnToggle, useLearn } from '../games/learn';
import { BANDS, bandLabel, defaultBand, rememberBand, type Band } from '../games/bands';
import { confirmFirst } from '../components/confirm';
import { useLongPress } from '../components/longPress';
import { listNames, startedHere, type GameDef, type Mode } from '../games/common';
import { mayTalk } from '../lib/contacts';

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
  // Games you're in, as yourself or with the family, and games you can only watch.
  const inIt = (g: Game) => {
    const seats = Object.values(g.seats);
    return !seats.length || seats.includes(me.id) || seats.includes('team') || seats.includes('open');
  };
  const waiting = playing.filter(inIt);
  const watching = playing.filter((g) => !inIt(g));
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
          {waiting.length > 0 && <GameSection title="Waiting for others" games={waiting} />}
          {watching.length > 0 && <GameSection title="Others are playing" games={watching} />}
          {finished.length > 0 && <GameSection title="Pictures and stories" games={finished} />}
          <p className="muted games-hint">
            Games go from the list when they're over, except the pictures and stories they made. To take one off your list sooner, press and hold it, or
            right-click it. A game nobody has played for two days is put away.
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
  const { me, people, rooms, games, refreshGames, toast } = useStore();
  const { game, error, play } = useGame<Record<string, unknown>>(id);
  const def = game ? gameDef(game.type) : undefined;
  const room = game ? rooms.find((r) => r.id === game.room_id) : undefined;
  const [learning, setLearning] = useState(false);
  const learn = useLearn(game?.type ?? '');

  // When someone presses Play again, everyone looking at the game moves on
  // to the next round together. Opening an old game later offers it instead.
  const seen = useRef<Game | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = game;
    if (!game?.next_id || before?.id !== game.id || before.next_id) return;
    if (!startedHere.has(game.id)) toast('On to the next round, all together.', 'info');
    go({ name: 'games', gameId: game.next_id });
  }, [game, toast]);
  const next = game?.status === 'finished' && game.next_id ? games.find((g) => g.id === game.next_id && g.status === 'active') : undefined;

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
        {next && (
          <Notice tone="info">
            <p>The next round has started.</p>
            <Button size="sm" variant="primary" icon="forward" onClick={() => go({ name: 'games', gameId: next.id })}>
              Join the next round
            </Button>
          </Notice>
        )}
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

/** Who's playing: just me against the computer, everyone in a chat together, or chosen people against each other. */
type Who = 'solo' | 'team' | 'people';

interface WhoChoice {
  value: Who;
  art: string;
  label: string;
  hint: string;
}

function whoChoices(def: GameDef): WhoChoice[] {
  const out: WhoChoice[] = [];
  if (def.modes.includes('coop'))
    out.push(
      def.against
        ? { value: 'team', art: '👨‍👩‍👧', label: `The family against ${def.against}`, hint: "Everyone in the chat plays for the family: anyone can make the family's move." }
        : { value: 'team', art: '👨‍👩‍👧', label: def.modeLabels?.coop ?? 'Together', hint: 'Everyone in the chat plays as one team.' },
    );
  if (def.against) out.push({ value: 'solo', art: '🙋', label: `Just me against ${def.against}`, hint: "Only you play, and it isn't on anyone else's list." });
  if (def.modes.includes('versus') && def.most)
    out.push({
      value: 'people',
      art: '🧑‍🤝‍🧑',
      label: def.most === 2 ? 'Against someone' : (def.modeLabels?.versus ?? 'Against each other'),
      hint: def.most === 2 ? "Choose who, and it's played in your chat with them." : `Choose up to ${def.most - 1} people. Turns go round.`,
    });
  return out;
}

/** "You and Mia" for a chat for two, otherwise the chat's name. */
function chatName(room: Room, me: Me, people: Map<number, Person>): string {
  if (room.kind !== 'direct') return room.name;
  const other = room.member_ids.find((id) => id !== me.id);
  return `You and ${(other != null && people.get(other)?.name) || room.name}`;
}

/**
 * The chat a game for these people goes in: your chat with one person (none
 * yet means one gets started, if you may), or the smallest chat with them all in.
 */
function chatFor(picked: number[], rooms: Room[], mayStart: (id: number) => boolean): Room | undefined {
  if (picked.length === 1) {
    const direct = rooms.find((r) => r.kind === 'direct' && r.member_ids.includes(picked[0]));
    if (direct || mayStart(picked[0])) return direct;
  }
  return rooms.filter((r) => picked.every((id) => r.member_ids.includes(id))).sort((a, b) => a.member_ids.length - b.member_ids.length)[0];
}

export function NewGameDialog({ open, onClose, roomId, start: startWith }: { open: boolean; onClose: () => void; roomId?: number; start?: string }) {
  const { rooms, me, people, bubbles, friendships, toast, refreshGames, refreshRooms } = useStore();
  const [def, setDef] = useState<GameDef | null>(null);
  const [who, setWho] = useState<Who>('team');
  const [chat, setChat] = useState<number | undefined>(roomId);
  const [picked, setPicked] = useState<number[]>([]);
  const [options, setOptions] = useState<unknown>(null);
  const [band, setBand] = useState<Band>(() => defaultBand(me));
  const [busy, setBusy] = useState(false);
  const learn = useLearn(def?.type ?? '');

  const playable = rooms.filter((r) => r.member && !r.closed);
  const here = playable.find((r) => r.id === roomId);
  const family = playable.find((r) => r.kind === 'family') ?? playable[0];
  // Everyone you could play with: people in your chats, and anyone you may start a chat with.
  const talks = (id: number) => {
    const p = people.get(id);
    return !!p && mayTalk(me, p, { bubbles, friendships });
  };
  const players = [...new Set([...playable.flatMap((r) => r.member_ids), ...[...people.keys()].filter(talks)])].filter((id) => {
    const p = people.get(id);
    return id !== me.id && p && p.active !== false && p.permissions?.play_games !== false;
  });

  const choices = def ? whoChoices(def) : [];
  const mode: Mode = who === 'people' ? 'versus' : def && !def.modes.includes('coop') ? def.modes[0] : 'coop';
  const target =
    who === 'people' ? chatFor(picked, playable, talks) : who === 'solo' ? (here ?? family) : (playable.find((r) => r.id === chat) ?? here ?? family);
  const most = def?.most ?? 2;

  useEffect(() => {
    if (!open) {
      setDef(null);
      setBusy(false);
      setChat(roomId);
      setPicked([]);
    } else {
      setBand(defaultBand(me));
      const first = startWith ? gameDef(startWith) : undefined;
      if (first) choose(first);
    }
  }, [open, roomId]);

  const defaults = useMemo(
    () => (def && (target ?? family) ? def.defaults({ me, room: (target ?? family)!, mode, band }) : null),
    // Fresh options when the game or how it's played changes; a new band only adjusts them.
    [def, mode],
  );
  useEffect(() => setOptions(defaults), [defaults]);

  function chooseBand(b: Band) {
    setBand(b);
    if (def?.rebanded && options != null) setOptions(def.rebanded(options, b));
  }

  function choose(d: GameDef) {
    setDef(d);
    const can = whoChoices(d).map((c) => c.value);
    // Started from a chat for two: against them if the game allows it, otherwise together.
    const other = here?.kind === 'direct' ? here.member_ids.find((id) => id !== me.id) : undefined;
    if (other != null && can.includes('people')) {
      setWho('people');
      setPicked([other]);
    } else {
      setWho(can.includes('team') ? 'team' : (can[0] ?? 'team'));
      setPicked([]);
    }
  }

  function toggle(id: number) {
    setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : now.length + 1 < most ? [...now, id] : most === 2 ? [id] : now));
  }

  // The who goes into the game's own options, however each game keeps it.
  const chosen = options == null ? null : { ...(options as object), mode, who: who === 'solo' ? 'me' : 'team', players: picked, opponent: picked[0] ?? 'open' };
  const missing = who === 'people' && (!picked.length || (!target && !(picked.length === 1 && talks(picked[0]))));
  const ready = !missing && chosen != null && (!def?.ready || def.ready(chosen));

  async function start() {
    if (!def || !chosen) return;
    setBusy(true);
    try {
      let room = target;
      if (!room && who === 'people' && picked.length === 1) {
        // No chat with them yet: start one, like Message on their page does.
        const res = await api.post<{ room_id: number }>(`/api/rooms/direct/${picked[0]}`);
        await refreshRooms();
        room = { id: res.room_id, name: people.get(picked[0])?.name ?? '', kind: 'direct', emoji: '💬', created_by_id: me.id, member_ids: [me.id, picked[0]], member: true, unread: 0, last_message: null, last_message_at: null };
      }
      if (!room) return;
      const made = await def.create(chosen, { me, room, mode, band, people });
      rememberBand(band);
      const res = await api.post<{ game: Game }>(`/api/rooms/${room.id}/games`, {
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
    } finally {
      setBusy(false);
    }
  }

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
            <Button variant="primary" icon="sparkle" busy={busy} disabled={!ready} onClick={start}>
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
          {choices.length > 1 && (
            <fieldset className="fieldset">
              <legend>Who's playing?</legend>
              <div className="who-picks" role="radiogroup" aria-label="Who's playing?">
                {choices.map((c) => (
                  <button key={c.value} type="button" role="radio" aria-checked={who === c.value} className="who-pick" onClick={() => setWho(c.value)}>
                    <span className="who-pick-art" aria-hidden="true">
                      {c.art}
                    </span>
                    <span className="who-pick-text">
                      <strong>{c.label}</strong>
                      <span className="muted">{c.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {who === 'people' ? (
            <fieldset className="fieldset vs-pick">
              <legend>{most === 2 ? 'Playing against' : 'Playing with you'}</legend>
              <div className="vs-chips">
                {players.map((id) => {
                  const on = picked.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`vs-chip tint-${people.get(id)?.colour ?? 'slate'}`}
                      aria-pressed={on}
                      disabled={!on && most > 2 && picked.length + 1 >= most}
                      onClick={() => toggle(id)}
                    >
                      <Avatar person={people.get(id)} size="xs" />
                      <span>{people.get(id)?.name}</span>
                    </button>
                  );
                })}
              </div>
              <p className="field-hint">
                {!picked.length
                  ? most === 2
                    ? 'Choose who to play.'
                    : 'Choose who to play with.'
                  : target
                    ? `It's played in ${target.kind === 'direct' ? 'your chat with them' : target.name}.`
                    : picked.length === 1 && talks(picked[0])
                      ? `It starts a chat for you and ${people.get(picked[0])?.name}.`
                      : "There's no chat with all of them in. Start a group chat with them first, or choose fewer people."}
              </p>
            </fieldset>
          ) : who === 'solo' ? null : (
            playable.length > 1 && (
              <fieldset className="fieldset vs-pick">
                <legend>{def.against ? 'Which family?' : 'Who with?'}</legend>
                <div className="vs-chips" role="radiogroup" aria-label={def.against ? 'Which family?' : 'Who with?'}>
                  {playable.map((r) => (
                    <button key={r.id} type="button" role="radio" aria-checked={r.id === target?.id} className="vs-chip vs-chip-chat" onClick={() => setChat(r.id)}>
                      <span aria-hidden="true">{r.emoji}</span>
                      <span>{chatName(r, me, people)}</span>
                    </button>
                  ))}
                </div>
                {target && (
                  <p className="field-hint">
                    Everyone in {target.kind === 'direct' ? 'your chat' : target.name}:{' '}
                    {listNames(target.member_ids.map((id) => (id === me.id ? 'you' : (people.get(id)?.name ?? 'someone'))))}.
                  </p>
                )}
              </fieldset>
            )
          )}

          <div className="field">
            <span className="field-label">Ages</span>
            <Segmented label="Ages" value={band} onChange={chooseBand} options={BANDS.map((b) => ({ value: b, label: bandLabel[b] }))} />
            <p className="field-hint">{def.bands[band]}</p>
          </div>
          {def.Options && chosen != null && (target ?? family) && (
            <def.Options value={chosen} onChange={setOptions} mode={mode} band={band} room={(target ?? family)!} me={me} people={people} />
          )}
          {def.basics && <LearnToggle game={def.type} checked={learn} />}
        </div>
      )}
    </Dialog>
  );
}
