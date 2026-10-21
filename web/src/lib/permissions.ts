import type { Bubble, BubbleFeature, Permission, Role } from './types';
import { calendarOn } from './features';

/** Who can switch something back on for someone: a guardian for a kid, an admin for a grown-up. */
export function whoCanChange(role: Role): string {
  return role === 'kid' ? 'A guardian' : 'An admin';
}

// The same defaults the server uses (Family.Permissions); admins always have everything.
const all: Permission[] = [
  'send_messages',
  'share_photos',
  'doodle',
  'play_games',
  'start_games',
  'video_calls',
  'direct_messages',
  'create_rooms',
  'delete_others_messages',
  'manage_kids',
  'calendar',
  'edit_calendar',
  'tasks',
];

const kid: Partial<Record<Permission, boolean>> = {
  create_rooms: false,
  delete_others_messages: false,
  manage_kids: false,
  edit_calendar: false,
};

export function roleDefaults(role: Role): Record<Permission, boolean> {
  const out = {} as Record<Permission, boolean>;
  for (const p of all) out[p] = role === 'kid' ? (kid[p] ?? true) : true;
  out.manage_people = role === 'admin';
  return out;
}

export const permissionText: { key: Permission; label: string; hint: string }[] = [
  { key: 'send_messages', label: 'Send messages', hint: 'Write in chats. Switched off, they can still read.' },
  { key: 'share_photos', label: 'Share photos', hint: 'Send photos from their device.' },
  { key: 'doodle', label: 'Doodle', hint: 'Draw on photos and send doodles.' },
  { key: 'play_games', label: 'Play games', hint: 'Join in with games in their chats.' },
  { key: 'start_games', label: 'Start games', hint: 'Begin new games for everyone.' },
  { key: 'video_calls', label: 'Video calls', hint: 'Start and join video calls, and play the call games.' },
  { key: 'direct_messages', label: 'Message one person', hint: 'Start one-to-one chats.' },
  { key: 'create_rooms', label: 'Start group chats', hint: 'Start chats for some of the family.' },
  { key: 'delete_others_messages', label: "Delete others' messages", hint: 'Tidy up any message, not just their own.' },
  {
    key: 'manage_kids',
    label: "Guardian to their family's kids",
    hint: "Say yes to those kids' friends from other families, change what the kids can do and their quiet hours, and read the chats they're in.",
  },
  { key: 'tasks', label: 'Daily tasks', hint: 'See their tasks for the day and tick them off.' },
  ...(calendarOn
    ? ([
        { key: 'calendar', label: 'See the family calendar', hint: "What's on, and the family's linked calendars." },
        { key: 'edit_calendar', label: 'Add to the calendar', hint: 'Put things on the family calendar and change them.' },
      ] as const)
    : []),
];

export const allPermissions = all;

// The features the home family chooses for each other bubble (the same list
// as Family.Permissions on the server), and the abilities each one covers.
export const bubbleFeatures: { key: BubbleFeature; label: string; hint: string; covers: Permission[] }[] = [
  { key: 'photos', label: 'Photos', hint: 'Share photos from their devices.', covers: ['share_photos'] },
  { key: 'doodle', label: 'Doodles', hint: 'Draw on photos and send doodles.', covers: ['doodle'] },
  { key: 'games', label: 'Games', hint: 'Play and start games in their chats.', covers: ['play_games', 'start_games'] },
  { key: 'calls', label: 'Video calls', hint: 'Start and join video calls.', covers: ['video_calls'] },
  { key: 'direct', label: 'Message one person', hint: 'Start one-to-one chats with anyone.', covers: ['direct_messages'] },
  { key: 'groups', label: 'Start group chats', hint: 'Start chats of their own.', covers: ['create_rooms'] },
  { key: 'tasks', label: 'Daily tasks', hint: 'A chart of daily tasks for their own family.', covers: ['tasks'] },
  ...(calendarOn
    ? [{ key: 'calendar' as const, label: 'The family calendar', hint: "See what's on at home, and add to it if they're grown-ups.", covers: ['calendar', 'edit_calendar'] as Permission[] }]
    : []),
];

/** The bubble feature that has switched an ability off for everyone in a bubble, if one has. */
export function switchedOffBy(bubble: Bubble | undefined, ability: Permission) {
  if (!bubble || bubble.home) return undefined;
  return bubbleFeatures.find((f) => f.covers.includes(ability) && bubble.features?.[f.key] === false);
}
