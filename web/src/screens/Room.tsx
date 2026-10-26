import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useStore, usePerson } from '../lib/store';
import { whoCanChange } from '../lib/permissions';
import { api } from '../lib/api';
import { join } from '../lib/socket';
import { dayLabel, sameDay, timeOf } from '../lib/time';
import { canSpeak, speak, stopSpeaking } from '../lib/speech';
import { preparePhoto, upload } from '../lib/image';
import type { Game, Message, Person, Room } from '../lib/types';
import { mayTalk, whyNot } from '../lib/contacts';
import { Avatar, Button, Dialog, EmptyState, Field, IconButton, Input, Notice, Spinner } from '../components/ui';
import { Icon } from '../components/icons';
import { DoodleEditor, type DoodleBackground } from '../components/DoodleEditor';
import { confirmFirst } from '../components/confirm';
import { NewGameDialog } from './Games';
import { gameDef, gameStatusLine, isMyTurn } from '../games/registry';

const PAGE = 60;

export function RoomView({ room }: { room: Room }) {
  const { me, people, online, activeRoom, markRoomRead, games, refreshRooms, toast } = useStore();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [viewing, setViewing] = useState<Message | null>(null);
  const [doodle, setDoodle] = useState<DoodleBackground | 'blank' | null>(null);
  const [newGame, setNewGame] = useState(false);
  const [typing, setTyping] = useState<Map<number, number>>(new Map());
  const [editing, setEditing] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [unseen, setUnseen] = useState(0);
  // An admin reading a chat they aren't in: no writing, reacting or calling.
  const reading = !room.member;

  // Load the latest page and listen for new messages.
  useEffect(() => {
    let alive = true;
    activeRoom.current = room.id;
    const load = () => {
      api
        .get<{ messages: Message[] }>(`/api/rooms/${room.id}/messages`)
        .then((res) => {
          if (!alive) return;
          setMessages(res.messages);
          setHasMore(res.messages.length >= PAGE);
        })
        .catch((e) => alive && setError(e.message));
    };
    load();

    const [channel, leave] = join(`room:${room.id}`);
    // Someone's account was removed, taking their messages with it.
    const onReload = channel.on('messages:reload', load);
    const onNew = channel.on('message:new', (m: Message) => {
      setMessages((ms) => (ms && !ms.some((x) => x.id === m.id) ? [...ms, m] : ms));
      setTyping((t) => {
        if (!m.user_id || !t.has(m.user_id)) return t;
        const n = new Map(t);
        n.delete(m.user_id);
        return n;
      });
      if (!pinned.current && m.user_id !== me.id) setUnseen((n) => n + 1);
    });
    const onUpdated = channel.on('message:updated', (m: Message) => {
      setMessages((ms) => ms && ms.map((x) => (x.id === m.id ? m : x)));
    });
    const onTyping = channel.on('typing', ({ user_id }: { user_id: number }) => {
      setTyping((t) => new Map(t).set(user_id, Date.now()));
    });

    return () => {
      alive = false;
      if (activeRoom.current === room.id) activeRoom.current = null;
      channel.off('message:new', onNew);
      channel.off('message:updated', onUpdated);
      channel.off('typing', onTyping);
      channel.off('messages:reload', onReload);
      leave();
      stopSpeaking();
    };
  }, [room.id, activeRoom, me.id]);

  // Forget typing after a few quiet seconds.
  useEffect(() => {
    if (!typing.size) return;
    const t = window.setInterval(() => {
      setTyping((m) => {
        const now = Date.now();
        const n = new Map([...m].filter(([, at]) => now - at < 4500));
        return n.size === m.size ? m : n;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [typing.size]);

  // Mark as read whenever the newest message changes while we're looking.
  const lastId = messages?.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (lastId == null || reading) return;
    const mark = () => document.visibilityState === 'visible' && markRoomRead(room.id, lastId);
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [lastId, reading, room.id, markRoomRead]);

  // Stay at the bottom as messages arrive, unless reading further up.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = list.current!;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (pinned.current && unseen) setUnseen(0);
  }

  function toBottom() {
    const el = list.current!;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setUnseen(0);
  }

  async function loadOlder() {
    if (!messages?.length) return;
    setLoadingOlder(true);
    const el = list.current!;
    const before = el.scrollHeight;
    try {
      const res = await api.get<{ messages: Message[] }>(`/api/rooms/${room.id}/messages?before=${messages[0].id}`);
      setHasMore(res.messages.length >= PAGE);
      setMessages((ms) => [...res.messages, ...(ms ?? [])]);
      requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - before));
    } finally {
      setLoadingOlder(false);
    }
  }

  const sent = useCallback((m: Message) => {
    pinned.current = true;
    setMessages((ms) => (ms && !ms.some((x) => x.id === m.id) ? [...ms, m] : ms));
  }, []);

  const others = room.member_ids.filter((id) => id !== me.id).map((id) => people.get(id)).filter(Boolean);
  const direct = room.kind === 'direct' && !reading ? others[0] : undefined;
  const onlineNames = others.filter((p) => online.has(p!.id)).map((p) => p!.name);
  const typingNames = [...typing.keys()].map((id) => people.get(id)?.name).filter(Boolean);
  // The kids someone reading looks after: kids from their own family.
  const myKids = others.filter((p) => p!.role === 'kid' && p!.bubble_id === me.bubble_id).map((p) => p!.name);
  const canEdit = !reading && room.kind === 'group' && (room.created_by_id === me.id || me.role === 'admin');

  const gamesById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  // Games sit above the chat rather than in it, so starting one doesn't fill it up.
  const going = games.filter((g) => g.room_id === room.id && g.status === 'active' && !gameDef(g.type)?.solo);

  async function toggleMuted() {
    const muted = !room.muted;
    try {
      await api.put(`/api/rooms/${room.id}/muted`, { muted });
      await refreshRooms();
      toast(muted ? 'This chat is muted.' : "This chat isn't muted now.", 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <div className="room">
      <header className="room-head">
        <a className="icon-btn btn-ghost back" href="#/chats" aria-label="Back to chats">
          <Icon name="back" />
        </a>
        {direct ? (
          <Avatar person={direct} online={online.has(direct.id)} />
        ) : (
          <span className="room-emoji" aria-hidden="true">
            {room.emoji}
          </span>
        )}
        <div className="room-title">
          <h1>{room.name}</h1>
          <p className="muted">
            {typingNames.length
              ? `${typingNames.join(' and ')} ${typingNames.length > 1 ? 'are' : 'is'} writing…`
              : direct
                ? online.has(direct.id)
                  ? 'Here now'
                  : 'Away'
                : onlineNames.length
                  ? `${onlineNames.join(', ')} here now`
                  : room.member_ids.length === 1
                    ? 'Just you so far'
                    : `${room.member_ids.length} people`}
          </p>
        </div>
        <div className="room-faces" aria-hidden="true">
          {!direct &&
            others.slice(0, 5).map((p) => <Avatar key={p!.id} person={p} size="xs" online={online.has(p!.id)} />)}
        </div>
        {me.permissions.video_calls &&
          !reading &&
          !room.closed &&
          room.member_ids.length > 1 &&
          (room.call ? (
            <a className="btn btn-call btn-sm join-call" href={`#/call/${room.id}`}>
              <span className="live-dot" aria-hidden="true" />
              Join call
            </a>
          ) : (
            <a className="icon-btn btn-ghost" href={`#/call/${room.id}`} aria-label="Start a video call" data-tip="Start a video call">
              <Icon name="video" />
            </a>
          ))}
        {!reading && room.member_ids.length > 1 && (
          <IconButton icon={room.muted ? 'quiet' : 'bell'} label="Mute this chat" pressed={Boolean(room.muted)} onClick={toggleMuted} />
        )}
        {canEdit && <IconButton icon="pen" label="Change group" onClick={() => setEditing(true)} />}
      </header>

      {!reading && going.length > 0 && (
        <nav className="room-games" aria-label="Games in this chat">
          {going.slice(0, 3).map((g) => {
            const def = gameDef(g.type);
            return (
              <a key={g.id} className="room-game" href={`#/games/${g.id}`} data-turn={isMyTurn(g, me.id) || undefined}>
                <span aria-hidden="true">{def?.emoji ?? '🎲'}</span>
                <span className="room-game-text">
                  <strong>{def?.name ?? 'A game'}</strong> · {gameStatusLine(g, me.id, people)}
                </span>
              </a>
            );
          })}
          {going.length > 3 && (
            <a className="room-game" href="#/games">
              {going.length - 3} more
            </a>
          )}
        </nav>
      )}

      <div className="messages" ref={list} onScroll={onScroll} onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
        {error && <Notice tone="danger">{error}</Notice>}
        {!messages && !error && (
          <div className="center-pad">
            <Spinner label="Loading messages" />
          </div>
        )}
        {hasMore && (
          <div className="center-pad">
            <Button size="sm" onClick={loadOlder} busy={loadingOlder}>
              Show earlier messages
            </Button>
          </div>
        )}
        {messages && messages.length === 0 &&
          (reading ? (
            <EmptyState art={room.emoji} title="Nothing here yet">
              <p>Nobody has written in this chat yet.</p>
            </EmptyState>
          ) : (
            <EmptyState art={room.emoji} title="Say hello">
              <p>This is the start of {room.kind === 'direct' ? `your chat with ${room.name}` : room.name}.</p>
            </EmptyState>
          ))}
        {messages?.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || !sameDay(prev.inserted_at, m.inserted_at);
          const grouped =
            !newDay &&
            prev &&
            prev.user_id === m.user_id &&
            prev.kind !== 'system' &&
            prev.kind !== 'game' &&
            new Date(m.inserted_at).getTime() - new Date(prev.inserted_at).getTime() < 5 * 60_000;
          return (
            <div key={m.id}>
              {newDay && (
                <div className="day">
                  <span>{dayLabel(m.inserted_at)}</span>
                </div>
              )}
              <MessageItem
                message={m}
                grouped={!!grouped}
                showName={!direct}
                selected={selected === m.id}
                onSelect={() => setSelected(selected === m.id ? null : m.id)}
                onReply={() => {
                  setReplyTo(m);
                  setSelected(null);
                }}
                onView={() => setViewing(m)}
                onDoodle={(bg) => {
                  setSelected(null);
                  setDoodle(bg);
                }}
                game={m.game_id ? gamesById.get(m.game_id) : undefined}
                allMessages={messages}
                readOnly={reading}
              />
            </div>
          );
        })}
      </div>

      {unseen > 0 && (
        <button type="button" className="new-below" onClick={toBottom}>
          {unseen} new {unseen === 1 ? 'message' : 'messages'} <Icon name="back" size={16} style={{ transform: 'rotate(-90deg)' }} />
        </button>
      )}

      {reading ? (
        <div className="composer composer-off">
          <Icon name="eye" />{' '}
          {me.permissions.manage_people || !myKids.length
            ? "You're reading this as an admin."
            : `You're reading this because ${listNames(myKids)} ${myKids.length > 1 ? 'are' : 'is'} in it.`}{' '}
          You're not in this chat, so you can't write here, and nobody sees you reading.
        </div>
      ) : room.closed ? (
        <div className="composer composer-off" role="status">
          <Icon name="lock" /> This chat is closed. {room.closed} You can still read what's here.
        </div>
      ) : (
        <Composer
          room={room}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSent={(m) => {
            setReplyTo(null);
            sent(m);
          }}
          onDoodle={(bg) => setDoodle(bg ?? 'blank')}
          onGame={() => setNewGame(true)}
        />
      )}

      {viewing && (
        <PhotoViewer
          message={viewing}
          onClose={() => setViewing(null)}
          onDoodle={
            me.permissions.doodle && !me.quiet_now && !reading
              ? () => {
                  const m = viewing;
                  setViewing(null);
                  setDoodle({ url: m.media!.url, width: m.media!.width, height: m.media!.height, messageId: m.id });
                }
              : undefined
          }
        />
      )}
      {doodle && (
        <DoodleEditor
          roomId={room.id}
          background={doodle === 'blank' ? null : doodle}
          onClose={() => setDoodle(null)}
          onSent={(m) => {
            setDoodle(null);
            sent(m);
          }}
        />
      )}
      <NewGameDialog open={newGame} onClose={() => setNewGame(false)} roomId={room.id} />
      {canEdit && <EditGroup room={room} open={editing} onClose={() => setEditing(false)} />}
    </div>
  );
}

function MessageItem({
  message: m,
  grouped,
  showName,
  selected,
  onSelect,
  onReply,
  onView,
  onDoodle,
  game,
  allMessages,
  readOnly,
}: {
  message: Message;
  grouped: boolean;
  showName: boolean;
  selected: boolean;
  onSelect: () => void;
  onReply: () => void;
  onView: () => void;
  onDoodle: (bg: DoodleBackground) => void;
  game?: Game;
  allMessages: Message[];
  readOnly: boolean;
}) {
  const { me, reactions, people, toast } = useStore();
  const author = usePerson(m.user_id);
  const mine = m.user_id === me.id;
  const [speaking, setSpeaking] = useState(false);

  if (m.kind === 'system') {
    return (
      <p className="system-line">
        {m.game_id ? '🏁 ' : ''}
        {m.body}
        {m.game_id && !readOnly && (
          <>
            {' '}
            <a href={`#/games/${m.game_id}`}>See the game</a>
          </>
        )}
      </p>
    );
  }

  if (m.kind === 'call') return <CallNote m={m} readOnly={readOnly} />;

  if (m.kind === 'game') {
    const def = game ? gameDef(game.type) : undefined;
    const note = (
      <>
        <span className="game-note-art" aria-hidden="true">
          {def?.emoji ?? '🎲'}
        </span>
        <span className="game-note-text">
          <strong>
            {author?.name ?? 'Someone'} started {def?.name ?? 'a game'}
          </strong>
          <span className="muted">{game ? gameStatusLine(game, me.id, people) : readOnly ? 'A game in this chat' : 'Tap to open'}</span>
        </span>
        {!readOnly && <span className="btn btn-primary btn-sm">{game?.status === 'finished' ? 'See it' : 'Play'}</span>}
      </>
    );
    return (
      <div className="game-card-line">
        {readOnly ? (
          <div className="game-note sheet">{note}</div>
        ) : (
          <a className="game-note sheet" href={`#/games/${m.game_id}`}>
            {note}
          </a>
        )}
      </div>
    );
  }

  const canDelete = !readOnly && !m.deleted && (mine || me.permissions.delete_others_messages);
  const doodledOn = m.kind === 'doodle' && m.data?.on_message_id ? allMessages.find((x) => x.id === m.data!.on_message_id) : undefined;
  const doodledOnAuthor = doodledOn ? people.get(doodledOn.user_id ?? -1) : undefined;
  const readable = [m.body, m.kind === 'photo' ? 'a photo' : m.kind === 'doodle' ? 'a doodle' : null].filter(Boolean).join(', ');

  async function react(emoji: string) {
    try {
      await api.post(`/api/messages/${m.id}/reactions`, { emoji });
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  async function remove() {
    if (!(await confirmFirst('Delete this message for everyone?', 'Delete'))) return;
    try {
      await api.del(`/api/messages/${m.id}`);
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <div className={['msg', mine ? 'msg-mine' : 'msg-theirs', grouped && 'msg-grouped', selected && 'msg-selected'].filter(Boolean).join(' ')}>
      {!mine && (
        <div className="msg-avatar">{!grouped && <Avatar person={author} size="sm" />}</div>
      )}
      <div className="msg-body">
        {!mine && !grouped && showName && (
          <p className={`msg-name ink-${author?.colour ?? 'slate'}`} aria-hidden="true">
            {author?.name ?? 'Someone'}
          </p>
        )}
        {/* A tap on the message shows its actions; keyboards and screen readers use the button after it. */}
        <div
          className={`bubble tint-${mine ? 'mine' : (author?.colour ?? 'slate')}${m.deleted ? ' bubble-deleted' : ''}${m.media ? ' bubble-media' : ''}`}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a, .bubble-photo')) return;
            onSelect();
          }}
        >
          <span className="sr-only">{mine ? 'You' : (author?.name ?? 'Someone')}: </span>
          {m.reply_to && (
            <div className="quote">
              <span className="quote-name">{people.get(m.reply_to.user_id ?? -1)?.name ?? 'Someone'}</span>
              <span className="quote-text">
                {m.reply_to.deleted
                  ? 'Message deleted'
                  : m.reply_to.body || (m.reply_to.kind === 'photo' ? '📷 Photo' : m.reply_to.kind === 'doodle' ? '🖍️ Doodle' : '')}
              </span>
              {m.reply_to.media && <img src={m.reply_to.media.url} alt="" className="quote-thumb" />}
            </div>
          )}
          {m.deleted ? (
            <p className="msg-text muted">Message deleted</p>
          ) : (
            <>
              {m.media && (
                <button type="button" className="bubble-photo" onClick={onView} aria-label={m.kind === 'doodle' ? 'Open doodle' : 'Open photo'}>
                  <img
                    src={m.media.url}
                    alt={m.body ?? (m.kind === 'doodle' ? 'A doodle' : 'A photo')}
                    width={m.media.width ?? undefined}
                    height={m.media.height ?? undefined}
                    loading="lazy"
                  />
                </button>
              )}
              {m.kind === 'doodle' && (
                <p className="msg-tag">🖍️ {doodledOn ? `Doodled on ${doodledOnAuthor?.id === me.id ? 'your' : `${doodledOnAuthor?.name ?? 'a'}'s`} photo` : 'Doodle'}</p>
              )}
              {m.body && <p className="msg-text">{linkify(m.body)}</p>}
            </>
          )}
          <span className="msg-time">{timeOf(m.inserted_at)}</span>
        </div>
        {!m.deleted && (!readOnly || canSpeak) && (
          <button type="button" className="msg-more" aria-expanded={selected} onClick={onSelect}>
            <Icon name="more" size={18} />
            <span>{selected ? 'Hide actions' : 'Actions'}</span>
          </button>
        )}

        {m.reactions.length > 0 && (
          <div className="reactions">
            {m.reactions.map((r) => {
              const names = r.user_ids.map((id) => (id === me.id ? 'You' : (people.get(id)?.name ?? 'Someone'))).join(', ');
              return (
                <button
                  key={r.emoji}
                  type="button"
                  className="reaction"
                  aria-pressed={r.user_ids.includes(me.id)}
                  data-tip={names}
                  aria-label={`${r.emoji} from ${names}`}
                  disabled={readOnly}
                  onClick={() => react(r.emoji)}
                >
                  <span>{r.emoji}</span>
                  {r.user_ids.length > 1 && <span className="reaction-n">{r.user_ids.length}</span>}
                </button>
              );
            })}
          </div>
        )}

        {selected && !m.deleted && (!readOnly || canSpeak) && (
          <div className="msg-actions sheet" role="toolbar" aria-label="Message actions">
            {!readOnly && (
              <div className="quick-reactions">
                {reactions.map((e) => (
                  <button key={e} type="button" className="quick-reaction" onClick={() => react(e)} aria-label={`React ${e}`}>
                    {e}
                  </button>
                ))}
              </div>
            )}
            <div className="msg-action-row">
              {!readOnly && (
                <Button size="sm" variant="ghost" icon="reply" onClick={onReply}>
                  Reply
                </Button>
              )}
              {canSpeak && (m.body || m.kind !== 'text') && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={speaking ? 'stop' : 'speaker'}
                  onClick={() => {
                    if (speaking) {
                      stopSpeaking();
                      setSpeaking(false);
                    } else {
                      setSpeaking(true);
                      speak(`${mine ? 'You' : (author?.name ?? 'Someone')} said: ${readable}`, () => setSpeaking(false));
                    }
                  }}
                >
                  {speaking ? 'Stop' : 'Read aloud'}
                </Button>
              )}
              {m.media && !readOnly && me.permissions.doodle && !me.quiet_now && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="brush"
                  onClick={() => onDoodle({ url: m.media!.url, width: m.media!.width, height: m.media!.height, messageId: m.id })}
                >
                  Doodle on it
                </Button>
              )}
              {canDelete && (
                <Button size="sm" variant="ghost" icon="trash" onClick={remove}>
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Turns web addresses into links that open in a new tab.
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer noopener">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

function Composer({
  room,
  replyTo,
  onCancelReply,
  onSent,
  onDoodle,
  onGame,
}: {
  room: Room;
  replyTo: Message | null;
  onCancelReply: () => void;
  onSent: (m: Message) => void;
  onDoodle: (bg?: DoodleBackground) => void;
  onGame: () => void;
}) {
  const { me, people, toast } = useStore();
  const [text, setText] = useState(() => sessionStorage.getItem(`draft:${room.id}`) ?? '');
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const coarse = useMemo(() => window.matchMedia('(pointer: coarse)').matches, []);

  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(`draft:${room.id}`, text);
      else sessionStorage.removeItem(`draft:${room.id}`);
    } catch {
      /* private browsing */
    }
  }, [text, room.id]);

  // Grow with the message, up to a few lines.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 168) + 'px';
  }, [text]);

  useEffect(() => {
    if (replyTo) area.current?.focus();
  }, [replyTo]);

  if (!me.permissions.send_messages) {
    return (
      <div className="composer composer-off">
        <Icon name="lock" /> Sending messages is switched off for you just now. {whoCanChange(me.role)} can switch it on.
      </div>
    );
  }
  if (me.quiet_now) {
    return (
      <div className="composer composer-off">
        <Icon name="clock" /> It's quiet time until {me.quiet_hours?.to}. You can read, and send messages after that.
      </div>
    );
  }

  function typingPing() {
    const now = Date.now();
    if (now - lastTyping.current < 2500) return;
    lastTyping.current = now;
    try {
      const [ch, leave] = join(`room:${room.id}`);
      ch.push('typing', {});
      leave();
    } catch {
      /* offline */
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const body = text.trim();
    if (!body && !photo) return;
    setBusy(true);
    try {
      let message: Message;
      if (photo) {
        const prepared = await preparePhoto(photo.file);
        const { media_id } = await upload(room.id, prepared);
        ({ message } = await api.post<{ message: Message }>(`/api/rooms/${room.id}/messages`, {
          kind: 'photo',
          body,
          media_id,
          reply_to_id: replyTo?.id,
        }));
        URL.revokeObjectURL(photo.url);
        setPhoto(null);
      } else {
        ({ message } = await api.post<{ message: Message }>(`/api/rooms/${room.id}/messages`, {
          kind: 'text',
          body,
          reply_to_id: replyTo?.id,
        }));
      }
      setText('');
      onSent(message);
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
      if (!coarse) area.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !coarse) {
      e.preventDefault();
      send();
    }
  }

  const replyName = replyTo ? (replyTo.user_id === me.id ? 'yourself' : (people.get(replyTo.user_id ?? -1)?.name ?? 'someone')) : '';

  return (
    <form className="composer" onSubmit={send}>
      {replyTo && (
        <div className="composer-reply">
          <Icon name="reply" size={18} />
          <span>
            Replying to {replyName}: <span className="muted">{replyTo.body?.slice(0, 80) || (replyTo.media ? 'a photo' : '')}</span>
          </span>
          <IconButton icon="close" size="sm" label="Cancel reply" onClick={onCancelReply} />
        </div>
      )}
      {photo && (
        <div className="composer-photo">
          <img src={photo.url} alt="Photo to send" />
          <div className="composer-photo-actions">
            {me.permissions.doodle && (
              <Button
                size="sm"
                icon="brush"
                onClick={() => {
                  const p = photo;
                  setPhoto(null);
                  onDoodle({ url: p.url, width: null, height: null, file: p.file });
                }}
              >
                Doodle on it
              </Button>
            )}
            <IconButton
              icon="close"
              size="sm"
              label="Remove photo"
              onClick={() => {
                URL.revokeObjectURL(photo.url);
                setPhoto(null);
              }}
            />
          </div>
        </div>
      )}
      <div className="composer-row">
        <div className="composer-tools">
          {me.permissions.share_photos && (
            <>
              <IconButton icon="photo" label="Send a photo" onClick={() => fileInput.current?.click()} />
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) setPhoto({ file, url: URL.createObjectURL(file) });
                }}
              />
            </>
          )}
          {me.permissions.doodle && <IconButton icon="brush" label="Draw a doodle" onClick={() => onDoodle()} />}
          {me.permissions.start_games && me.permissions.play_games && (
            <IconButton icon="games" label="New game" onClick={onGame} />
          )}
        </div>
        <label className="sr-only" htmlFor={`compose-${room.id}`}>
          Message
        </label>
        <textarea
          id={`compose-${room.id}`}
          ref={area}
          className="input composer-input"
          rows={1}
          value={text}
          placeholder={photo ? 'Add a caption…' : 'Message'}
          onChange={(e) => {
            setText(e.target.value);
            typingPing();
          }}
          onKeyDown={onKey}
          maxLength={4000}
        />
        <IconButton
          type="submit"
          icon="send"
          label="Send"
          variant="primary"
          className="composer-send"
          disabled={busy || (!text.trim() && !photo)}
        />
      </div>
    </form>
  );
}

