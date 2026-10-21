import { useState } from 'react';
import { Avatar, Button } from '../../components/ui';
import { Icon } from '../../components/icons';
import type { GameDef, GameProps, OptionsProps } from '../common';
import { doodlePrompts, listNames, nameOf, pick } from '../common';
import { DrawPad } from './DrawPad';
import { PromptField } from './PromptOptions';

interface State {
  turn: 'anyone';
  prompt: string;
  phase: 'drawing' | 'voting' | 'done';
  players: number[];
  entries: Record<string, string>; // person id -> picture url
  votes: Record<string, number>; // voter id -> person whose picture they chose
}

function tally(s: State) {
  const counts = new Map<number, number>();
  for (const id of Object.values(s.votes)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

function finish(s: State, people: GameProps<State>['people']) {
  const counts = tally(s);
  const top = Math.max(0, ...counts.values());
  const winners = [...counts.entries()].filter(([, n]) => n === top && n > 0).map(([id]) => nameOf(people, id));
  const summary = winners.length
    ? `${listNames(winners)} got the most stars drawing ${s.prompt} 🌟`
    : `Everyone drew ${s.prompt}`;
  return { state: { ...s, phase: 'done' as const }, status: 'finished' as const, summary };
}

function Board({ game, play, me, people }: GameProps<State>) {
  const s = game.state;
  const [showPad, setShowPad] = useState(false);
  const mine = s.entries[me.id];
  const entrants = Object.keys(s.entries).map(Number);
  const waiting = s.players.filter((id) => !s.entries[id]);
  const myVote = s.votes[me.id];
  const canPlay = me.permissions.play_games && game.status === 'active';
  const counts = tally(s);
  const top = Math.max(0, ...counts.values());

  if (s.phase === 'drawing') {
    return (
      <div className="doodle-game">
        <p className="prompt-banner">
          ✏️ Everyone draws: <strong>{s.prompt}</strong>
        </p>
        <div className="artists">
          {s.players.map((id) => (
            <span key={id} className="artist" data-done={!!s.entries[id] || undefined}>
              <Avatar person={people.get(id)} size="xs" />
              <span>
                {nameOf(people, id, me.id)} {s.entries[id] ? <Icon name="check" size={14} /> : <span className="muted">drawing…</span>}
              </span>
            </span>
          ))}
        </div>
        {canPlay && !mine && (s.players.includes(me.id) || showPad) && (
          <DrawPad
            roomId={game.room_id}
            label={`Your drawing of ${s.prompt}`}
            sendLabel="I'm done"
            onSent={(media) =>
              play.move((st) => {
                const entries: Record<string, string> = { ...st.entries, [me.id]: media.url };
                const players = st.players.includes(me.id) ? st.players : [...st.players, me.id];
                const everyone = players.every((id) => entries[id]);
                return { state: { ...st, entries, players, phase: everyone ? 'voting' : 'drawing' } };
              })
            }
          />
        )}
        {canPlay && !mine && !s.players.includes(me.id) && !showPad && (
          <Button variant="primary" icon="brush" onClick={() => setShowPad(true)}>
            Join in and draw
          </Button>
        )}
        {mine && (
          <div className="notice notice-info">
            <p>
              Your picture is in! {waiting.length ? `Waiting for ${listNames(waiting.map((id) => nameOf(people, id)))}.` : ''} The pictures are shown
              when everyone's done.
            </p>
            {canPlay && entrants.length >= 2 && waiting.length > 0 && (
              <Button size="sm" onClick={() => play.move((st) => ({ state: { ...st, phase: 'voting' } }))}>
                Show the pictures now
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="doodle-game">
      <p className="prompt-banner">
        {s.phase === 'voting' ? '🌟 Give a star to your favourite: ' : '🖼️ '}
        <strong>{s.prompt}</strong>
      </p>
      <ul className="gallery">
        {entrants.map((id) => {
          const n = counts.get(id) ?? 0;
          const winner = s.phase === 'done' && n === top && n > 0;
          return (
            <li key={id} className="gallery-item sheet" data-winner={winner || undefined}>
              <img src={s.entries[id]} alt={`${nameOf(people, id)}'s drawing of ${s.prompt}`} />
              <div className="gallery-foot">
                <Avatar person={people.get(id)} size="xs" />
                <span>{nameOf(people, id, me.id)}</span>
                {(s.phase === 'done' || myVote) && n > 0 && <span className="stars">{'🌟'.repeat(n)}</span>}
                {winner && <span aria-label="Most stars">👑</span>}
              </div>
              {s.phase === 'voting' && canPlay && id !== me.id && (
                <Button
                  size="sm"
                  variant={myVote === id ? 'primary' : 'secondary'}
                  icon="star"
                  disabled={play.busy}
                  onClick={() =>
                    play.move((st) => {
                      const votes: Record<string, number> = { ...st.votes, [me.id]: id };
                      const next = { ...st, votes };
                      const allVoted = Object.keys(next.entries).every((voter) => votes[voter]);
                      return allVoted ? finish(next, people) : { state: next };
                    })
                  }
                >
                  {myVote === id ? 'Your star' : 'Give a star'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {s.phase === 'voting' && canPlay && Object.keys(s.votes).length > 0 && (
        <div className="row row-end">
          <Button onClick={() => play.move((st) => finish(st, people))}>Count the stars now</Button>
        </div>
      )}
    </div>
  );
}

function Options({ value, onChange }: OptionsProps<{ prompt: string }>) {
  return <PromptField value={value.prompt} onChange={(prompt) => onChange({ prompt })} />;
}

export const doodleDuel: GameDef<State, { prompt: string }> = {
  type: 'doodle_duel',
  name: 'Doodle Battle',
  emoji: '✏️',
  blurb: 'Everyone draws the same thing in secret, then the pictures are shown and you give stars to your favourite.',
  modes: ['versus'],
  modeLabels: { versus: 'Everyone draws' },
  players: '2 or more',
  defaults: () => ({ prompt: pick(doodlePrompts) }),
  ready: (o) => o.prompt.trim().length > 0,
  Options,
  create: (o, { room, people }) => ({
    mode: 'versus',
    seats: {},
    state: {
      turn: 'anyone',
      prompt: o.prompt.trim(),
      phase: 'drawing',
      players: room.member_ids.filter((id) => people.get(id)?.active !== false),
      entries: {},
      votes: {},
    },
  }),
  Board,
  guide: [
    {
      title: 'The aim',
      body: "Everyone draws the same thing in secret. When all the pictures are in, they're shown together and everyone gives a star to their favourite, but not their own. The most stars wins.",
    },
    {
      title: 'Ideas',
      body: ['Think of a funny or surprising way to show it.', 'Give your star to the picture you like most, not just the neatest one.'],
    },
  ],
  status: (g, me, people) => {
    const s = g.state;
    if (g.status === 'finished') return g.summary || 'Finished';
    if (s.phase === 'voting') return s.votes[me] ? 'Waiting for the other stars' : 'Give a star to your favourite';
    if (!s.entries[me]) return `Draw ${s.prompt}`;
    const waiting = s.players.filter((id) => !s.entries[id]);
    return `Waiting for ${listNames(waiting.map((id) => nameOf(people, id)))}`;
  },
};
