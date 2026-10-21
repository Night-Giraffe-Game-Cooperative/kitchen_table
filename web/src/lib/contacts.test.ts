import { describe, expect, it } from 'vitest';
import { isGuardianOf, mayTalk, waitingOnMe, whyNot, type ContactFacts } from './contacts';
import type { Bubble, Friendship, Me, Person, Role } from './types';

// Made-up households: home (1), Grandma's house (2) and a school friend's (3).
const person = (id: number, name: string, role: Role, bubble_id: number) => ({ id, name, role, bubble_id }) as Person;
const dad = person(1, 'Dad', 'admin', 1);
const mum = person(2, 'Mum', 'grownup', 1);
const kid = person(3, 'Kit', 'kid', 1);
const sister = person(4, 'Sis', 'kid', 1);
const grandma = person(5, 'Grandma', 'grownup', 2);
const pat = person(6, 'Pat', 'grownup', 3);
const friend = person(7, 'Fern', 'kid', 3);

const bubble = (id: number, relative_ids: number[] = []) => ({ id, name: `B${id}`, emoji: '🏠', home: id === 1, features: {}, relative_ids }) as unknown as Bubble;
const facts = (relatives: number[] = [], friendships: Friendship[] = []): ContactFacts => ({
  bubbles: new Map([1, 2, 3].map((id) => [id, bubble(id, id === 1 ? relatives : [])])),
  friendships,
});
const friendship = (ok: [number | null, number | null]): Friendship => ({ id: 1, kid_ids: [3, 7], ok_by: ok, asked_by_id: 3, approved: ok.every((x) => x != null) });

describe('who may chat with whom', () => {
  it('lets grown-ups chat, and kids chat with their own family', () => {
    const f = facts();
    expect(mayTalk(dad, pat, f) && mayTalk(grandma, pat, f)).toBe(true);
    expect(mayTalk(mum, kid, f) && mayTalk(kid, sister, f)).toBe(true);
    expect(mayTalk(grandma, kid, f)).toBe(false);
    expect(mayTalk(pat, kid, f)).toBe(false);
    expect(mayTalk(dad, friend, f)).toBe(false);
  });

  it('lets a grown-up an admin made family chat with the kids', () => {
    const f = facts([5]);
    expect(mayTalk(kid, grandma, f) && mayTalk(grandma, sister, f)).toBe(true);
    // Family to this household's kids, not the friend's.
    expect(mayTalk(grandma, friend, f)).toBe(false);
  });

  it('needs a yes from a guardian in each family for kids from different households', () => {
    expect(mayTalk(kid, friend, facts([], [friendship([1, null])]))).toBe(false);
    expect(mayTalk(kid, friend, facts([], [friendship([1, 6])]))).toBe(true);
  });

  it("says why a group can't go ahead, as the server does", () => {
    expect(whyNot([mum, kid, sister], facts())).toBeNull();
    expect(whyNot([mum, kid, friend], facts())).toBe("Mum isn't family to Fern, so they can't chat. An admin can add them as family on the Family page.");
    expect(whyNot([kid, friend], facts())).toBe('Fern and Kit can chat once a guardian from each family says yes.');
  });
});

describe('guardians', () => {
  const me = (p: Person, manage_kids = true) => ({ ...p, active: true, permissions: { manage_kids } }) as unknown as Me;

  it('are the grown-ups in a kid’s own household who look after its kids', () => {
    expect(isGuardianOf(me(dad), kid)).toBe(true);
    expect(isGuardianOf(me(mum), kid)).toBe(true);
    expect(isGuardianOf(me(mum, false), kid)).toBe(false);
    // An admin isn't a guardian of another family's kids.
    expect(isGuardianOf(me(dad), friend)).toBe(false);
    expect(isGuardianOf(me(grandma), kid)).toBe(false);
  });

  it('see the friendships waiting on their yes', () => {
    const people = new Map([kid, friend].map((p) => [p.id, p]));
    const asked = friendship([null, 6]);
    expect(waitingOnMe(me(mum), [asked], people)).toEqual([asked]);
    expect(waitingOnMe(me(pat), [asked], people)).toEqual([]);
    expect(waitingOnMe(me(mum), [friendship([1, 6])], people)).toEqual([]);
  });
});