function PhotoViewer({ message, onClose, onDoodle }: { message: Message; onClose: () => void; onDoodle?: () => void }) {
  const author = usePerson(message.user_id);
  return (
    <Dialog
      open
      onClose={onClose}
      size="full"
      className="viewer"
      title={`${message.kind === 'doodle' ? 'Doodle' : 'Photo'} from ${author?.name ?? 'someone'}`}
      footer={
        <>
          <a className="btn btn-secondary btn-md" href={message.media!.url} download>
            Download
          </a>
          {onDoodle && (
            <Button variant="primary" icon="brush" onClick={onDoodle}>
              Doodle on it
            </Button>
          )}
        </>
      }
    >
      <figure className="viewer-figure">
        <img src={message.media!.url} alt={message.body ?? ''} />
        {message.body && <figcaption>{message.body}</figcaption>}
      </figure>
    </Dialog>
  );
}

function EditGroup({ room, open, onClose }: { room: Room; open: boolean; onClose: () => void }) {
  const { me, people, bubbles, friendships, refreshRooms, toast } = useStore();
  const [name, setName] = useState(room.name);
  const [members, setMembers] = useState(new Set(room.member_ids));
  const [busy, setBusy] = useState(false);
  const facts = { bubbles, friendships };
  // People this person may chat with, and anyone already in it, so they can come out.
  const everyone = [...people.values()].filter((p) => p.active && p.id !== me.id && (mayTalk(me, p, facts) || room.member_ids.includes(p.id)));
  const chosen = [...members].map((id) => people.get(id)).filter((p): p is Person => !!p);
  const problem = me.role === 'kid' ? null : whyNot([me, ...chosen], facts);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/api/rooms/${room.id}`, { name, member_ids: [...members] });
      await refreshRooms();
      onClose();
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
      title="Change group"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save} disabled={!!problem}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Name">{(p) => <Input {...p} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />}</Field>
        <fieldset className="fieldset">
          <legend>Who's in it</legend>
          <ul className="people-pick">
            {everyone.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="person-chip"
                  aria-pressed={members.has(p.id)}
                  onClick={() => {
                    const n = new Set(members);
                    if (n.has(p.id)) n.delete(p.id);
                    else n.add(p.id);
                    setMembers(n);
                  }}
                >
                  <Avatar person={p} size="sm" />
                  <span>{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
        {problem && <Notice tone="warning">{problem}</Notice>}
      </div>
    </Dialog>
  );
}

/** A call in the chat: who started it, and a Join button while it's on. */
function CallNote({ m, readOnly }: { m: Message; readOnly: boolean }) {
  const { rooms, people, me } = useStore();
  const author = m.user_id === me.id ? 'You' : (people.get(m.user_id ?? -1)?.name ?? 'Someone');
  const room = rooms.find((r) => r.id === m.room_id);
  const live = !!room?.call && room.call.message_id === m.id;
  const inCall = live ? room!.call!.user_ids.length : 0;
  const who = (m.data?.people ?? []).map((id) => (id === me.id ? 'you' : (people.get(id)?.name ?? 'someone')));
  const seconds = m.data?.seconds;

  let detail = 'Call ended';
  if (live) detail = inCall === 1 ? 'On now: 1 person in it' : `On now: ${inCall} people in it`;
  else if (typeof seconds === 'number') detail = `${callLength(seconds)}${who.length > 1 ? ` with ${listNames(who)}` : ', nobody joined'}`;

  return (
    <div className="game-card-line">
      <div className={`game-note call-note sheet${live ? ' is-live' : ''}`}>
        <span className="game-note-art" aria-hidden="true">
          <Icon name="video" size={28} />
        </span>
        <span className="game-note-text">
          <strong>{author} started a video call</strong>
          <span className="muted">{detail}</span>
        </span>
        {live && !readOnly && (
          <a className="btn btn-call btn-sm" href={`#/call/${m.room_id}`}>
            Join
          </a>
        )}
      </div>
    </div>
  );
}

function callLength(seconds: number): string {
  if (seconds < 60) return 'Under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  return rest ? `${plural(hours, 'hour')} ${plural(rest, 'minute')}` : plural(hours, 'hour');
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}
