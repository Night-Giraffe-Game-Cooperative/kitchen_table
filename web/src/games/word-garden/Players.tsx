// Shared pieces for the versus modes of Word Garden, Picture Puzzle and Story
// Chain: choosing who plays, showing the players, joining an open place, and
// the final standings.
import { useState, type ReactNode } from 'react';
import { Avatar, Button } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Game, Me, Person, Room, Seat } from '../../lib/types';
import { joinSeat, listNames, nameOf, seatOrder, type PlayerSeat } from '../common';

/** People in the room who could be asked to play, not counting me. */
export function otherPlayers(room: Room, me: Me, people: Map<number, Person>): number[] {
  return room.member_ids.filter((id) => {
    const p = people.get(id);
    return id !== me.id && p && p.active !== false && p.permissions?.play_games !== false;
  });
}

/** The other person in a chat for two; otherwise a place for whoever wants it. */
export function defaultPlayers(room: Room, me: Me): PlayerSeat[] {
  const others = room.member_ids.filter((id) => id !== me.id);
  return others.length === 1 ? [others[0]] : ['open'];
}

export function PlayerPicker({
  value,
  onChange,
  room,
  me,
  people,
  max,
  race,
}: {
  value: PlayerSeat[];
  onChange: (v: PlayerSeat[]) => void;
  room: Room;
  me: Me;
  people: Map<number, Person>;
  /** Most players, me included. */
  max: number;
  /** Everyone plays at once, so there's no turn order to explain. */
  race?: boolean;
}) {
  const others = otherPlayers(room, me, people);
  const full = value.length + 1 >= max;

  function toggle(p: PlayerSeat) {
    const next = value.includes(p) ? value.filter((x) => x !== p) : [...value, p];
    // People who are already in go first, so the game doesn't start by waiting for someone to join.
    onChange([...next.filter((x) => x !== 'open'), ...next.filter((x) => x === 'open')]);
  }

  const names = ['You', ...value.filter((p) => p !== 'open').map((id) => nameOf(people, id))];
  const order = value.includes('open') ? [...names, 'whoever joins'] : names;

  return (
    <fieldset className="fieldset vs-pick">
      <legend>Who's playing?</legend>
      <div className="vs-chips">
        <span className={`vs-chip tint-${me.colour}`} aria-pressed="true" data-fixed>
          <Avatar person={me} size="xs" />
          <span>You</span>
        </span>
        {others.map((id) => {
          const on = value.includes(id);
          return (
            <button key={id} type="button" className={`vs-chip tint-${people.get(id)?.colour ?? 'slate'}`} aria-pressed={on} disabled={!on && full} onClick={() => toggle(id)}>
              <Avatar person={people.get(id)} size="xs" />
              <span>{people.get(id)?.name}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="vs-chip vs-chip-open"
          aria-pressed={value.includes('open')}
          disabled={!value.includes('open') && full}
          onClick={() => toggle('open')}
        >
          <span className="vs-open-face" aria-hidden="true">
            +
          </span>
          <span>Anyone who wants to</span>
        </button>
      </div>
      <p className="field-hint vs-pick-hint">
        {value.length === 0
          ? 'Choose at least one person to play against.'
          : race
            ? `${listNames(order)} get the same puzzle.`
            : `Turns go ${order.join(', then ')}, and round again.`}
        {full && ` ${max} players at most.`}
      </p>
    </fieldset>
  );
}

/** The players in a row, with whose turn it is and something about each. */
export function SeatList({
  game,
  me,
  people,
  turn,
  detail,
  label = 'Players',
}: {
  game: Game<any>;
  me: Me;
  people: Map<number, Person>;
  turn?: string;
  detail?: (seat: string, who: Seat) => ReactNode;
  label?: string;
}) {
  return (
    <ul className="vs-seats" aria-label={label}>
      {seatOrder(game.seats).map((seat) => {
        const who = game.seats[seat];
        const person = typeof who === 'number' ? people.get(who) : undefined;
        return (
          <li
            key={seat}
            className={`vs-seat tint-${person?.colour ?? 'slate'}`}
            data-turn={turn === seat || undefined}
            data-me={who === me.id || undefined}
            data-open={who === 'open' || undefined}
          >
            {who === 'open' ? (
              <span className="vs-open-face" aria-hidden="true">
                ?
              </span>
            ) : (
              <Avatar person={person} size="sm" />
            )}
            <span className="vs-seat-text">
              <span className="vs-seat-name">{who === 'open' ? 'Open place' : nameOf(people, who, me.id)}</span>
              {detail && <span className="vs-seat-detail">{detail(seat, who)}</span>}
            </span>
            {turn === seat && <span className="sr-only">, their turn</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Lets someone in the room take an open place in a game. */
export function JoinBanner({ game, me, children }: { game: Game<any>; me: Me; children?: ReactNode }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const open = seatOrder(game.seats).find((k) => game.seats[k] === 'open');
  const playing = Object.values(game.seats).includes(me.id);
  if (!open || playing || game.status !== 'active' || !me.permissions.play_games) return null;

  async function join() {
    setBusy(true);
    try {
      await joinSeat(game.id, open!);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vs-join sheet">
      <span className="vs-join-art" aria-hidden="true">
        🙋
      </span>
      <p>{children ?? "There's a place free in this game. Want to play?"}</p>
      <Button variant="primary" icon="plus" busy={busy} onClick={join}>
        Join in
      </Button>
    </div>
  );
}

export interface Standing {
  seat: string;
  /** Null for someone who didn't finish. */
  place: number | null;
  main: ReactNode;
  extra?: ReactNode;
}

const medals = ['🥇', '🥈', '🥉'];

export function Standings({ rows, game, me, people, label = 'Results' }: { rows: Standing[]; game: Game<any>; me: Me; people: Map<number, Person>; label?: string }) {
  return (
    <ol className="vs-standings" aria-label={label}>
      {rows.map((r) => {
        const who = game.seats[r.seat];
        return (
          <li key={r.seat} className="vs-standing" data-place={r.place ?? undefined} data-me={who === me.id || undefined}>
            <span className="vs-medal" aria-label={r.place ? `Place ${r.place}` : 'Did not finish'}>
              {r.place ? (medals[r.place - 1] ?? r.place) : '–'}
            </span>
            <Avatar person={typeof who === 'number' ? people.get(who) : undefined} size="sm" />
            <span className="vs-standing-name">{nameOf(people, who, me.id)}</span>
            <span className="vs-standing-main">{r.main}</span>
            {r.extra && <span className="vs-standing-extra">{r.extra}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** "You won!", "Mia won!" or "Mia and you share the win!" */
export function winnerText(seats: string[], game: Game<any>, me: Me, people: Map<number, Person>): string {
  const ids = seats.map((s) => game.seats[s]);
  if (!ids.length) return 'Nobody won this time';
  if (ids.length === 1) return ids[0] === me.id ? 'You won! 🎉' : `${nameOf(people, ids[0])} won! 🎉`;
  const mine = ids.includes(me.id);
  const names = ids.filter((id) => id !== me.id).map((id) => nameOf(people, id));
  return `${listNames(mine ? ['You', ...names] : names)} share the win! 🎉`;
}
