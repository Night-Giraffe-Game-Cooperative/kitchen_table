export type Role = 'admin' | 'grownup' | 'kid';

export type Colour = 'sky' | 'meadow' | 'sunflower' | 'apricot' | 'rose' | 'lilac' | 'sea' | 'slate';

export type Permission =
  | 'send_messages'
  | 'share_photos'
  | 'doodle'
  | 'play_games'
  | 'start_games'
  | 'video_calls'
  | 'direct_messages'
  | 'create_rooms'
  | 'delete_others_messages'
  | 'manage_kids'
  | 'calendar'
  | 'edit_calendar'
  | 'tasks'
  | 'manage_people';

export interface QuietHours {
  from: string;
  to: string;
}

export interface Person {
  id: number;
  name: string;
  role: Role;
  colour: Colour;
  avatar: string;
  active: boolean;
  last_seen_at: string | null;
  /** Their family bubble: one household. */
  bubble_id: number | null;
  // Present when you may manage this person.
  email?: string;
  must_change_password?: boolean;
  otp_expires_at?: string | null;
  overrides?: Partial<Record<Permission, boolean>>;
  permissions?: Record<Permission, boolean>;
  quiet_hours?: QuietHours | null;
}

// What the home family can switch off for another bubble.
export type BubbleFeature = 'photos' | 'doodle' | 'games' | 'calls' | 'direct' | 'groups' | 'tasks' | 'calendar';

/** A family bubble: one household. The home bubble runs Kitchen Table and chooses what the others can use. */
export interface Bubble {
  id: number;
  name: string;
  emoji: string;
  home: boolean;
  features: Record<BubbleFeature, boolean>;
  /** Grown-ups from other households an admin has made family to this household's kids. */
  relative_ids: number[];
}

/**
 * Two kids from different households who may chat once a guardian from each
 * says yes. ok_by follows kid_ids: who said yes for each kid, or null.
 */
export interface Friendship {
  id: number;
  kid_ids: [number, number];
  ok_by: [number | null, number | null];
  asked_by_id: number | null;
  approved: boolean;
}

export interface Me extends Person {
  email: string;
  must_change_password: boolean;
  permissions: Record<Permission, boolean>;
  quiet_hours: QuietHours | null;
  quiet_now: boolean;
}

export interface Media {
  key: string;
  url: string;
  width: number | null;
  height: number | null;
  type: string;
}

export interface Reaction {
  emoji: string;
  user_ids: number[];
}

export interface Message {
  id: number;
  room_id: number;
  user_id: number | null;
  kind: 'text' | 'photo' | 'doodle' | 'game' | 'system' | 'call';
  body: string | null;
  media: Media | null;
  game_id: number | null;
  data: { on_message_id?: number; live?: boolean; seconds?: number; people?: number[] } | null;
  deleted: boolean;
  reply_to: {
    id: number;
    user_id: number | null;
    kind: Message['kind'];
    body: string | null;
    media: Media | null;
    deleted: boolean;
  } | null;
  reactions: Reaction[];
  inserted_at: string;
}

export interface Room {
  id: number;
  name: string;
  kind: 'family' | 'group' | 'direct';
  emoji: string;
  created_by_id: number | null;
  member_ids: number[];
  /** False for an admin reading a chat they aren't in. */
  member: boolean;
  /** This person has quietened the chat's notifications. */
  muted?: boolean;
  unread: number;
  last_message: { id: number; user_id: number | null; user_name: string | null; text: string } | null;
  last_message_at: string | null;
  /** The video call going on in this room right now, if any. */
  call?: CallInfo | null;
  /** Why the chat is closed, when someone in it may no longer talk to someone else. */
  closed?: string | null;
}

export interface CallInfo {
  user_ids: number[];
  started_at: string;
  started_by: number;
  message_id: number;
}

export type Seat = number | 'team' | 'computer' | 'open';

export interface Game<S = Record<string, unknown>> {
  id: number;
  room_id: number;
  type: string;
  mode: 'coop' | 'versus';
  status: 'active' | 'finished';
  title: string | null;
  seats: Record<string, Seat>;
  state: S & { turn?: string };
  version: number;
  summary: string | null;
  created_by_id: number | null;
  last_move_by_id: number | null;
  updated_at: string;
  inserted_at: string;
}

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * Something on the family calendar. An all-day event has start_date and
 * end_date (its last day); a timed one has starts_at and ends_at in UTC.
 */
export interface CalendarEvent {
  id: number;
  title: string;
  emoji: string;
  notes: string | null;
  location: string | null;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  time_zone: string;
  repeat: Repeat;
  repeat_until: string | null;
  who: number[];
  /** app: kept here. caldav or ics: from a linked calendar, one row per day it happens. */
  source: 'app' | 'caldav' | 'ics';
  link_id: number | null;
  /** One time of something that repeats in its linked calendar, so it's changed there. */
  recurring: boolean;
}

/** A calendar kept elsewhere (iCloud, Fastmail, a school's feed) shown in the family calendar. */
export interface CalendarLink {
  id: number;
  user_id: number;
  provider: 'caldav' | 'ics';
  name: string;
  color: string;
  /** family: everyone who sees the calendar. me: only whoever linked it. */
  share: 'family' | 'me';
  /** Events can be added and changed from here. */
  writable: boolean;
  /** New events go here unless someone picks another. */
  default: boolean;
  host: string;
  /** Only for whoever linked it. */
  username: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  can_write: boolean;
  can_manage: boolean;
}

/** A calendar an account has, found when linking. */
export interface FoundCalendar {
  url: string;
  name: string;
  color: string | null;
  writable: boolean;
}

export type DayPart = 'any' | 'morning' | 'afternoon' | 'evening';

/** A job that comes round on some days of the week (1 is Monday), or once on on_date. */
/** A job to tick off, a reminder for grown-ups of what a child needs, or homework. */
export type TaskKind = 'job' | 'reminder' | 'homework';
export type HomeworkStatus = 'todo' | 'started' | 'done' | 'handed_in';

export interface Task {
  id: number;
  kind: TaskKind;
  title: string;
  emoji: string;
  notes: string | null;
  user_ids: number[];
  days: number[];
  on_date: string | null;
  part: DayPart;
  /** Homework only: the subject, when it's due and how far along it is. */
  subject: string | null;
  due_on: string | null;
  status: HomeworkStatus | null;
  /** What each tick (or homework handed in on time) earns. */
  stars: number;
  pence: number;
  sticker: boolean;
  created_by_id: number | null;
}

export interface TaskDone {
  task_id: number;
  user_id: number;
  on: string;
  done_by_id: number | null;
  stars: number;
  pence: number;
  sticker: string | null;
}

export interface Goal {
  id: number;
  user_id: number;
  title: string;
  emoji: string;
  stars: number;
  /** Stars earned since the goal was set. */
  progress: number | null;
  given_at: string | null;
}

export interface Payout {
  id: number;
  pence: number;
  paid_by_id: number | null;
  paid_at: string;
}

/** Someone's stars, pocket money, stickers and goals. */
export interface Rewards {
  user_id: number;
  stars: number;
  earned_pence: number;
  paid_pence: number;
  stickers: { sticker: string; on: string; task_id: number }[];
  payouts: Payout[];
  goals: Goal[];
}

