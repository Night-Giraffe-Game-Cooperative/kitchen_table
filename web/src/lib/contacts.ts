import type { Bubble, Friendship, Me, Person } from './types';

// Who may chat with whom: the same rules as Family.Contacts on the server,
// which has the last word. Grown-ups chat with any grown-up. A kid chats with
// the grown-ups in their own household and the ones an admin has made family
// to it, with the kids in their household, and with kids from other
// households once a guardian from each family has said yes.

export interface ContactFacts {
  bubbles: Map<number, Bubble>;
  friendships: Friendship[];
}

type Someone = Pick<Person, 'id' | 'role' | 'bubble_id' | 'name'>;

export const isGrownUp = (p: Pick<Person, 'role'>) => p.role !== 'kid';

const sameHome = (a: Someone, b: Someone) => a.bubble_id != null && a.bubble_id === b.bubble_id;

/** Whether a grown-up is family to a kid: in their household, or added as family to it. */
export function isRelative(grownUp: Someone, kid: Someone, facts: ContactFacts): boolean {
  if (sameHome(grownUp, kid)) return true;
  const bubble = kid.bubble_id == null ? undefined : facts.bubbles.get(kid.bubble_id);
  return !!bubble?.relative_ids?.includes(grownUp.id);
}

export function friendshipBetween(a: number, b: number, friendships: Friendship[]): Friendship | undefined {
  return friendships.find((f) => f.kid_ids.includes(a) && f.kid_ids.includes(b) && a !== b);
}

export function mayTalk(a: Someone, b: Someone, facts: ContactFacts): boolean {
  if (a.id === b.id) return true;
  if (isGrownUp(a) && isGrownUp(b)) return true;
  if (isGrownUp(a)) return isRelative(a, b, facts);
  if (isGrownUp(b)) return isRelative(b, a, facts);
  if (sameHome(a, b)) return true;
  return !!friendshipBetween(a.id, b.id, facts.friendships)?.approved;
}

/** Why these people can't all chat together, in the server's words, or null when they can. */
export function whyNot(people: Someone[], facts: ContactFacts): string | null {
  for (const a of people) {
    for (const b of people) {
      if (a.id < b.id && !mayTalk(a, b, facts)) return reason(a, b);
    }
  }
  return null;
}

function reason(a: Someone, b: Someone): string {
  if (!isGrownUp(a) && !isGrownUp(b)) {
    const [first, second] = [a.name, b.name].sort();
    return `${first} and ${second} can chat once a guardian from each family says yes.`;
  }
  const [grownUp, kid] = isGrownUp(a) ? [a, b] : [b, a];
  return `${grownUp.name} isn't family to ${kid.name}, so they can't chat. An admin can add them as family on the Family page.`;
}

/** Whether someone is a guardian of a kid: a grown-up in the kid's household who looks after its kids. */
export function isGuardianOf(me: Me, kid: Someone): boolean {
  if (kid.role !== 'kid' || kid.bubble_id == null || me.bubble_id !== kid.bubble_id || !me.active) return false;
  return me.role === 'admin' || (me.role === 'grownup' && !!me.permissions.manage_kids);
}

/** Which of a friendship's two sides still need a guardian's yes. */
export function waitingSides(f: Friendship): number[] {
  return f.kid_ids.filter((_, i) => f.ok_by[i] == null);
}

/** Friendships waiting on this person's yes: they guard a kid on a side that hasn't said yes. */
export function waitingOnMe(me: Me, friendships: Friendship[], people: Map<number, Person>): Friendship[] {
  return friendships.filter(
    (f) =>
      !f.approved &&
      waitingSides(f).some((id) => {
        const kid = people.get(id);
        return !!kid && isGuardianOf(me, kid);
      }),
  );
}
