# Kitchen Table: design notes

## Who it's for

A family: two grown-ups, kids from about five upwards, grandparents. The kids
read slowly and tap a lot; the grandparents want big clear text. Everyone is
on a different device, and nobody should need an app store or an account
anywhere else.

## The look

The base: ink on warm paper, Atkinson Hyperlegible Next, colour kept
for people, status and focus rather than decoration. On top sits a tactile
layer: it should feel like things on a kitchen table.

- **Paper grain.** Two see-through grain textures (light and dark) drawn by
  `scripts/make_art.py` and laid over every sheet with CSS, so the colours
  underneath stay themable.
- **Sheets.** Lists, chats and dialogs are sheets of paper with a soft,
  warm shadow; the table behind them is a shade darker.
- **Pressed buttons.** Buttons have a solid bottom edge and sink onto it when
  pressed. Toggles, segmented choices and crayon-shaped colour swatches
  follow the same idea.
- **People's colours.** Each person picks one of eight colours. Their
  messages sit on that colour's paper tint and their name is in its strong
  shade; your own messages are ink-filled. Colour is never the only signal:
  names are always shown in groups.
- **Game boards.** Wooden chess and backgammon boards, a lined page with a
  margin for Story Chain (each writer's lines get their own highlighter
  colour), a garden of suns and flowers for Word Garden.
- **Reading help.** "Bigger text" scales the whole app; Read aloud is on
  every message and story; dark mode follows the device or can be chosen.

Layout: at 900 px and wider, a rail on the left and a list beside the open
chat or game. Narrower, a tab bar at the bottom, one screen at a time, and
the tab bar steps aside inside a chat or game to give the keyboard room.

## How it works

- **Server**: Elixir and Phoenix, JSON over HTTP plus Phoenix Channels for
  anything live (new messages, typing, who's here, game moves, live doodle
  strokes). SQLite through Ecto, so the whole app's data is one folder.
- **Web app**: TypeScript and React, built by Vite into the server's static
  folder, so one process serves everything. Hash routing (`#/chats/3`), so
  every address works without server routes.
- **Sign-in**: an HttpOnly cookie holding a random token (only its hash is
  stored), sliding 120-day expiry, and a custom header on every change so
  other sites can't post as you. Passwords are PBKDF2-SHA256 with 600,000
  rounds through Erlang's own `:crypto`.
- **Games**: the server is a referee that doesn't know the rules of any game.
  A game is a JSON state, a list of seats and whose turn it is; a move sends
  the whole new state with the version it was based on, and a stale version
  is refused so two people moving at once can't overwrite each other. The
  rules (and the computer players) live in the web app, so a new game is a
  new folder in `web/src/games` and no server change.
- **Video calls**: WebRTC, with every device connected straight to every
  other one. The server's call channel only passes the connection offers
  between devices, keeps who's in the call (Presence), rings the chat, and
  carries the shared parts: the game being played, photos for Pull a Face,
  reactions, and drawings on people's pictures. `Family.Calls` keeps each
  live call in memory and notes it in the chat when it ends.
- **Calendar and tasks**: events are rows in SQLite; a repeat is one row
  with a rule, and the web app works out the days it falls on (keeping the
  clock time when the clocks change, and skipping months without the day, as
  Google does). Tasks are rows with weekdays or a date, and each tick is a row
  of its own. Changes tell everyone who can see them over their own channel,
  and their screens fetch again.
- **Linked calendars**: `Family.Calendar.DAV` speaks CalDAV over Mint (which,
  unlike `:httpc`, sends PROPFIND and REPORT) and reads replies with OTP's
  streaming XML reader, which never turns a server's names into atoms.
  `Family.Calendar.ICal` reads iCalendar and works out the repeats itself
  (RRULE with EXDATE, RDATE and changed occurrences, in each event's own zone
  via `tz`), so a linked calendar's events are stored one row per occurrence
  and the web app treats them like one-offs. `Family.Calendar.Links.Sync`
  copies one link at a time, asking for the calendar's ctag first and
  skipping the copy when nothing changed, and only writes rows that differ.
  A change made here is written to the server first (a new object with
  If-None-Match, a change with If-Match, keeping the object's other
  properties such as alarms), then copied back.

