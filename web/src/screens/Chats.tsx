import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { go } from '../lib/router';
import { shortTime } from '../lib/time';
import { friendshipBetween, mayTalk, whyNot } from '../lib/contacts';
import type { Person, Room } from '../lib/types';

import { Avatar, Button, Dialog, EmptyState, Field, Input, Notice } from '../components/ui';
import { RoomView } from './Room';

export function Chats({ roomId }: { roomId?: number }) {
  const { rooms } = useStore();
  const room = roomId ? rooms.find((r) => r.id === roomId) : undefined;

  return (
    <div className="split" data-open={roomId ? 'yes' : 'no'}>
      <section className="split-list" aria-label="Chats">
        <RoomList selected={roomId} />
      </section>
      <section className="split-detail">
        {roomId ? (
          room ? (
            <RoomView key={room.id} room={room} />
          ) : rooms.length ? (
            <EmptyState art="🔍" title="That chat isn't here">
              <p>It may have been closed, or you're not in it any more.</p>
            </EmptyState>
          ) : null
        ) : (
          <EmptyState art="🫖" title="Pick a chat">
            <p>Choose someone on the left to catch up.</p>
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function RoomList({ selected }: { selected?: number }) {
  const { rooms, me } = useStore();
  const [creating, setCreating] = useState(false);
  const canStart = me.permissions.create_rooms || me.permissions.direct_messages;
  const mine = rooms.filter((r) => r.member);
  const others = rooms.filter((r) => !r.member);

  return (
    <>
      <header className="page-head">
        <h1>Chats</h1>
        {canStart && (
          <Button icon="plus" variant="primary" size="sm" onClick={() => setCreating(true)}>
            New chat
          </Button>
        )}
      </header>
      <ul className="room-list">
        {mine.map((r) => (
          <RoomItem key={r.id} room={r} selected={selected === r.id} />
        ))}
      </ul>
      {rooms.length === 0 && (
        <p className="muted room-list-head">No chats yet.{canStart ? ' Tap New chat to message someone.' : ''}</p>
      )}
      {others.length > 0 && (
        <>
          <div className="room-list-head">
            {me.permissions.manage_people ? (
              <>
                <h2 className="section-label">Everyone else's chats</h2>
                <p className="muted">You can read these because you're an admin. Nobody sees you reading.</p>
              </>
            ) : (
              <>
                <h2 className="section-label">Your kids' chats</h2>
                <p className="muted">You can read the chats your kids are in, because you're their guardian. Nobody sees you reading.</p>
              </>
            )}
          </div>
          <ul className="room-list">
            {others.map((r) => (
              <RoomItem key={r.id} room={r} selected={selected === r.id} />
            ))}
          </ul>
        </>
      )}
      <NewChat open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function RoomItem({ room: r, selected }: { room: Room; selected: boolean }) {
  const { me, people, online } = useStore();
  // A chat between two other people (one an admin is reading) shows both, so no single face.
  const other = r.kind === 'direct' && r.member ? people.get(r.member_ids.find((id) => id !== me.id) ?? -1) : undefined;
  const who = r.last_message?.user_id ? people.get(r.last_message.user_id) : undefined;
  const prefix = r.last_message?.user_id === me.id ? 'You: ' : who && !other ? `${who.name}: ` : '';
  return (
    <li>
      <a
        className="room-item"
        href={`#/chats/${r.id}`}
        aria-current={selected ? 'page' : undefined}
        data-unread={r.unread > 0 || undefined}
      >
        {other ? (
          <Avatar person={other} online={online.has(other.id)} />
        ) : (
          <span className="room-emoji" aria-hidden="true">
            {r.emoji}
          </span>
        )}
        <span className="room-text">
          <span className="room-name">{r.name}</span>
          {r.closed ? (
            <span className="room-last">
              <span aria-hidden="true">🔒</span> Closed for now
            </span>
          ) : r.call ? (
            <span className="room-last room-live">
              <span className="live-dot" aria-hidden="true" /> In a video call now
            </span>
          ) : (
            <span className="room-last">{r.last_message ? prefix + r.last_message.text : 'No messages yet'}</span>
          )}
        </span>
        <span className="room-meta">
          <span className="room-time">{shortTime(r.last_message_at)}</span>
          {r.unread > 0 && (
            <span className="count">
              <span aria-hidden="true">{r.unread > 99 ? '99+' : r.unread}</span>
              <span className="sr-only">, {r.unread} new</span>
            </span>
          )}
        </span>
      </a>
    </li>
  );
}

const roomEmoji = ['💬', '🏡', '🎉', '🍰', '⚽', '🎨', '🌳', '🧸', '✈️', '🎄', '🐾', '📚'];

function NewChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, people, bubbles, friendships, refreshRooms, refreshPeople, toast } = useStore();
  const [mode, setMode] = useState<'pick' | 'group'>('pick');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('💬');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const facts = useMemo(() => ({ bubbles, friendships }), [bubbles, friendships]);
  const others = useMemo(() => [...people.values()].filter((p) => p.active && p.id !== me.id), [people, me.id]);
  // Only the people this person may chat with; kids can ask to chat with kids from other families.
  const reachable = useMemo(() => others.filter((p) => mayTalk(me, p, facts)), [others, me, facts]);
  const askable = useMemo(() => (me.role === 'kid' ? others.filter((p) => p.role === 'kid' && !mayTalk(me, p, facts)) : []), [others, me, facts]);
  const chosenPeople = [...chosen].map((id) => people.get(id)).filter((p): p is Person => !!p);
  // A kid only sees their own family's friendships, so the server checks their groups.
  const groupProblem = me.role === 'kid' || chosen.size === 0 ? null : whyNot([me, ...chosenPeople], facts);

  function reset() {
    setMode('pick');
    setName('');
    setEmoji('💬');
    setChosen(new Set());
    setError(null);
    setBusy(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function direct(id: number) {
    setBusy(true);
    try {
      const res = await api.post<{ room_id: number }>(`/api/rooms/direct/${id}`);
      await refreshRooms();
      close();
      go({ name: 'chats', roomId: res.room_id });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function askToChat(friend: Person) {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/friends', { kid_id: me.id, friend_id: friend.id });
      await refreshPeople();
      toast(`Asked. You and ${friend.name} can chat once a guardian from each family says yes.`, 'success');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function createGroup() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ room_id: number }>('/api/rooms', { name, emoji, member_ids: [...chosen] });
      await refreshRooms();
      close();
      go({ name: 'chats', roomId: res.room_id });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={mode === 'pick' ? 'New chat' : 'New group'}
      footer={
        mode === 'group' ? (
          <>
            <Button onClick={() => setMode('pick')}>Back</Button>
            <Button variant="primary" busy={busy} onClick={createGroup} disabled={!name.trim() || chosen.size === 0 || !!groupProblem}>
              Start the group
            </Button>
          </>
        ) : undefined
      }
    >
      {mode === 'pick' ? (
        <div className="stack">
          {me.permissions.create_rooms && (
            <button type="button" className="choice" onClick={() => setMode('group')}>
              <span className="choice-art" aria-hidden="true">
                👨‍👩‍👧
              </span>
              <span>
                <strong>A group for some of the family</strong>
                <span className="muted">Plan a birthday, a trip or a surprise.</span>
              </span>
            </button>
          )}
          {me.permissions.direct_messages && (
            <>
              <h3 className="section-label">Message one person</h3>
              {reachable.length === 0 && <p className="muted">There's nobody here you can message yet.</p>}
              <ul className="people-pick">
                {reachable.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="person-chip" onClick={() => direct(p.id)} disabled={busy}>
                      <Avatar person={p} size="sm" />
                      <span>{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {askable.length > 0 && (
            <>
              <h3 className="section-label">Ask to chat with a friend</h3>
              <p className="muted">A guardian from each family says yes first.</p>
              <ul className="people-pick">
                {askable.map((p) => {
                  const asked = friendshipBetween(me.id, p.id, friendships);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="person-chip"
                        onClick={() => askToChat(p)}
                        disabled={busy || !!asked}
                        aria-label={asked ? `${p.name}, waiting for a yes` : `Ask to chat with ${p.name}`}
                      >
                        <Avatar person={p} size="sm" />
                        <span>{p.name}</span>
                        {asked && <span className="muted chip-note">Waiting for a yes</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      ) : (
        <div className="stack">
          <Field label="Name">
            {(p) => <Input {...p} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Gran's birthday" />}
          </Field>
          <fieldset className="fieldset">
            <legend>Picture</legend>
            <div className="emoji-pick">
              {roomEmoji.map((e) => (
                <button key={e} type="button" className="emoji-option" aria-pressed={emoji === e} onClick={() => setEmoji(e)}>
                  {e}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="fieldset">
            <legend>Who's in it</legend>
            <ul className="people-pick">
              {reachable.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="person-chip"
                    aria-pressed={chosen.has(p.id)}
                    onClick={() => {
                      const next = new Set(chosen);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      setChosen(next);
                    }}
                  >
                    <Avatar person={p} size="sm" />
                    <span>{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
          {groupProblem && <Notice tone="warning">{groupProblem}</Notice>}
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      )}
    </Dialog>
  );
}

