# Getting going with Kitchen Table

This guide takes you from nothing to a family using Kitchen Table, first on a
computer at home and then, if you want it to work away from home too, on a
small server of your own. Each part builds on the one before, but you can stop
after any of them.

1. [What you need](#1-what-you-need)
2. [Run it on a computer at home](#2-run-it-on-a-computer-at-home)
3. [Set up your family](#3-set-up-your-family)
4. [Open it on tablets and phones](#4-open-it-on-tablets-and-phones)
5. [The Android app for kids' tablets](#5-the-android-app-for-kids-tablets)
6. [Email](#6-email)
7. [Linked calendars](#7-linked-calendars)
8. [Notifications](#8-notifications)
9. [Put it online](#9-put-it-online)
10. [Backups, updates and moving](#10-backups-updates-and-moving)
11. [When something isn't right](#11-when-something-isnt-right)

## 1. What you need

- **A computer that stays on while the family uses it.** Windows, a Mac or
  Linux. Anything from the last ten years will do; one family is a tiny load.
- **Erlang/OTP 26 or newer and Elixir 1.17 or newer**, from
  <https://elixir-lang.org/install.html>. On Windows the installer there sets
  up both.
- **Node 20 or newer**, from <https://nodejs.org>, to build the web app.
- **Git**, to fetch the code: <https://git-scm.com>.

Optional, for later:

- An email account that can send by SMTP, so invitations arrive by email
  rather than being read out (see [Email](#6-email)).
- The Android SDK and JDK 17 (both come with Android Studio), for the small
  Android app (see [part 5](#5-the-android-app-for-kids-tablets)).
- A small Linux server (a VPS with 1 GB of memory is plenty), a web address
  you own and a GitHub account, to put it online (see [part 9](#9-put-it-online)).

## 2. Run it on a computer at home

Fetch the code:

```sh
git clone https://github.com/<owner>/<repository>.git kitchen-table
cd kitchen-table
```

### On Windows

Open PowerShell in the `kitchen-table` folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

### On a Mac or Linux

```sh
scripts/start.sh
```

The first run installs the web app's packages, fetches the server's, builds
everything and creates the database, which takes a few minutes. Later runs
only rebuild the web app and start. Leave the window open: closing it, or
pressing Ctrl+C, stops Kitchen Table.

When it's ready it prints two addresses:

- <http://localhost:4000>, for this computer.
- `https://<this computer's address>:4443`, such as `https://192.168.1.20:4443`,
  for the other devices on the home Wi-Fi.

Everything Kitchen Table keeps (the database, photos and doodles, its secret
key and its home certificate) goes in `server/data`. Nothing is sent anywhere
else.

## 3. Set up your family

Open <http://localhost:4000>. The first visit asks for the first admin's
name, email and password. That's you. The family you make here is the **home
family**: the household that runs Kitchen Table.

### Add people

Go to **Family** and choose **Add someone**. Give their name and email, and
choose what they are:

| Role | What they can do |
| --- | --- |
| **Admin** | Everything: add people, change anyone's settings, read every chat. Admins only come from the home family. |
| **Grown-up** | Everything except adding people. Guardian to the kids in their own family. |
| **Kid** | Chat, share, doodle, play and tick off tasks. Their guardians decide what else. |

Each new person gets a **one-time password**: three words and a number, like
`cabin-clover-berry-42`. It's shown on screen (and emailed, once email is set
up). They sign in with it within 7 days and choose their own password. Kids
can use a grown-up's email with a `+` in it, like `mum+sam@example.com`.

Every ability can be switched on or off for one person from their page, and a
kid's guardians can set **quiet hours**, such as bedtime or school, when they
can read but not send.

### Other households: grandparents, cousins and friends

Each household is its own **family** in Kitchen Table. When adding someone,
choose **A new family…** under Family and give it a name, like "Grandma and
Grandad" or "The cousins". Add a grown-up from a new family first: every kid
needs a guardian in their own family.

Only the home family is in the **Whole family** chat. The home family decides
what each other family can use: on the Family page, the pencil beside a
family's name switches photos, doodles, games, video calls, one-to-one chats,
group chats, daily tasks and the calendar on or off for everyone in it.

### Who kids can chat with

Kitchen Table keeps children's chats to people their families trust:

- **Grown-ups** can chat with any grown-up, so a friend's parents can check
  in with you.
- **A kid** can chat with the people in their own household, and with
  grown-ups from other families that an admin has made **family to them**.
  To do that, open the pencil beside the kid's family (or **Choose family
  from other homes** on a kid's page) and pick the grandparents, aunts and
  uncles.
- **Kids from different families**, cousins included, can chat once a
  **guardian from each family says yes**. A kid asks from **New chat**, under
  "Ask to chat with a friend", or a guardian chooses **Add a friend** on the
  kid's page. The guardians who still need to answer see it at the top of the
  Family page, under "Waiting for your yes", and get a notification.
- A group, a game or a call only goes ahead when everyone in it may chat with
  everyone else. If a yes is taken back (**Stop** on the kid's page), their
  chats close but stay readable.

A kid's **guardians** are the grown-ups in their own household who have
"Guardian to their family's kids" switched on (it is, unless an admin
switches it off). Guardians can read the chats their kids are in, without
being in them, and admins can read every chat.

## 4. Open it on tablets and phones

On each tablet, phone or computer on the home Wi-Fi, open the `https://`
address the start script printed.

- **The first time, the browser warns that the connection isn't private.**
  That's expected: the computer makes its own certificate, which browsers
  don't know. Choose **Advanced**, then **Continue** (or **Proceed**). It's
  `https` because browsers only let a page use the camera and microphone on a
  secure address, and video calls need them.
- **If a device can't reach it**, the computer's firewall is blocking it. On
  Windows, set the Wi-Fi network's profile to **Private** in Settings, then in
  PowerShell as administrator:

  ```powershell
  New-NetFirewallRule -DisplayName "Kitchen Table" -Direction Inbound -Protocol TCP -LocalPort 4000,4443 -Action Allow -Profile Private
  ```

  If Windows asks whether to let Erlang through the firewall, allow it on
  private networks.
- **A shortcut on the home screen** (Add to Home Screen) works, but at home
  the app can't work offline or show notifications: browsers only allow those
  with a proper certificate, which comes with [putting it online](#9-put-it-online).

## 5. The Android app for kids' tablets

Some home screens, like a kids' launcher, won't take a browser shortcut.
`android/` has a small app that opens Kitchen Table full screen, asks for the
camera and microphone itself, and trusts your computer's home-made
certificate the first time it sees it (and only that certificate afterwards).

It's built on Windows, with the Android SDK and JDK 17 that Android Studio
installs. With the tablet plugged in over USB and USB debugging switched on
(Settings, About tablet, tap Build number seven times, then Developer
options, USB debugging):

```powershell
powershell -ExecutionPolicy Bypass -File android\build.ps1 -Install
```

- It finds the SDK through `ANDROID_HOME` (or `-Sdk`), and Java through
  `JAVA_HOME` or Android Studio's own.
- It sets the app to this computer's address; `-Address https://192.168.1.20:4443`
  picks another. If the address changes later, the app shows a screen to
  type the new one.
- `-Serial` picks one device when several are plugged in (`adb devices`
  lists them).
- It signs with a debug keystore, making one the first time. Keep that file:
  a new build only installs over the old one when it's signed with the same
  keystore.
- On a tablet with parental controls, allow the app there before it opens.

The app is `android\build\KitchenTable.apk`, if you'd rather copy it over
yourself.

## 6. Email

Without email, invitations and new one-time passwords wait in the app's
outbox (admins find it at the bottom of the Family page, as "Emails sent by
the app"), and the admin sees each one-time password on screen anyway.

To send real email, set these before starting. Most email providers give
SMTP details in their help pages; many need an app password rather than your
normal one.

| Setting | Example |
| --- | --- |
| `SMTP_HOST` | `smtp.example.com` |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (TLS) |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | the mailbox's sign-in |
| `SMTP_FROM` | `Kitchen Table <family@example.com>` |

On Windows, set them in the same PowerShell window before running the start
script, like `$env:SMTP_HOST = 'smtp.example.com'`. On a Mac or Linux, put
`export SMTP_HOST=smtp.example.com` lines before `scripts/start.sh`, or in a
small script of your own that runs it. Online, they go in the server's
settings file (see [part 9](#9-put-it-online)).

## 7. Linked calendars

The family calendar can show calendars you already use, each in its own
colour. Anyone who can change the calendar links one from **Calendar**,
**Month**, **Link a calendar**:

- **iCloud**, both ways. Apple asks apps like this for an app-specific
  password rather than your Apple ID password: make one at
  [account.apple.com](https://account.apple.com/account/manage), under
  Sign-In and Security, App-Specific Passwords. Put in the Apple ID email and
  that password, then choose which calendars to link.
- **Google** and **Outlook**, both ways: sign in to Google or Microsoft and
  choose which calendars. This needs Kitchen Table registered with Google and
  with Microsoft as your own app, once, by an admin:
  [calendar-sign-in.md](calendar-sign-in.md) has the steps.
- **Another calendar server**, both ways: any CalDAV server (Fastmail,
  Nextcloud, Zoho, Yahoo and most others) with its address, a username and a
  password.
- **A calendar's address**, read only: an `.ics` or `webcal://` address.
  Google Calendar gives one in a calendar's settings ("Secret address in iCal
  format"), Outlook under Shared calendars when a calendar is published, and
  many schools and clubs publish one.

Whoever links a calendar chooses whether the family sees it or only they do.
Passwords are sealed with a key made from the server's secret and never sent
back to a browser, and so are Google and Microsoft sign-ins. CalDAV and
Google calendars are checked every five minutes, Outlook ones every ten,
addresses every hour, and the refresh button beside each one checks at once. Events are
copied for three months behind and a year ahead. Something that repeats in a
linked calendar is changed in that calendar; one-off events can be changed
here or there.

The server only fetches calendars from the internet. To link one on your home
network (a Nextcloud at home, say), set `CALENDAR_PRIVATE_HOSTS=1`. Times that
don't say their zone are taken as the family's: `Europe/London` unless
`FAMILY_TIME_ZONE` says otherwise (any name like `America/New_York`).

## 8. Notifications

Each phone, tablet or computer switches notifications on from **Me**. A new
message, a ringing call (then "Missed call") and your turn in a game pop up
while the app is closed. Nothing pops up while you're using the app on
another of your devices, messages in one chat join into one notification, and
kids' quiet hours keep their devices quiet. The bell at the top of a chat
mutes just that chat.

Notifications need the app online with a proper certificate (see the next
part). On an iPhone or iPad, add Kitchen Table to the Home Screen first and
open it from there (iOS 16.4 or later).

They go through each browser's own push service (Google's, Mozilla's,
Apple's), the standard Web Push way, so there's nothing to sign up for. Each
is encrypted for the one device it's going to. `PUSH_CONTACT` sets a
`mailto:` or `https:` address the push services can reach you at; it's the
site's own address if not set.

## 9. Put it online

Online, Kitchen Table gets a proper address and certificate: no warnings,
notifications, an app on the home screen, and it works away from home. It
runs on a small Ubuntu server (22.04 or 24.04, 1 GB of memory is enough)
behind Caddy, which gets and renews the certificate, with coturn relaying
video calls between houses, a firewall, and a backup every night. Everything
is in `deploy/`, driven from a Windows computer with `ssh` and the GitHub
command line (`gh`, signed in with `gh auth login`).

The server doesn't build anything itself, so a 1 GB machine is fine: GitHub
builds each release.

1. **Your own copy on GitHub.** Fork this repository (or push your clone to
   a repository of your own). The Release workflow in `.github/workflows`
   builds a release whenever a tag starting with `v` is pushed.
2. **The server.** Rent a VPS with Ubuntu 22.04, and add your computer's SSH
   key when ordering it (`C:\Users\<you>\.ssh\id_ed25519.pub`; make one with
   `ssh-keygen` if there isn't one).
3. **The address.** At the company you bought your domain from, add an A
   record for the address you want (like `family.example.com`) pointing at
   the server's IP address.
4. **A release.** Tag and push:

   ```sh
   git tag v1.0.0
   git push origin v1.0.0
   ```

   Wait for the Release workflow to finish (the Actions tab on GitHub).
5. **Install it.** From the `kitchen-table` folder on your computer:

   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server root@<server IP> -Domain family.example.com -FirstTime
   ```

   It installs everything, puts the newest release on, starts Kitchen Table
   and prints a **setup code**. Open your address: the first admin's form asks
   for that code, so nobody else can claim the new site.

The server's settings (email, the time zone, the call relay's password) are
in `/etc/kitchen-table.env`. After changing them, run
`systemctl restart kitchen-table` on the server.

**Moving from the home computer.** To bring your family across, stop both
copies (`systemctl stop kitchen-table` on the server), copy everything in the
home `server/data` folder into `/var/lib/kitchen-table` on the server, rename
`family_dev.db` there to `family_prod.db` (and the `-wal` and `-shm` files
beside it, if any), run `chown -R kitchen: /var/lib/kitchen-table`, and
start it again. To send everyone to
the new address, start the home copy with `MOVED_TO` set to it (on Windows,
`$env:MOVED_TO = 'https://family.example.com'` before the start script):
every page then redirects, and the Android app follows and remembers it.

## 10. Backups, updates and moving

**At home**, back up by copying `server/data` while Kitchen Table is stopped.
It holds the server's secret key, so keep copies private.

**Online**, the server backs itself up every night to
`/var/backups/kitchen-table`, keeping two weeks. A backup only on the server
goes if the server does, so copy them to your computer:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server root@<server IP> -FetchBackups
```

That copies only the nights you haven't got, into `Documents\Kitchen Table
backups` (or `-BackupDir`), keeping the newest 14 (`-Keep`). Add
`-ScheduleBackups` instead to have Windows do it every evening, or when the
computer is next switched on. A folder that syncs to cloud storage keeps a
second copy somewhere else.

To restore a backup on the server: `systemctl stop kitchen-table`, unpack it
into `/var/lib/kitchen-table`, then `systemctl start kitchen-table`.

**Updating at home:** `git pull`, then run the start script again.

**Updating online:** pull the changes into your copy, push a new tag, wait
for the release, then run `deploy.ps1 -Server root@<server IP>` (no `-Domain`
or `-FirstTime`). Database changes run by themselves when it starts. The last
three releases stay on the server; to go back, point
`/opt/kitchen-table/current` at an older one in `/opt/kitchen-table/releases`
and restart.

## 11. When something isn't right

| What happens | What to do |
| --- | --- |
| A start script says it can't find `erl`, `mix` or `node` | Install them (see [part 1](#1-what-you-need)) and open a new terminal window, so it sees them. |
| Port 4000 or 4443 is already in use | Set `PORT` (and `HTTPS_PORT`) to free ones before starting. `HTTPS_PORT=off` turns the secure address off. |
| Tablets can't open the address | The firewall: see [part 4](#4-open-it-on-tablets-and-phones). Check the tablet is on the same Wi-Fi, not a guest network. |
| The camera doesn't start in a call | Use the `https://` address, not `http://`, and allow the camera when asked. |
| Nobody gets invitations | Without email they're in the outbox at the bottom of the Family page. With email, check the `SMTP_` settings. |
| A kid can't message someone | It's the rule in [Who kids can chat with](#who-kids-can-chat-with): make the grown-up family to them, or ask for a yes from each family. The chat's notice says which. |
| A linked calendar won't connect | For iCloud, use an app-specific password. For a server at home, set `CALENDAR_PRIVATE_HOSTS=1`. |
| Notifications never arrive | They need the online version, switched on from Me on each device, and on iPhone the app on the Home Screen. |
| The Android app won't install over the old one | It was built with a different keystore. Uninstall the old app first, then keep using the same keystore. |
| Someone forgot their password | An admin gives them a new one-time password from their page on Family. |

The server keeps a log in its data folder, under `log/server.log`
(`server/data/log` at home, `/var/lib/kitchen-table/log` online), and online
`journalctl -u kitchen-table` shows it too.
