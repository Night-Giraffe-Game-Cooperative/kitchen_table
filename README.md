# Kitchen Table

A private place for a family to talk, share and play: messages, photos,
papercraft doodles, games you play together, video calls you can draw on, a
family calendar, and kids' tasks with stars and pocket money.

You run it yourself, on a computer at home or on a small server of your own,
and every device just opens it in a browser: kids' tablets, Android phones,
iPhones, iPads and computers. Only people an admin adds can get in, children
only chat with people their family trusts, and nothing goes to anyone else's
servers. There are no adverts, no accounts with anyone, and nothing to buy.

**[Get going](docs/getting-started.md)** · [What's in it](#whats-in-it) ·
[How it's built](#how-its-built) · [Working on it](#working-on-it) ·
[Design notes](docs/design.md)

## From the Night Giraffe Game Cooperative

Late at night, when the house is asleep, the Night Giraffe comes visiting.
He is very tall and very quiet, and he walks from street to street on long
soft legs, peering in at bedroom windows with a gentle, sleepy face. If
you've left a little food out on the step for him (a carrot, a crust, half a
biscuit you were saving), he eats it in one careful crunch. He always says
thank you. By morning he has left good dreams behind him, and somewhere in
the house there's a silly game that wasn't there before.

The Night Giraffe Game Cooperative makes those games: small, kind games for
families to play together, with no adverts, no shouting and no catches.
Kitchen Table is the one that keeps the family in touch between the games.
Leave a crust out tonight, just in case.

## Quick start

You need Erlang/OTP 26+ and Elixir 1.17+ ([install](https://elixir-lang.org/install.html))
and Node 20+ ([install](https://nodejs.org)).

```sh
git clone https://github.com/Night-Giraffe-Game-Cooperative/kitchen_table.git
cd kitchen_table
scripts/start.sh                                                     # Mac or Linux
powershell -ExecutionPolicy Bypass -File scripts\start.ps1           # Windows
```

Open <http://localhost:4000> and make yourself the first admin. Tablets and
phones on the same Wi-Fi open the `https://` address the script prints. The
[getting going guide](docs/getting-started.md) takes it from there: adding
your family, other households and guardians, the Android app, email, linked
calendars, notifications, putting it online with a proper address, backups
and updates.

## What's in it

**People.** There are three kinds: admins, grown-ups and kids. Only an admin
can add someone, by name and email. They get a one-time password (three words
and a number, like `cabin-clover-berry-42`) by email, and the admin sees it
on screen too, to read out or write down. It works for 7 days, and signing in
with it leads straight to choosing a password of their own. Admins can also
give someone a new one-time password, change their role, or switch them off.
A kid with no email, like a young cousin, is added with the email left empty
and gets a sign-in code instead: they press "No email? Sign in with a code" on
their own tablet and type it in. It works once, and that device stays signed
in; for another device, an admin or their guardian makes a new code.

**Family bubbles.** Everyone belongs to a family: one household. The family
that runs Kitchen Table is the home bubble, and only it is in the "Whole
family" chat. Friends and cousins come in a family of their own, which the
admin makes when adding its first person. A kid can only be added to a family
that already has a grown-up, so every kid comes with a guardian. A family's
grown-ups are guardians to that family's kids only: they change those kids'
settings and can read the chats those kids are in, without being in them and
without anyone seeing. Admins can read every chat.

**Who kids can chat with.** Grown-ups can chat with any grown-up, so a
friend's parents can check in. A kid can chat with the grown-ups in their own
family, and with grown-ups from other families that an admin has made family
to them (grandparents, aunts and uncles: Family, the pencil beside the
family's name, or "Choose family from other homes" on a kid's page). Kids in
one family chat freely. Kids from different families, cousins included, can
chat once a guardian from each family says yes: a kid asks from New chat, or
a guardian adds a friend on the kid's page, and the guardians who still need
to answer see it under "Waiting for your yes" on the Family page, with a
notification. A chat, group, game or call goes ahead only when everyone in it
may chat with everyone else. Taking a yes back closes their chats, which stay
readable.

Admins only ever come from the home family; the server refuses to make
someone in another family an admin, or to move an admin out. The home family
chooses what each other family can use (Family, the pencil beside that
family's name): photos, doodles, games, video calls, messaging one person,
making group chats and daily tasks. Chatting is always on. Anything switched
off there is off for everyone in that family, whatever their own settings say,
and their screens hide it straight away.

**What each person can do.** Every role starts with sensible abilities, and an
admin can switch any of them on or off for one person. A grown-up who is
a guardian to their family's kids can do the same for those kids, and set
their quiet hours (times when they can read but not send).

| Ability | Admin | Grown-up | Kid |
| --- | --- | --- | --- |
| Send messages, share photos, doodle | ✓ | ✓ | ✓ |
| Play games, start games | ✓ | ✓ | ✓ |
| Message one person | ✓ | ✓ | ✓ |
| Video calls | ✓ | ✓ | ✓ |
| Make group chats | ✓ | ✓ | off |
| Delete others' messages (a grown-up: from their own family) | ✓ | ✓ | off |
| Guardian to their family's kids: say yes to friends, read the kids' chats | ✓ | ✓ | off |
| See the family calendar (other families only if the home family switches it on) | ✓ | ✓ | ✓ |
| Add to the calendar, change it, link calendars | ✓ | ✓ | off |
| Daily tasks | ✓ | ✓ | ✓ |
| Add people, change roles, reset passwords | ✓ | | |
| Read every chat, without being in it | ✓ | | |

**Chat.** A family chat everyone is in, group chats and one-to-one chats.
Photos (shrunk on the device before sending), doodles, doodling on top of any
photo, reactions, replies, read aloud, "typing…", unread counts, and live
updates on every device at once.

**Video calls.** Start one from any chat, and everyone else in it gets a
ringing card with Join. Each person shows as an instant photo on a dark
kitchen table, with mute, camera off, flip camera and floating reactions.
Anyone can get the felt tips out and draw on anyone's picture, live:
scribbles, moustaches, clown noses, crowns, with an Idea button for silly
suggestions and Save a picture to keep it in the chat. Drawings stick to the
person's face on every screen. There are games to play in the call too: Pull
a Face (everyone's camera snaps the same silly face; give stars), Act It Out
(charades with a timer) and Draw Together. The pictures and sound go straight
between the devices; the server only introduces them. It suits up to about six
people.

**Games.** Started from any chat, played at everyone's own pace. A game waits
for its next move as long as it needs to, and the app says when it's your
turn. Games keep out of the chat's messages: the games going on in a chat
show as a slim strip at its top, and the people asked to play get a "New
game" notification. New game asks who's playing first: the family together,
just you against the computer, or people you pick by name. Playing one person
puts the game in your chat with them (starting one if there isn't one yet),
and a game one person plays against the computer is only on their own list.
Every game has a How to play page (the book button), and
the games explain themselves as you play: picking up a piece says
how it moves, special rules are explained when they come up, and a chess hint
says why the move is good. Each tip shows a few times on a device and then
stops, and How to play can switch them off. Pressing and holding a game in the
Games list, or right-clicking it (or the bin in the game), takes it off your
list; a game still going stops for everyone if you started it or play in it.
A game nobody has touched for two days is put away as finished. Finished
games leave the list, except the ones that made something to keep: pictures
from the doodle games and stories from Story Chain. Play again
keeps everyone together: whoever is looking at the finished game moves on to
the new round with the person who pressed it, and whoever played last time
gets a "Next round" notification.

Every game is set up for an age group: 5–7, 8–10, 11–13 or 14 and up. Younger
groups get easier words and more clues (the picture in Word Garden, the
finished photo beside the puzzle), gentler computer players and more tips;
older ones get harder words, smaller puzzle pieces, a stronger computer and no
tips. Learn mode, switched on in New game or How to play, teaches a game's
basics a step at a time before playing, then explains as you go: the other
side's chess and backgammon moves, a warning before a piece is left to be
taken, letters read aloud, the shape of a story. It's remembered for each game
on each device.

The New game list puts the games on five shelves.

| Game | How it's played |
| --- | --- |
| **Drawing and stories** | |
| Doodle Together | One big page everyone draws on at the same time, live |
| Doodle Telephone | Words become a drawing, the drawing becomes a guess, and on |
| Story Chain | Write a story one line each, then read it aloud; against each other, everyone stars their favourite lines |
| Doodle Battle | Everyone draws the same thing in secret, then gives stars |
| **Puzzles, memory and quizzes** | |
| Word Garden | Find the hidden word together, a letter at a time, or take turns and grow the most flowers |
| Picture Puzzle | A family photo cut into pieces; everyone swaps pieces back, or race on the same jumble (fewest swaps wins) |
| Pairs | Turn over two cards to find a pair, with cards made from the family's photos (or animals or treats); together in as few turns as you can, or taking turns |
| Where's the Giraffe? | Someone hides the Night Giraffe in a family photo and everyone else taps to find him, with warmer and colder clues for younger ages |
| Family Quiz | Everyone writes questions about themselves, then answers everyone else's in their own time; the youngest can make a question with taps alone |
| **Board games** | |
| Snakes and Ladders | Against each other, or the family against the Night Giraffe, on a smaller board for the youngest |
| Four in a Row | Against a computer (its strength set by age), as the family or just you, or each other |
| Dots and Boxes | Draw lines and claim boxes, against the computer or up to four players; the board grows with age |
| Chess | Against a friendly computer (its strength set by age), as the whole family or just you, or each other |
| Backgammon | The same: the computer, as the family or just you, or each other |
| **Cooking** | |
| Sushi Train | Everyone in the chat runs a sushi bar together. Customers show what they'd like; each person makes dishes at their own station (rice and a topping for nigiri, seaweed, rice and fillings rolled up for maki, miso soup and edamame) and sends their plate down the belt. Each wave orders something trickier, quick waves earn stars, and the dishes have their Japanese names. For the youngest, what to tap next glows |
| **Just for you** | |
| Bonsai | A little tree of your own (maple, pine or cherry blossom), painted in watercolour. Water it, trim it, feed it and sweep up its leaves a few minutes a day; it grows and changes with the real seasons, visitors drop by (some nights the Night Giraffe), and looking after it unlocks pots and things to put beside it. Nobody else sees it, and it never dies |

**Learn.** Phrases and characters for a family holiday, in Japanese or French.
Phrases come in topics (hello and goodbye, manners, food, getting around,
shops, help, numbers), each with the words, how to say them in English
sounds, and a speaker to hear them, slowly too. Signs to spot (exit, toilets,
open, closed) are their own tab, and Japanese adds hiragana and katakana: a
chart to tap and hear, and a quiz. Everyone presses "I know it" on what
they've learned, and the family can see who knows what, so learning it is a
shared thing. There's a phrase of the day, flashcards that start with what
you don't know yet, and an age choice: 5 to 7 keeps to the simplest
phrases, and older ages add more. Phones and computers read aloud with their
own voices; the Android app does too (see
[part 5 of Get going](docs/getting-started.md#5-the-android-app-for-kids-tablets)).

A grown-up can set when the family goes, and then Learn counts the sleeps
until the holiday for everyone at home, with a new fact about Japan each
day.

Japanese also has a Travel tab. Spot it is a bingo card of sixteen things to
find on the trip (a shrine gate, a deer in Nara, a toilet with buttons):
everyone ticks what they spot, sees whose faces are on each square, and four
in a row is bingo. Bullet trains are for everyone: the
words in their own topic, station signs (ticket gates, platform, carriage,
reserved seats), what's good to know (where to queue, which side for Mount
Fuji, big suitcases) and a quiz. Driving is for grown-ups only: Japan's road
signs drawn as you'll see them, with what each means and how it differs from
home, the rules that catch visitors out, and a ten-question road test with
the real test's pass mark of 90%. Passing the quiz or the test shows on the
family's progress.

**Calendar and tasks.** A family calendar with Today, Month, Week, Homework
and Rewards views. Events can be all day or timed, run over several days,
repeat (every day, week, month or year, until a date), and say who they're
for, where and any notes. Each person's things carry their colour. It belongs
to the home family: other families see it only if the home family switches it
on for them, and kids see it but don't change it unless an admin or their
guardian switches that on. Tasks are little jobs (make your
bed, feed the cat, read for ten minutes) that come round on chosen days, or
once, in the morning, afternoon, evening or any time. Today shows each
person's tasks as big rows to tick, and the week chart gives a star for every
one done. Anyone sets tasks for themselves, guardians for their kids, admins
for anyone, and a tick shows on every screen at once. Kids see only their own
tasks. When a kid ticks off a task a grown-up set, or hands in homework, it
waits under "To check" on a grown-up's Today until they say "Yes, done" (or
"Not yet", which takes the tick away); only then does it count and earn its
reward. The tasks kids set themselves are theirs to tick.

**Rewards.** A task can earn stars (none to three), pocket money and a
surprise sticker for the sticker book. Each tick keeps what it earned, so
changing a task later doesn't rewrite the past. Pocket money adds up until a
guardian marks it paid (all or some, with an undo), and grown-ups set goals: a treat for so many stars, counted from when the
goal is set, with a bar filling up and "Mark given" once it's reached.
Rewards come from guardians: kids can set tasks, homework and reminders for
themselves, but the ones they set don't earn anything. Kids see only their own rewards.

**Reminders.** Things a child needs on certain days, like PE kit
on Tuesdays or a swimming bag on Fridays. They show on a grown-up's Today
under "What the kids need", to tick once sorted, with tomorrow's listed
underneath so bags can be packed the night before. Kids can set reminders for
themselves too, which show on their own Today under "Things to remember" and
to their guardians as well; kids never see the ones grown-ups set.

**Labels and notes.** Every button that's only a picture says what it does:
on hover with a mouse, on keyboard focus, and when pressed and held on a
tablet or phone (the hold shows the label instead of pressing it). A small (i)
beside a few ideas that need a sentence of explaining (today's tasks,
reminders, rewards, waiting for your yes) opens a note.

**Homework.** Set on one day, due on another, with a subject and notes. Kids
add their own and move it along: to do, started, done, handed in. It shows on
Today from the day it's set, amber when due tomorrow and red when late, and
handing it in on time can earn a reward like any task. Grown-ups see their
kids' homework in one place.

**Linked calendars.** Calendars the family already uses show in the family
calendar, each in its own colour. Google, Outlook, iCloud and other CalDAV
calendars (Fastmail, Nextcloud, Zoho, Yahoo and the like) go both ways: add
an event here and it's on everyone's phones, change one on a phone and it
changes here. Google and Outlook need signing in, once Kitchen Table is
registered with them ([how](docs/calendar-sign-in.md)). A calendar's address
(a school's or a club's, or Google's or Outlook's secret iCal address) is
shown here and changed where it's kept. Whoever links a calendar chooses
whether the family sees it or only they do. See
[Linked calendars](docs/getting-started.md#7-linked-calendars) in the guide.

**Privacy.** `/privacy` says in plain words what the app keeps, where, and
what it does with linked calendars. Anyone can read it without signing in,
and Google needs it before Kitchen Table can be published there.

**Notifications.** Each phone, tablet or computer can switch them on from
Me. A new message, a call ringing (then "Missed call" if nobody answered), a
game you're asked to play and your turn in it pop up while the app is
closed. Nothing pops up on any of your devices while you're using the app on
one of them, so the phone stays quiet while the tablet's in your hands. Messages in one chat join up into one
notification. Quiet hours keep a kid's devices quiet, the bell at the top of a
chat mutes just that chat, and signing out of a device stops its
notifications. Each morning, grown-ups get a summary of the day (what's on,
what to remember, homework due, jobs) that opens Today, and at eight in the
evening one about tomorrow; anyone can change their times or switch either
off. On an iPhone or iPad they need the app on the Home Screen
first (iOS 16.4 or later). The Android app shows them too, with the same
switches under Me, and without Google: it checks for them itself, about
every minute while it's open or in the background, otherwise every 15
minutes or so, as Android allows. See [Notifications](docs/getting-started.md#8-notifications) in the guide.

**Your things.** Anyone can download what's theirs from Me: their messages,
reactions, photos and doodles, events, tasks, games and settings, in a zip
of plain files any computer opens. An admin can download the whole family
from Family. Grown-ups can delete their own account from Me (kids ask a
guardian), and an admin can delete anyone's. Deleting is for good: the
messages, photos and doodles they shared go, each message leaving a
"Message deleted" so replies still make sense, while what the family shares
(events, games, group chats) stays without their name on it.

**Drawing.** Papercraft first: tear strips and scraps of paper with rough,
fibrous edges, snip out shapes (hearts, stars, clouds, leaves…) in plain,
kraft, tissue, spotty or gingham paper, layer them up, then draw on top with a
felt tip, paintbrush, pencil, wax crayon or highlighter. The same tools are in
doodles, doodling on photos and Doodle Together.

**The look.** Ink on warm paper, made tactile: a grainy paper
table, sheets that cast a soft shadow, buttons that press down, snipped-paper
colour swatches, wooden boards for chess and backgammon. Light and dark, and a
"Bigger text" switch. The font is Atkinson Hyperlegible Next, made to be easy
to read. [docs/design.md](docs/design.md) has the reasoning and the decisions.

## Settings

Everything is optional. Set these in the environment before starting (online,
in `/etc/kitchen-table.env` on the server).

| Setting | What it does |
| --- | --- |
| `PORT` | The plain web port. `4000` unless set. |
| `HTTPS_PORT` | The secure port for devices on the home network, `4443` unless set. `off` turns it off. |
| `FAMILY_DATA_DIR` | Where everything is kept. `server/data` unless set. |
| `FAMILY_TIME_ZONE` | The family's time zone, like `Europe/London` (the default) or `America/New_York`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` | Send invitations by email rather than keeping them in the app's outbox. An admin can instead put in a mailbox in the app (Family, Emails sent by the app, Sending email); these win if both are set. |
| `TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD` | A relay for video calls between different networks (the server setup makes one). |
| `PUSH_CONTACT` | A `mailto:` or `https:` address for push services to reach whoever runs the server. |
| `CALENDAR_PRIVATE_HOSTS=1` | Allow linking calendars on the home network. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | The apps registered with Google and Microsoft, so Google and Outlook calendars link both ways. An admin can paste these into the app instead: see [docs/calendar-sign-in.md](docs/calendar-sign-in.md). |
| `MICROSOFT_TENANT` | Keep Microsoft sign-ins to one organisation's accounts. Personal and work accounts both work unless set. |
| `CALENDAR_CONNECT_STAND_IN` | For testing only: send Google and Microsoft sign-ins and calendars to a stand-in at this address. |
| `PUSH_PRIVATE_HOSTS=1` | Allow push addresses on the home network, for testing only. |
| `MOVED_TO` | Send every page to a new address, after moving the family online. |
| `SECRET_KEY_BASE` | The key that signs sign-ins and seals passwords. Made once and kept in the data folder unless set. |

The app's name is `app_name` in `server/config/config.exs`.

## How it's built

```
server/   Elixir and Phoenix with SQLite: accounts, families and guardians,
          chat, games, calls, calendar, tasks, notifications, email
web/      TypeScript and React, built by Vite into server/priv/static
android/  a small Android app that opens Kitchen Table full screen
deploy/   setting up an Ubuntu server, installing releases, nightly backups
scripts/  the start scripts, and make_art.py, which draws the textures and icons
docs/     the getting going guide, and design notes with the decision log
```

- **One small server.** Phoenix serves the web app, a JSON API, and Channels
  for everything live: chat, typing, presence, game moves, doodle strokes and
  call signalling. Everything it keeps is in one folder: a SQLite database,
  photos and doodles, and its secret key. A backup is a copy of that folder.
- **Games without rules on the server.** The server referees turns with
  versioned whole-state moves, without knowing any game's rules, so the rules
  and the computer players live in the web app and a new game is one folder
  in `web/src/games`.
- **Calls go device to device.** Video calls are a WebRTC mesh; the server
  only introduces the devices, keeps who's in each call, rings the chat and
  holds the shared drawings, stored in camera-picture coordinates so a
  moustache stays under the same nose on every screen.
- **Who may talk to whom** is one module, `Family.Contacts`, checked for every
  chat, group, message, game and call.
- **Calendars and notifications** use open standards where there are any:
  CalDAV and iCalendar for linked calendars, Web Push (RFC 8291 and 8292) on
  the standard library's crypto for notifications. Google and Outlook
  calendars go through their own APIs, after signing in with OAuth.

[docs/design.md](docs/design.md) explains the look and keeps a log of the
decisions and why they were made.

## Working on it

- `cd web && npm run dev` serves the web app on <http://localhost:5173> with
  instant reloads, passing the API through to the server on :4000.
- `cd server && mix test` runs the server tests.
- `cd web && npm test` runs the game rules, computer players, drawing and call
  tests, and `npm run typecheck` checks the types.
- `cd web && npm run e2e` runs a whole family through everything in a real
  browser with Playwright: setting up, one-time passwords, chat, photos,
  doodling, every game, friends across families, a video call with pretend
  cameras, linked calendars and notifications. Then, on the family it leaves
  behind, it checks every screen and dialog for accessibility (axe against
  WCAG 2.2 AA, and text contrast worked out from the colours) for an admin and
  a kid, on a phone and a tablet, light and dark, that the keyboard reaches
  everything, and that nothing runs off a small phone with large text. Start
  the server on an empty data folder with `CALENDAR_PRIVATE_HOSTS=1
  PUSH_PRIVATE_HOSTS=1 CALENDAR_CONNECT_STAND_IN=http://127.0.0.1:4190`
  first (the tests play Google and Microsoft on that port); screenshots land
  in `web/e2e/shots`.
- `python3 scripts/make_art.py` redraws the paper textures and icons.
- Machines that can't reach hex.pm can set `FAMILY_GIT_DEPS=1` to fetch the
  same package versions from GitHub (locked in `server/mix.git.lock`).

## Licence

Kitchen Table is free software under the GNU Affero General Public License,
version 3: see [LICENSE](LICENSE). You can use it, change it and share it. If
you run a changed copy for other people, offer them your changes too.