- **Notifications**: standard Web Push, with nothing but OTP's `:crypto`.
  `Family.Push.WebPush` encrypts each message for its one browser (RFC 8291,
  checked against the RFC's worked example) and signs each request with the
  server's VAPID key (RFC 8292), which is made from `secret_key_base` rather
  than stored. A subscription belongs to the session that made it, so
  signing out (or the session expiring) drops it. Whether someone is using
  the app comes from the family presence channel: each device reports
  whether it's on screen and has been touched in the last three minutes, and
  nobody is sent a notification while any of their devices is in use.
  Sending happens in the background (a `Task.Supervisor`), never holding up
  the message itself. The service worker joins messages from one chat into
  one notification, and tapping one opens the app at that chat, call or game.

- **Your things**: `Family.Export` gathers a person's (or, for an admin,
  the family's) data into a zip written by `Family.Zip`, which streams
  entries to disk one at a time and switches to zip64 past 4 GB, so years of
  photos never sit in memory. `Family.Erase` removes an account in one
  transaction: their messages become "Message deleted", their media, ticks,
  rewards, linked calendars, sign-ins and push devices go (most by the
  database's own cascades), and they're taken off shared tasks and events.
  Their devices are told to sign out, and open chats reload.

## Decision log

**19 Oct 2026. TypeScript web app and Elixir server, not Godot.** One web
app reaches the kids' Android tablets, the family's iPhones
and any computer, and updates itself everywhere at once. Elixir because
Phoenix Channels and Presence make the live parts (chat, typing, live doodles)
small.

**19 Oct 2026. SQLite, not Postgres.** One family is a tiny load; one file
in the data folder makes backup a copy, and a 1 GB VPS doesn't have to run a
database server.

**19 Oct 2026. Three roles with switchable abilities.** Admins, grown-ups and
kids. Roles give the defaults and an admin can switch single
abilities for one person, which covers "this kid can start chats, that one
can't" without inventing more roles. Grown-ups can be allowed to manage kids'
abilities and quiet hours, but only admins add people, change roles or reset
passwords.

**19 Oct 2026. One-time passwords are three words and a number.** Easier to
read out to a child or type on a tablet than random characters, and still
strong enough for a 7-day, one-use password. Signing in with one gives a
session that can only choose a new password. The admin sees it on screen as
well as by email, because a kid may not have an inbox.

**19 Oct 2026. Email goes to an outbox until SMTP is set up.** Running at home
needs no mail account. Every email is kept so an admin can find a lost
invitation. A small SMTP client (STARTTLS or TLS, AUTH LOGIN) avoids a
mailer dependency.

**19 Oct 2026. Co-op first.** We prefer playing together. Five of the
eight games are only co-op, and chess and backgammon start as the family on
one team against a friendly computer with three levels, with a versus mode
as well.
Doodle Battle is the one versus-only game, and it is stars for favourites,
not a winner and losers.

**19 Oct 2026. Versus as well, still co-op first.** Games should allow
playing against each other too. Word Garden, Picture Puzzle and Story
Chain gained an "Against each other" mode beside "Together", which stays the
default. Word Garden takes turns (a right letter goes again); Picture Puzzle
is a race on the same jumble, fewest swaps winning and time only breaking
ties, timed from each person's own Start so slow-turn play stays fair; Story
Chain lets everyone star their favourite lines. Doodle Telephone and Doodle
Together stay co-op: scoring the telephone would make people draw safely, and
pit a five-year-old's drawing against a grown-up's.

**19 Oct 2026. Games suit slow turns.** Every game works with people playing
hours apart. Chess and backgammon in co-op let anyone in the family make the
team's move. Word Garden, Picture Puzzle and Story Chain let anyone add at
any time (Story Chain asks before you add two lines in a row).

**19 Oct 2026. Photos are shrunk on the device.** At most 1600 px on the long
side, as JPEG (small PNGs such as drawings stay PNG, GIFs are passed
through), so uploads are quick on home Wi-Fi and the data folder stays small.

**19 Oct 2026. Doodles are drawn on a 1000-unit-wide page.** Strokes are
stored as points on a fixed-width page and drawn at whatever size the screen
is, so a doodle made on a phone looks the same on a tablet. A finished doodle
is also saved as an image so the chat can show it without redrawing.

**19 Oct 2026. Name: Kitchen Table.** Where a family sits together to talk,
draw and play. It is a setting (`app_name` in `server/config/config.exs`) if
you prefer another.

**19 Oct 2026. Hex packages, with a GitHub fallback.** Normal machines use
hex.pm. The machine this was first built on couldn't reach hex.pm, so
`FAMILY_GIT_DEPS=1` fetches the same versions from GitHub, locked separately
in `mix.git.lock`.

**19 Oct 2026. Video calls connect devices directly.** A FaceTime-style
call with games. A mesh (every device to every other) needs
no media server, keeps pictures and sound inside the house, and is fine for
up to about six people. Calls across networks will need a TURN relay, which
is three settings once the VPS exists.

**19 Oct 2026. A secure address at home.** Browsers only allow the camera on
`https://` (or on localhost), so the server also serves the app on port 4443
with a certificate it makes for itself, covering the PC's own addresses. Each
device clicks past one warning the first time. The plain address stays for
anything that doesn't need the camera.

**19 Oct 2026. Drawing over the call.** The idea of "facey time" here is
the family drawing on each other over the video.
Anyone can draw on anyone's picture. Drawings are kept in the coordinates of
the person's camera picture (0 to 1 across and down), not the screen, so a
moustache stays under the same nose on a phone, a tablet and a PC, even
though each crops the picture differently and your own picture is mirrored.
Strokes travel in small pieces twenty times a second so others watch them
being drawn, with the drawer's name by the pen. Finished drawings are kept
for people who join late and go when the person they're drawn on leaves.

**19 Oct 2026. Call games share one state.** The game in a call is one JSON
state that whoever acts sends to everyone, like the chat games but without
turns or versions, since everyone is there at once. Times are sent as "this
much left" rather than a clock time, because devices' clocks disagree.

**19 Oct 2026. Papercraft drawing.** Drawing leans on
papercraft: raw edges, layering, drawing on the paper. Torn paper and cut-out
shapes are pieces laid on the page in order, with fibrous or snipped edges and
soft shadows, and pens draw over them. Every bit of texture is seeded from the
item's own data rather than random, so a stroke looks the same on every screen
and while it's being drawn. Old drawings still show; their crayon strokes now
draw as wax crayon.

**19 Oct 2026. A small app for the kids' tablets.** The kids' tablet had no
"Add to home screen" in Chrome, most likely because its kids' home screen
doesn't take shortcuts. Rather than wait for the VPS, `android/` has a tiny app
that shows Kitchen Table in a WebView, built with the SDK's own tools and no
Gradle so it builds offline on the PC. It trusts the PC's home-made
certificate on first sight and only that certificate after, and only for an
address on the home network. The web app stays the one app; this is its frame.

**19 Oct 2026. Online on a small VPS.** So it works away from home too.
Caddy in front for the certificate, the app listening only on the machine
itself and believing Caddy's forwarded headers (so sign-in limits see real
addresses and the cookie is marked secure). A fresh site on the internet
could be claimed by whoever opened it first, so there the first admin needs a
setup code from the server. Releases are built by GitHub Actions on the same
Ubuntu as the VPS, so the 1 GB machine never compiles anything. coturn on the
same VPS relays calls between houses and refuses to relay to private
addresses. Nightly backups use SQLite's own online backup.


**20 Oct 2026. Admins can read every chat.** An admin should see all chats
without being part of them. Admins get every other chat in a second part
of the chat list, "Everyone else's chats", and open them read-only: no
composer, reactions, replies, doodling, calls or game links, and the server
refuses writes there as before. Reading is invisible to the people in the
chat: an admin's typing isn't passed on, nothing is marked read, and they
aren't rung for its calls. Those chats never count as unread for the admin,
so the badge only counts their own chats. It's tied to the admin role, not a
switchable ability.

**20 Oct 2026. Family bubbles.** Friends and cousins come in too, each
coming with parental oversight, where a parent oversees only the chats their
own child is in. Everyone now belongs to a bubble (a household). The people
already here became the home bubble, named after the first admin, and only it
is in the whole-family chat. A kid can only join a bubble that has a grown-up
in it. "Look after kids" (on for grown-ups unless switched off) now means the
kids in your own bubble: their settings, and reading every chat they're in,
the same invisible read-only way admins read. It stays one ability rather than
a parent-to-child link, so a household's grown-ups share the job and an admin
can switch it off for, say, a grandparent at home. Tidying up others' messages
is limited to your own bubble too, so a visiting grown-up can't delete the
home kids' messages. Admins still read everything.

**20 Oct 2026. Learning the games.** Tips on how to play chess and
backgammon, so playing is a learning experience rather than hand-holding
or confusing. Every game has a How to play page. In chess and backgammon a
small note under the board explains what's in front of you at the moment it
matters: how the piece you picked up moves, why a piece can't move (blocked,
pinned, or you're in check), castling and en passant when they're possible,
what the other side just did if it was unusual, the bar, hitting, safe points
and bearing off. The notes explain rules and ideas but never say which move
to make. The chess hint, which already lit up a move, now also says why it's
good (it takes a piece safely, gives check, escapes an attack, develops a
piece). Each tip shows at most three times per device, so they fade as the
game is learned; the switch in How to play turns them off and back on again.

**20 Oct 2026. Playing the computer on your own.** Games don't have to be the family against the computer; one person against the computer should be
an option too. Chess and backgammon's "Against the computer" now asks who
plays it: everyone in the chat, as before, or just the person starting it.
A solo game sits in the chat like any other, so the others can watch, but
only its player moves, asks for hints or takes moves back.

**20 Oct 2026. A calendar and daily tasks.** A calendar and a daily tasks
section, with the calendar linked to a Google calendar the family can
share. The calendar belongs to the home family, like the Whole family chat:
visiting families have their own homes and calendars. Kids see it but don't
change it by default, a new ability an admin or their grown-up can switch on.
Google is linked with a service account rather than signing in as a person:
there's no sign-in to expire, nothing the kids' tablets need, and the shared
calendar shows who can change it right in Google's own sharing settings. Once
linked, Google holds the events so there's one calendar, not two kept in step
both ways. Tasks are for everyone, not just kids, and the stars are counted
per week so a missed day doesn't spoil a streak. Ticking is allowed for past
days (it was done, just not ticked) but not days still to come.

**20 Oct 2026. The calendar switched off, tasks kept.** On the first try at
linking Google, I stopped for now and took the calendar off. The
daily tasks stay. The calendar code, its abilities and the Google link remain
in the app behind one switch (`calendarOn` in `web/src/lib/features.ts`), so
it can come back without rebuilding it; its data on the server is kept.

**21 Oct 2026. The home family chooses what other families get.** The
main family controls which features other family groups have, and they can
never be admins (a bubble for the in-laws, say). Each bubble
now has a set of feature switches, kept by the home family's admins; the
server applies them when it works out anyone's abilities, so every existing
check honours them with no change of its own, and a person's own settings
are kept underneath for when a feature comes back. Chatting is always on,
since a bubble without it would have nothing left. Daily tasks became an
ability of their own so a bubble can go without them. Admins are refused
anywhere but the home bubble, by the server rather than just the screens, and
the upgrade turns any admin already sitting in another bubble into a
grown-up there (only if an admin is left at home).

**21 Oct 2026. Rewards, reminders and homework, all in Tasks.** Kids'
tasks can be tied to rewards (pocket money, stars, stickers); for parents,
tasks should be a reminder of what a child needs that day; and homework
tracking should go in with tasks. All three became kinds of task, so they
share the days, the people, the live updates and the permissions already
there. A tick keeps a copy of what it earned rather than looking it up from
the task, so changing a task's reward never changes the past or what's owed.
Stickers are picked by the server when the tick lands, so they can't be
re-rolled from the screen. Pocket money only comes from grown-ups (a kid's
own task pays nothing), and nobody pays themselves or sets their own goals.
Reminders are for the grown-ups in the child's own bubble, not every admin,
so a visiting family's PE kit doesn't land on the home admin's Today. Homework is one
child's, has steps rather than a tick, and only earns when handed in by the
day it's due.

**21 Oct 2026. The calendar back, linked with the family's own calendars.**
Calendar integration "from various web calendar providers", both ways.
The service-account link to Google went: it asked a lot of a family to set
up. In its place, anyone who can change the calendar links calendars they
already use: CalDAV (iCloud, Fastmail, Nextcloud and most others) both ways with a username and password, which for
iCloud is an app-specific password, and any calendar's iCal address to read
(Google's and Outlook's secret addresses, schools, clubs). Google and
Microsoft both ways need each family to register an app with them, so they
come later. The app's own calendar stays: linking adds calendars beside it
rather than moving events out. Each link is the family's or just its owner's,
so a grown-up can see their work calendar here without the family seeing it;
admins don't see someone's private link either. Repeating events stay owned
by the calendar they come from: copying them as single days keeps the app
simple, and changing a whole series from here is left to the calendar that
holds it. The server only reaches out to the internet unless told otherwise,
so a link can't be used to poke at the machine it runs on.

**21 Oct 2026. Notifications, the Web Push way.** The first of the v1
must-haves. Web Push needs no account with Google or Apple and no app in a
store, and it reaches Android, Windows, Macs and, from iOS 16.4, iPhones and
iPads with the app on the Home Screen. Everything that pops up is something
that needs the person (a message, a call, their turn); nobody is notified
about what they'd see anyway, because the app knows when one of their
devices is in use. Kids' quiet hours keep their tablets quiet too, which also
means quiet hours now go by the family's time zone rather than the server's
clock. A chat can be muted from its header, for the busy ones. The server
only sends to addresses on the internet, so a made-up subscription can't
point it at the home network.

**21 Oct 2026. Taking your things, and leaving for good.** A v1 must-have,
and the honest thing for an app that keeps a family's photos and messages.
Everyone can download what's theirs; an admin can download everything. The
download is plain JSON and the original photos, so it's useful without the
app. Deleting is for good rather than hidden: what someone wrote and shared
goes, while what belongs to the family (events, games, the group chats they
made) stays. Kids can't delete themselves, since a tap on a tablet shouldn't
lose a child's account, and an admin removing someone types their name, so
it can't be done by accident. The family can't end up without an admin, or
kids without a grown-up.

**21 Oct 2026. Who kids can chat with, and guardians.** The rule: only
related grown-ups talk to children, and two children from different families
chat once both families' parents say yes. Grown-ups chat with any grown-up,
so a school friend's parents can check in with each other. A kid chats with
the grown-ups in their own household, and with grown-ups from other homes
that an admin has made family to that household (grandparents, aunts and
uncles). Kids in one household chat freely; kids from different households,
cousins included, need a yes from a guardian on each side. A kid's guardians
are the grown-ups in their own household who look after its kids, so an admin
says yes for the home family's kids but not for anyone else's. The rule
applies to everyone in a chat, group, game or call at once, and when a yes is
taken back the chat closes rather than vanishing, so what was said can still
be read. "Guardian" replaces "parent" and "looks after" in the app, since the
grown-ups who say yes aren't always parents.

**21 Oct 2026. Taking a game off the list.** Pressing and holding a game, or
right-clicking it, takes it off that person's list. A game still going stops
for everyone when the person started it, plays in it, or is an admin;
otherwise it carries on for the others. It stays in the chat either way.

**21 Oct 2026. Age groups, learn mode, and putting idle games away.** Every
game is set up for 5–7, 8–10, 11–13 or 14 and up, chosen in New game and kept
in the game, so everyone playing sees the same game. The age group replaces
the separate word size, computer strength and puzzle size settings, since
they all answer the same question. Younger groups get more clues and tips;
14 and up gets the hardest version with no tips. Learn mode is separate from
the age group because a grown-up new to backgammon needs the basics as much
as a child does: it's switched on per game on one device, shows the basics
before playing, and every tip every game. The device remembers the last age
group chosen; children start on 5–7 and grown-ups on 8–10. A game nobody has
moved in for two days is put away as finished by the server once an hour, so
the Games list doesn't fill with games everyone has forgotten.

**22 Oct 2026. Kids' own tasks and reminders, and labels you can hold.**
Kids can set tasks, homework and reminders for themselves, with no reward:
rewards come from guardians, so a task a kid set earns nothing even if a
grown-up changes it later (a guardian who wants to reward it sets their own).
A kid sees the reminders they set and their guardians see them too, while
the ones grown-ups set about a kid stay with the grown-ups. Icon buttons had
only the browser's own hover text, which never shows on a tablet, where the
family mostly plays. They now show a label on hover, keyboard focus, or a
press and hold, and a hold doesn't press the button, so holding is a safe way
to ask "what does this do?". Most screens already explain themselves in a
line of grey text, so the (i) notes are kept to the few places that didn't.

**22 Oct 2026. Six more games, on shelves.** Pairs, Where's the Giraffe?,
Family Quiz, Snakes and Ladders, Four in a Row and Dots and Boxes bring the
games to fourteen, so New game puts them on three shelves (drawing and
stories; puzzles, memory and quizzes; board games) rather than one long list.
Two of them use the family's own photos from the chat, like Picture Puzzle,
because a game about your own kitchen is more fun than one about a stock
picture. Where's the Giraffe? keeps the hiding place in the game's state like
any other move, so a determined child with the browser's developer tools
could find him; it's a family game and a referee on the server would mean
game rules there, which the app avoids. A computer opponent can't take a
turn of its own, since the server only lets the seat whose turn it is move,
so its reply is worked out in the same move as the person's, as chess does.
Family Quiz is played in people's own time: it asks everyone in the chat for
questions, but once answering starts it only waits on (and only shows "Your
turn" to) the people who wrote some. A game that goes wrong on one device now
shows a reload button instead of blanking the app, and chess games keep a
computer level older copies of the app understand.

**22 Oct 2026. Google and Outlook calendars both ways.** Google's and
Outlook's calendars could only be shown from their secret addresses, because
writing to them needs signing in with OAuth, and that needs the app
registered with each in the name of whoever runs it. An admin now pastes the
registered app's client ID and secret into Linked calendars (or the server
is started with them), and then anyone who can change the calendar signs in
and picks calendars, as with iCloud. Google's and Microsoft's own APIs are
used rather than Google's CalDAV, which needs full access to every calendar,
and Microsoft has none: both work out repeating events into occurrences, so
they fit the rows linked calendars already keep, and repeating events are
still changed where they live. The scopes asked for are the narrowest that
work: events, and the list of calendars. Tokens are sealed like CalDAV
passwords; Microsoft's refresh token changes each time it's used, so the new
one is kept. Signing in comes back to the browser that started it and checks
it's the same person, so nobody can attach their own Google account to
someone else's Kitchen Table. An account nobody links a calendar from is
let go after an hour, and Google is told to forget it.

22 Oct 2026. A privacy page. Google won't publish an app that signs people
in to Google without a privacy policy on the app's own domain, so every
Kitchen Table has one at `/privacy`, readable without signing in and linked
from the sign-in screen and Me. It's plain words about what this app does:
what it keeps and where, that calls aren't recorded, and exactly what
linked calendars are used for, with the Limited Use statement Google's User
Data Policy asks for. It names nobody, as each family runs its own copy;
questions go to whoever set it up.

23 Oct 2026. A morning summary. One notification a day saying what the day
holds, so nobody has to open the app to find out: the calendar, the kids'
reminders, homework due and a count of jobs, ending in a tap through to
Today, which already shows all of it. Grown-ups get their household's at
seven by default, because that's who keeps track; kids only get their own
if they choose a time. It's worked out on the server at send time, with
repeats done the way the web app does them, in the family's own time. A
day with nothing on sends nothing rather than "Nothing today". Quiet hours
hold it back, but one more than four hours late is dropped (and the push
service is told it's stale after four hours), as a lunchtime "good
morning" is worse than none.

23 Oct 2026. An evening summary of tomorrow. The same notification at eight
the evening before, because seven in the morning is too late to find the PE
kit or sign a form. It leaves out the jobs (they're done on the day) and
says "Tomorrow" in the title. It shares the morning one's code, defaults and
rules, with its own time and switch, so either can go without the other.
