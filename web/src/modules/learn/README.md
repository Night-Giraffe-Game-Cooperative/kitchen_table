# Learn

An optional module of Kitchen Table: an admin switches it on for everyone
under **Extras** on the Family page, and a new family starts without it.

Phrases and characters for a family holiday, in Japanese or French.
Phrases come in topics (hello and goodbye, manners, food, getting around,
shops, help, numbers), each with the words, how to say them in English
sounds, and a speaker to hear them, slowly too. Signs to spot (exit, toilets,
open, closed) are their own tab, and Japanese adds hiragana and katakana: a
chart to tap and hear, and a quiz. Everyone presses "I know it" on what
they've learned, and the family can see who knows what, so learning it is a
shared thing. There's a phrase of the day, flashcards that start with what
you don't know yet, and an age choice: 5 to 7 keeps to the simplest
phrases, and older ages add more. Every phrase, sign and kana sound has a
recording, normal and slow, made with [Kokoro](https://github.com/hexgrad/kokoro),
an open voice model (Apache 2.0), so it sounds natural and needs no voice
installed on the device. Anything without a recording yet is read by the
device's own voice, as on the Android app (see
[part 5 of Get going](../../../../docs/getting-started.md#5-the-android-app-for-kids-tablets)).

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

## Where it lives

- `web/src/modules/learn`: the screens (`Learn.tsx`, `LearnTravel.tsx`), the
  phrases and kana (`phrases.ts`), the Japan travel games and facts
  (`japanTravel.tsx`, `japanFun.ts`), the recordings (`voices`) and the
  styles (`learn.css`). The app loads all of it only when Learn is opened.
- `server/lib/family/learn.ex` (`Family.Learn`) and
  `server/lib/family_web/controllers/learn_controller.ex`: who knows which
  phrase, and when each household goes, under `/api/phrases`. They answer
  only while Learn is switched on.
- `tools/voices`: makes the recordings again when a phrase changes
  (`python tools/voices/make.py`, with the setup at the top of `make.py`).

Switching Learn off keeps what everyone has learned, for when it's back.
