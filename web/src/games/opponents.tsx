// Choosing who to play in two-sided games: against the computer, everyone in
// the chat as one team or just the person starting it; against each other,
// one person or whoever wants to.
import { Field, Segmented, Select } from '../components/ui';
import type { Me, Person, Room } from '../lib/types';
import type { PlayerSeat } from './common';

export type Who = 'team' | 'me';

export function WhoPlays({ value, onChange, hint, label = 'Who plays the computer' }: { value: Who; onChange: (w: Who) => void; hint: string; label?: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <Segmented
        label={label}
        value={value}
        onChange={onChange}
        options={[
          { value: 'team', label: 'Everyone in the chat', icon: 'team' },
          { value: 'me', label: 'Just me', icon: 'me' },
        ]}
      />
      <p className="field-hint">{hint}</p>
    </div>
  );
}

/** "Anyone in the chat can make the family's move." or "Only you make the moves, and the others can watch." */
export const whoHint = (who: Who) => (who === 'team' ? "Anyone in the chat can make the family's move." : 'Only you make the moves, and the others can watch.');

/** One other person to play, or a place for whoever wants it. */
export function OpponentSelect({
  value,
  onChange,
  room,
  me,
  people,
}: {
  value: PlayerSeat;
  onChange: (p: PlayerSeat) => void;
  room: Room;
  me: Me;
  people: Map<number, Person>;
}) {
  const others = room.member_ids.filter((id) => id !== me.id && people.get(id)?.active);
  return (
    <Field label="Playing against">
      {(p) => (
        <Select {...p} value={String(value)} onChange={(e) => onChange(e.target.value === 'open' ? 'open' : Number(e.target.value))}>
          <option value="open">Whoever wants to play</option>
          {others.map((id) => (
            <option key={id} value={id}>
              {people.get(id)?.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
