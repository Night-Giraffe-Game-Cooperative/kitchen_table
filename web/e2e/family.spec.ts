import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startFakeCaldav } from './fixtures/fakeCaldav';
import { googleClient, microsoftClient, startFakeConnect } from './fixtures/fakeConnect';
import { startFakePush } from './fixtures/fakePush';
import { spills, type Spill } from './fixtures/spills';
import { roadRules, roadSigns, trainQuestions } from '../src/learn/japanTravel';

// One family, start to finish: the first admin sets up, adds a kid and a
// grown-up, they sign in with one-time passwords, chat, share and doodle on a
// photo, and play the games. Screenshots go to e2e/shots for a look over.

test.describe.configure({ mode: 'serial' });

const shots = path.join(import.meta.dirname, 'shots');
const photo = path.join(import.meta.dirname, 'fixtures', 'garden.jpg');
const phone = { width: 390, height: 844 };
const tablet = { width: 1180, height: 820 };

let admin: Page;
let kid: Page;
let kidOtp = '';
let mumOtp = '';

async function open(browser: Browser, size = tablet) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  return context.newPage();
}

// Text that runs out of its box, on any screen a shot is taken of.
const spilt: (Spill & { shot: string })[] = [];

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  for (const s of await spills(page)) spilt.push({ shot: name, ...s });
}

async function draw(page: Page, canvas: string, points: [number, number][]) {
  const box = (await page.locator(canvas).first().boundingBox())!;
  await page.mouse.move(box.x + points[0][0] * box.width, box.y + points[0][1] * box.height);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 6 });
  await page.mouse.up();
}

test('the first admin sets up the family', async ({ browser }) => {
  admin = await open(browser);
  await admin.goto('/');
  await expect(admin.getByRole('heading', { name: "Set up your family's table" })).toBeVisible();
  await shot(admin, '01-setup');
  await admin.getByLabel('Your name').fill('Alex');
  await admin.getByLabel('Email').fill('alex@example.com');
  await admin.getByLabel('Password').fill('kitchen table one');
  await admin.getByRole('button', { name: 'Set up the family' }).click();
  await expect(admin.getByRole('heading', { name: 'Chats' })).toBeVisible();
  await shot(admin, '02-chats-empty');
});

test('only an admin adds people, and they get a one-time password', async () => {
  await admin.getByRole('link', { name: /^Family\b/ }).click();
  await admin.getByRole('button', { name: 'Add someone' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Mia');
  await dialog.getByLabel('Email').fill('alex+mia@example.com');
  await dialog.getByRole('radio', { name: 'Kid' }).click();
  await dialog.getByRole('button', { name: '🦄' }).click();
  await dialog.getByRole('button', { name: 'Rose' }).click();
  await shot(admin, '03-add-person');
  await dialog.getByRole('button', { name: 'Add and send the invitation' }).click();
  kidOtp = (await dialog.locator('.otp-code').textContent())!.trim();
  expect(kidOtp).toMatch(/^[a-z]+-[a-z]+-[a-z]+-\d\d$/);
  await shot(admin, '04-otp');
  await dialog.getByRole('button', { name: 'Done' }).first().click();

  await admin.getByRole('button', { name: 'Add someone' }).click();
  await dialog.getByLabel('Name').fill('Mum');
  await dialog.getByLabel('Email').fill('mum@example.com');
  await dialog.getByRole('radio', { name: 'Grown-up' }).click();
  await dialog.getByRole('button', { name: 'Add and send the invitation' }).click();
  mumOtp = (await dialog.locator('.otp-code').textContent())!.trim();
  await dialog.getByRole('button', { name: 'Done' }).first().click();

  await admin.getByRole('link', { name: /Mia/ }).click();
  await expect(admin.getByRole('heading', { name: 'What Mia can do' })).toBeVisible();
  await admin.getByRole('switch', { name: 'Quiet hours' }).click();
  await shot(admin, '05-kid-permissions');
  // Quiet hours off again so Mia can chat in the test.
  await admin.getByRole('switch', { name: 'Quiet hours' }).click();

  await admin.getByRole('link', { name: 'Emails sent by the app' }).click();
  await expect(admin.getByText(kidOtp)).toBeVisible();

  // Email isn't set up, so the page says how to send it from Gmail.
  const sending = admin.locator('section', { has: admin.getByRole('heading', { name: 'Sending email' }) });
  await expect(sending).toContainText('myaccount.google.com/apppasswords');
  await sending.getByLabel('Gmail address').fill('us@example.org');
  await sending.getByLabel('App password').fill('not gmail');
  await sending.getByRole('button', { name: 'Save and send a test' }).click();
  await expect(sending).toContainText('Put in the email server');
  await sending.getByRole('switch', { name: 'Another email provider' }).click();
  await expect(sending.getByLabel('Email server')).toBeVisible();
  await shot(admin, '05a-email-setup');
});

test('a kid signs in with the one-time password and chooses their own', async ({ browser }) => {
  kid = await open(browser, phone);
  await kid.goto('/');
  await kid.getByLabel('Email').fill('alex+mia@example.com');
  await kid.getByLabel('Password').fill(kidOtp);
  await kid.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(kid.getByRole('heading', { name: /choose your own password/i })).toBeVisible();
  await shot(kid, '06-phone-change-password');
  await kid.getByLabel('New password', { exact: true }).fill('unicorns are best');
  await kid.getByLabel('New password again').fill('unicorns are best');
  await kid.getByRole('button', { name: 'Save my password' }).click();
  await expect(kid.getByRole('heading', { name: 'Chats' })).toBeVisible();
});

test('chat, photos, reactions, replies and doodling on a photo', async () => {
  await admin.getByRole('link', { name: /^Chats\b/ }).click();
  await admin.getByRole('link', { name: /Whole family/ }).click();
  await admin.getByLabel('Message', { exact: true }).fill('Hello everyone! Welcome to our kitchen table 🫖');
  await admin.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(admin.locator('.msg-text', { hasText: 'Welcome to our kitchen table' })).toBeVisible();

  await admin.locator('input[type=file]').first().setInputFiles(photo);
  await admin.getByLabel('Message', { exact: true }).fill('The garden this morning');
  await admin.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(admin.locator('.bubble-photo img').first()).toBeVisible();

  await kid.getByRole('link', { name: /Whole family/ }).click();
  await expect(kid.locator('.msg-text', { hasText: 'Welcome to our kitchen table' })).toBeVisible();
  await kid.locator('.bubble', { hasText: 'Welcome to our kitchen table' }).click();
  await kid.getByRole('button', { name: 'React ❤️' }).click();
  await kid.getByRole('button', { name: 'Reply', exact: true }).click();
  await kid.getByLabel('Message', { exact: true }).fill('Hello Daddy!!');
  await kid.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(admin.locator('.msg-text', { hasText: 'Hello Daddy!!' })).toBeVisible();
  await expect(admin.locator('.reaction').first()).toBeVisible();

  // Mia doodles on the photo.
  await kid.locator('.bubble', { hasText: 'The garden this morning' }).locator('.msg-time').click();
  await kid.getByRole('button', { name: 'Doodle on it' }).click();
  await expect(kid.getByRole('heading', { name: 'Doodle on the photo' })).toBeVisible();
  await draw(kid, '.board-canvas', [[0.2, 0.3], [0.3, 0.2], [0.4, 0.3], [0.5, 0.2], [0.6, 0.3]]);
  await kid.getByRole('radio', { name: 'Poppy' }).click();
  await draw(kid, '.board-canvas', [[0.45, 0.55], [0.55, 0.5], [0.6, 0.6], [0.5, 0.7], [0.45, 0.55]]);
  // Papercraft: a torn strip of tissue paper and a cut-out heart.
  await kid.getByRole('radio', { name: 'Torn paper' }).click();
  await kid.getByRole('radio', { name: 'Tissue paper' }).click();
  await draw(kid, '.board-canvas', [[0.1, 0.85], [0.5, 0.8], [0.9, 0.86]]);
  await kid.getByRole('radio', { name: 'Cut-out shapes' }).click();
  await kid.getByRole('radio', { name: 'Heart' }).click();
  await draw(kid, '.board-canvas', [[0.3, 0.72]]);
  await kid.getByRole('radio', { name: 'Stickers' }).click();
  await kid.getByRole('radio', { name: '🦄' }).click();
  await draw(kid, '.board-canvas', [[0.75, 0.7]]);
  await shot(kid, '07-phone-doodle-on-photo');
  await kid.getByLabel('Caption').fill('I drew a rainbow sun');
  await kid.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(admin.locator('.msg-tag', { hasText: 'Doodled on your photo' })).toBeVisible();
  await shot(kid, '08-phone-chat');
  await shot(admin, '09-tablet-chat');
});

test('Word Garden, together', async () => {
  await admin.getByRole('button', { name: 'New game' }).click();
  await shot(admin, '10-game-picker');
  await admin.getByRole('button', { name: /Word Garden/ }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(admin.locator('.wg-word')).toBeVisible();
  for (const letter of ['E', 'A', 'O']) await admin.getByRole('button', { name: new RegExp(`^${letter}(,|$)`) }).click();
  await shot(admin, '11-word-garden');
});

test('Chess: the family against the computer', async () => {
  await admin.getByRole('link', { name: /^Chats\b/ }).click();
  await admin.getByRole('link', { name: /Whole family/ }).click();
  await admin.getByRole('button', { name: 'New game' }).click();
  await admin.getByRole('button', { name: /Chess/ }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Start', exact: true }).click();
  // Tips explain the aim, then how the piece picked up moves.
  await expect(admin.locator('.tip-note')).toContainText('The aim is checkmate');
  await admin.getByRole('gridcell', { name: /^e2/ }).click();
  await expect(admin.locator('.tip-note')).toContainText('Pawns step one square forward');
  await admin.getByRole('gridcell', { name: /^e4/ }).click();
  await expect(admin.locator('.game-status')).toHaveText(/family's move/, { timeout: 15_000 });
  await admin.getByRole('button', { name: 'Hint' }).click();
  await expect(admin.locator('.tip-note p')).toHaveText(/^Try (your \w+ from|castling)/);
  await shot(admin, '12-chess');
  await admin.getByRole('button', { name: 'How to play' }).click();
  await expect(admin.getByRole('dialog')).toContainText('How the pieces move');
  await admin.getByRole('button', { name: 'Back to the game' }).click();

  // The chat shows its games above the messages, not as messages in it.
  await admin.getByRole('link', { name: /^Chats\b/ }).click();
  await admin.getByRole('link', { name: /Whole family/ }).click();
  await expect(admin.getByRole('navigation', { name: 'Games in this chat' })).toContainText('Chess');
  await expect(admin.locator('.messages')).not.toContainText('started');
  await shot(admin, '12a-games-above-the-chat');
});

test('Picture Puzzle and Story Chain', async () => {
  await admin.getByRole('link', { name: /^Games\b/ }).click();
  await admin.getByRole('button', { name: 'New game' }).click();
  await admin.getByRole('button', { name: /Picture Puzzle/ }).click();
  await expect(admin.locator('.photo-option img').first()).toBeVisible();
  await admin.getByRole('dialog').getByRole('button', { name: 'Start', exact: true }).click();
  const tiles = admin.locator('.pp-tile:not([disabled])');
  await tiles.nth(0).click();
  await tiles.nth(1).click();
  await shot(admin, '13-picture-puzzle');

  await admin.getByRole('link', { name: /^Games\b/ }).click();
  await admin.getByRole('button', { name: 'New game' }).click();
  await admin.getByRole('button', { name: /Story Chain/ }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Start', exact: true }).click();
  await admin.getByLabel('What happens next?').fill('It was very small and smelled of cinnamon.');
  await admin.getByRole('button', { name: 'Add to the story' }).click();
  await kid.goto('/#/games');
  await kid.getByRole('link', { name: /Story Chain/ }).click();
  await kid.getByLabel('What happens next?').fill('Inside lived a hedgehog who loved pancakes.');
  await kid.getByRole('button', { name: 'Add to the story' }).click();
  await expect(admin.locator('.story-line', { hasText: 'hedgehog' })).toBeVisible();
  await shot(admin, '14-story-chain');
  await shot(kid, '15-phone-story');
});

test('Doodle Together, live on two screens', async () => {
  await admin.getByRole('link', { name: /^Games\b/ }).click();
  await admin.getByRole('button', { name: 'New game' }).click();
  await admin.getByRole('button', { name: /Doodle Together/ }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Start', exact: true }).click();
  await draw(admin, '.board-canvas', [[0.2, 0.7], [0.5, 0.3], [0.8, 0.7], [0.2, 0.7]]);
  await kid.goto('/#/games');
  await kid.getByRole('link', { name: /Doodle Together/ }).click();
  await kid.getByRole('radio', { name: 'Bubblegum' }).click();
  await draw(kid, '.board-canvas', [[0.4, 0.6], [0.5, 0.75], [0.6, 0.6]]);
  await expect(admin.locator('.artist')).toHaveCount(2);
  await shot(admin, '16-doodle-together');
  await admin.getByRole('button', { name: "It's finished! Share it" }).click();
  await expect(admin.locator('.finished-picture img')).toBeVisible();
});

test('Doodle Telephone: one person takes each step, and the others wait', async () => {
  await admin.getByRole('link', { name: /^Games\b/ }).click();
  await admin.getByRole('button', { name: 'New game' }).click();
  await admin.getByRole('button', { name: /Doodle Telephone/ }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('The first words').fill('a cat on a bus');
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(admin.locator('.doodle-game')).toContainText('You did the last step');

  // Mia takes the drawing. Until then the words stay hidden.
  await kid.goto('/#/games');
  await kid.getByRole('link', { name: /Doodle Telephone/ }).click();
  await expect(kid.locator('.telephone-next')).toContainText('Next, someone draws the words.');
  await expect(kid.locator('.doodle-game')).not.toContainText('a cat on a bus');
  await kid.getByRole('button', { name: "I'll draw it" }).click();
  await expect(kid.locator('.prompt-banner')).toContainText('a cat on a bus');
  await expect(admin.locator('.doodle-game')).toContainText('Mia is drawing your words');
  await draw(kid, '.board-canvas', [[0.3, 0.5], [0.5, 0.3], [0.7, 0.5]]);
  await kid.getByRole('button', { name: 'Pass it on' }).click();
  await expect(kid.locator('.doodle-game')).toContainText('You did the last step');

  // Alex guesses it, and it's Mia's turn to take the next drawing.
  await admin.getByRole('button', { name: "I'll guess it" }).click();
  await admin.getByLabel('Your guess').fill('a cat on a bus');
  await admin.getByRole('button', { name: 'Pass it on' }).click();
  await expect(kid.getByRole('button', { name: "I'll draw it" })).toBeVisible();
  await shot(kid, '16b-phone-doodle-telephone');
});

test('Backgammon: just me against the computer', async () => {
  await admin.getByRole('link', { name: /^Games\b/ }).click();
  await admin.getByRole('button', { name: 'New game' }).click();
  await admin.getByRole('button', { name: /Backgammon/ }).click();
  // Who's playing comes first: the family together, just me, or someone else.
  const who = admin.getByRole('radiogroup', { name: "Who's playing?" });
  await expect(who.getByRole('radio')).toHaveText([/The family against the computer/, /Just me against the computer/, /Against someone/]);
  await who.getByRole('radio', { name: /Just me/ }).click();
  await shot(admin, '16a-whos-playing');
  await admin.getByRole('dialog').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(admin.locator('.game-head')).toContainText('Against the computer');
  await expect(admin.locator('.game-status')).toHaveText('Your turn. Roll the dice!');
  await admin.getByRole('button', { name: 'Roll the dice' }).click();
  await expect(admin.locator('.bg-die').first()).toBeVisible();
  // Move checkers until the turn is done.
  for (let i = 0; i < 4; i++) {
    const done = admin.getByRole('button', { name: 'Done', exact: true });
    if (await done.isEnabled()) break;
    await admin.locator('.bg-point[data-source]').first().click();
    await admin.locator('.bg-point[data-dest]').first().click();
  }
  await shot(admin, '17-backgammon');
  await admin.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(admin.locator('.bg-last')).toContainText('computer', { ignoreCase: true, timeout: 15_000 });
  // Just me means just Alex: it isn't on Mia's list.
  await kid.goto('/#/games');
  await expect(kid.locator('.game-item').first()).toBeVisible();
  await expect(kid.locator('.game-item', { hasText: 'Backgammon' })).toHaveCount(0);
});

test('Bonsai: a little tree of your own, looked after a bit each day', async () => {
  await admin.getByRole('link', { name: /^Games\b/ }).click();
  await admin.getByRole('button', { name: 'New game' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Bonsai/ }).click();
  // It's only ever yours, so there's no choosing who plays.
  await expect(dialog.getByRole('radiogroup', { name: "Who's playing?" })).toHaveCount(0);
  await dialog.getByRole('radio', { name: /Pine/ }).click();
  await expect(dialog.getByLabel('Its name')).toHaveValue('Matsu');
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(admin.locator('.game-head')).toContainText('Matsu the pine');

  // It arrives a little dry and shaggy: water glows first, then trim.
  const mood = admin.locator('.bonsai-mood');
  await expect(admin.locator('.bonsai-tool[data-glow]')).toContainText('Water');
  await admin.getByRole('button', { name: /^Water/ }).click();
  await expect(mood).toContainText('A good drink');
  await admin.getByRole('button', { name: /^Water/ }).click();
  await expect(mood).toContainText('still wet');
  await expect(admin.locator('.bonsai-tool[data-glow]')).toContainText('Trim');
  await admin.getByRole('button', { name: /^Trim/ }).click();
  await shot(admin, '17a-bonsai-trimming');
  const snips = admin.getByRole('button', { name: 'Trim this shoot' });
  for (let n = await snips.count(); n > 0; n--) {
    await snips.first().click();
    await expect(snips).toHaveCount(n - 1);
  }
  await expect(mood).toContainText('All neat and tidy');
  await admin.getByRole('button', { name: /^Feed/ }).click();
  await expect(mood).toContainText('Yum');
  await expect(admin.locator('.bonsai-facts')).toContainText('Fed today');

  // Pots and little things to put by it unlock over the days.
  await admin.getByRole('button', { name: /^Decorate/ }).click();
  await expect(admin.getByRole('button', { name: /Moss/ })).toBeDisabled();
  await expect(admin.getByRole('button', { name: /Moss/ })).toContainText('After 2 days');
  await expect(admin.getByText('Looked after on 1 day.')).toBeVisible();
  await shot(admin, '17b-bonsai');

  // It's Alex's: not on Mia's list, and not in the family chat.
  await kid.goto('/#/games');
  await expect(kid.locator('.game-item, .empty').first()).toBeVisible();
  await expect(kid.locator('.game-item', { hasText: 'Matsu' })).toHaveCount(0);
  await admin.goto('/#/games');
  await expect(admin.locator('.game-item', { hasText: 'Matsu the pine' })).toBeVisible();
});

test('Sushi Train: making orders together and sending them down the belt', async () => {
  await admin.getByRole('link', { name: /^Games\b/ }).click();
  await admin.getByRole('button', { name: 'New game' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Sushi Train/ }).click();
  await dialog.getByRole('radio', { name: '8–10' }).click();
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(admin.locator('.sushi-score')).toContainText('Wave 1 of 5');

  // Tap a customer, then follow what glows until the plate goes down the belt.
  async function serveNext(page: Page, snap?: string) {
    await page.locator('.sushi-diner:not([disabled])').first().click();
    await expect(page.locator('.sushi-recipe')).toBeVisible();
    for (let step = 0; step < 12; step++) {
      const glow = page.locator('.sushi-ingredient[data-glow], .btn.sushi-glow');
      await expect(glow).toHaveCount(1);
      const sending = /Send down the belt/.test((await glow.textContent()) ?? '');
      await glow.click();
      if (sending) break;
      if (snap && step === 1) await shot(page, snap);
    }
    await expect(page.locator('.sushi-on-plate')).toHaveCount(0);
    await expect(page.locator('.sushi-note')).toContainText('arigatō');
  }

  await serveNext(admin, '17c-sushi-train');
  await expect(admin.locator('.sushi-score')).toContainText('1 served');

  // Mia joins from her phone and serves the next customer at her own station.
  await kid.goto('/#/games');
  await kid.getByRole('link', { name: /Sushi Train/ }).click();
  await expect(kid.locator('.sushi-diner[data-served]')).toHaveCount(1);
  await serveNext(kid, '17d-phone-sushi-train');
  await expect(admin.locator('.sushi-score')).toContainText('2 served');

  // When everyone has eaten, the next customers come in.
  while (/Wave 1 of/.test((await admin.locator('.sushi-score').textContent()) ?? '')) await serveNext(admin);
  await expect(admin.locator('.sushi-score')).toContainText('Wave 2 of 5');
  await expect(kid.locator('.sushi-score')).toContainText('Wave 2 of 5');

  await admin.getByRole('button', { name: 'Close the sushi bar' }).click();
  await admin.getByRole('button', { name: 'Close it' }).click();
  await expect(admin.locator('.sushi-end')).toContainText('The sushi bar is closed');
  await expect(kid.locator('.sushi-end')).toContainText('Chefs: ');
});

test('age groups and learn mode', async () => {
  await admin.getByRole('link', { name: /^Games\b/ }).click();
  await admin.getByRole('button', { name: 'New game' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByRole('button', { name: /Chess/ }).click();
  await dialog.getByRole('radio', { name: '14+' }).click();
  await expect(dialog).toContainText('A strong computer that thinks further ahead, and no tips or hints.');
  await dialog.getByRole('radio', { name: '5–7' }).click();
  await expect(dialog).toContainText('A gentle computer that young children can beat');
  await dialog.getByRole('switch', { name: 'Learn mode' }).click();
  await shot(admin, '17a-ages-and-learn-mode');
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();

  // The basics a step at a time, then a reminder that learn mode is on.
  const basics = admin.locator('.basics');
  await expect(basics).toContainText('The basics · 1 of 6');
  await basics.getByRole('button', { name: 'Next' }).click();
  await expect(basics).toContainText('2 of 6');
  await shot(admin, '17b-learn-the-basics');
  await basics.getByRole('button', { name: 'Skip' }).click();
  await expect(admin.locator('.learn-bar')).toContainText('Learn mode is on');
  await expect(admin.locator('.tip-note')).toContainText('The aim is checkmate');
  await admin.locator('.learn-bar').getByRole('button', { name: 'Switch off' }).click();
  await expect(admin.locator('.learn-bar')).toHaveCount(0);

  // Story Chain for the youngest: simple starts and words to begin a line with.
  await admin.getByRole('link', { name: /^Games\b/ }).click();
  await admin.getByRole('button', { name: 'New game' }).click();
  await dialog.getByRole('button', { name: /Story Chain/ }).click();
  await expect(dialog.getByRole('radio', { name: '5–7' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await admin.getByRole('group', { name: 'Start your line with' }).getByRole('button', { name: 'Suddenly' }).click();
  await expect(admin.getByLabel('What happens next?')).toHaveValue('Suddenly ');
  await admin.getByRole('button', { name: 'Idea' }).click();
  await expect(admin.locator('.tip-note p')).toHaveText(/Give them a name|see, hear or smell|day or night|really want/);
  await shot(admin, '17c-story-chain-for-5-to-7');
  await admin.evaluate(() => localStorage.removeItem('games:band'));
});

test('the newer games: Pairs, Four in a Row, Where\'s the Giraffe?, Dots and Boxes, Family Quiz, Snakes and Ladders', async () => {
  const dialog = admin.getByRole('dialog');
  async function newGame(name: RegExp) {
    await admin.getByRole('link', { name: /^Games\b/ }).click();
    await admin.getByRole('button', { name: 'New game' }).click();
    // The games are on shelves.
    await expect(dialog.getByRole('heading', { name: 'Board games' })).toBeVisible();
    await dialog.getByRole('button', { name }).click();
  }
  const status = admin.locator('.game-status');

  // Pairs, with cards from the family's photos.
  await newGame(/^Pairs/);
  await dialog.getByRole('radio', { name: /Family photos/ }).click();
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  const cards = admin.getByRole('group', { name: 'Cards' }).getByRole('button');
  await expect(cards).toHaveCount(16);
  await cards.nth(0).click();
  await cards.nth(1).click();
  await expect(status).toContainText('1 turn');
  await shot(admin, '41-pairs');

  // Four in a Row against the computer: it answers in the same move.
  await newGame(/^Four in a Row/);
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await admin.getByRole('button', { name: /^Column 4/ }).click();
  await expect(admin.locator('.fiar-board .fiar-disc:not(.fiar-ghost)')).toHaveCount(2, { timeout: 15_000 });
  await expect(status).toHaveText("The family's turn");
  await shot(admin, '42-four-in-a-row');

  // Where's the Giraffe? Alex hides him, Mia finds him on her phone.
  await newGame(/^Where's the Giraffe/);
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  const photo = admin.locator('.gf-photo');
  const box = (await photo.boundingBox())!;
  await photo.click({ position: { x: box.width * 0.3, y: box.height * 0.4 } });
  await admin.getByRole('button', { name: 'Hide him here' }).click();
  await expect(status).toContainText('Seeking');
  await kid.goto('/#/games');
  await kid.getByRole('link', { name: /Where's the Giraffe/ }).first().click();
  const seek = kid.locator('.gf-photo');
  await expect(seek).toHaveAttribute('role', 'application');
  const kbox = (await seek.boundingBox())!;
  await seek.click({ position: { x: kbox.width * 0.9, y: kbox.height * 0.9 } });
  await expect(kid.locator('.gf-dot')).toHaveCount(1);
  await seek.click({ position: { x: kbox.width * 0.3, y: kbox.height * 0.4 } });
  await expect(kid.locator('.game-status')).toContainText('Found by you!');
  await expect(status).toContainText('Found by Mia');
  await shot(kid, '43-phone-giraffe-found');
  // Mia hides him next, and Alex, still looking, moves on to that round with her.
  const firstRound = admin.url();
  await kid.getByRole('button', { name: 'Hide him next' }).click();
  await expect(kid.locator('.game-status')).toHaveText('Hiding him · your turn');
  await expect(status).toHaveText('Mia is hiding the Night Giraffe');
  await expect(admin.getByText('On to the next round, all together.')).toBeVisible();
  // The last round, opened again, points at this one.
  await admin.goto(firstRound);
  await admin.getByRole('button', { name: 'Join the next round' }).click();
  await expect(status).toHaveText('Mia is hiding the Night Giraffe');

  // Dots and Boxes against the computer.
  await newGame(/^Dots and Boxes/);
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await admin.locator('button[aria-label^="Line"]').first().click();
  await expect(status).toContainText("The family's turn", { timeout: 15_000 });
  await shot(admin, '44-dots-and-boxes');

  // Family Quiz: a question each, tapped together from ideas, then answered.
  await newGame(/^Family Quiz/);
  await dialog.getByRole('radio', { name: '1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  async function write(page: Page) {
    await page.getByRole('group', { name: 'Question ideas' }).getByRole('button').first().click();
    await page.getByRole('group', { name: 'Tap the right answer' }).getByRole('button').nth(1).click();
    await page.getByRole('button', { name: 'Save my question' }).click();
  }
  await write(admin);
  await kid.goto('/#/games');
  await kid.getByRole('link', { name: /Family Quiz/ }).first().click();
  await write(kid);
  await admin.getByRole('button', { name: 'Start the quiz' }).click();
  // Anyone who hasn't written one yet is named before it starts.
  await expect(dialog).toContainText('Start the quiz now?');
  await dialog.getByRole('button', { name: 'Start the quiz' }).click();
  await expect(kid.locator('.game-status')).toContainText('Your turn to answer');
  await kid.locator('.fq-answer').first().click();
  await expect(kid.getByText(/^(You got it!|Not quite\.)/)).toBeVisible();
  await shot(kid, '45-phone-family-quiz');
  await admin.locator('.fq-answer').first().click();
  await expect(status).toContainText('The family got');
  await shot(admin, '46-family-quiz-results');

  // Snakes and Ladders against the Night Giraffe: the family rolls, then he does.
  await newGame(/^Snakes and Ladders/);
  await dialog.getByRole('radio', { name: '8–10' }).click();
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(admin.getByText('Against the Night Giraffe')).toBeVisible();
  await admin.getByRole('button', { name: /^Roll/ }).click();
  await expect(status).toContainText(/The family rolled a \d/, { timeout: 15_000 });
  await expect(status).toContainText(/The Night Giraffe rolled a \d/, { timeout: 15_000 });
  await shot(admin, '47-phone-snakes-and-ladders');
});

test('a grown-up signs in, and the Me page', async ({ browser }) => {
  const mum = await open(browser, { width: 820, height: 1180 });
  await mum.goto('/');
  await mum.getByLabel('Email').fill('mum@example.com');
  await mum.getByLabel('Password').fill(mumOtp);
  await mum.getByRole('button', { name: 'Sign in', exact: true }).click();
  await mum.getByLabel('New password', { exact: true }).fill('tea and toast please');
  await mum.getByLabel('New password again').fill('tea and toast please');
  await mum.getByRole('button', { name: 'Save my password' }).click();
  await expect(mum.getByRole('heading', { name: 'Chats' })).toBeVisible();
  await shot(mum, '18-portrait-tablet-chats');
  await mum.getByRole('link', { name: /^Games\b/ }).click();
  await shot(mum, '19-portrait-tablet-games');
  await mum.getByRole('link', { name: /^Me\b/ }).click();
  await mum.getByRole('radio', { name: 'Dark' }).click();
  await shot(mum, '20-me-dark');
  await mum.getByRole('link', { name: /^Chats\b/ }).click();
  await mum.getByRole('link', { name: /Whole family/ }).click();
  await shot(mum, '21-chat-dark');
  await kid.goto('/#/people');
  await expect(kid.getByRole('heading', { name: 'Family' })).toBeVisible();
  await expect(kid.getByRole('button', { name: 'Add someone' })).toHaveCount(0);
  // Mum puts the tablet down (an open app would keep her phone quiet later).
  await mum.context().close();
});

async function inkPixels(page: Page, selector: string) {
  return page.locator(selector).evaluate((c: HTMLCanvasElement) => {
    if (!c.width) return 0;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
    return n;
  });
}

test('a video call: ringing, drawing on each other, and Pull a Face', async () => {
  await admin.goto('/#/chats');
  await admin.getByRole('link', { name: /Whole family/ }).click();
  await admin.getByRole('link', { name: 'Start a video call' }).click();
  await expect(admin.locator('.call')).toBeVisible();
  await kid.goto('/#/chats');
  await expect(kid.getByRole('alertdialog')).toContainText('Alex is calling');
  await kid.getByRole('button', { name: 'Join' }).click();
  await expect(admin.locator('.tile')).toHaveCount(2);
  await expect
    .poll(() => kid.locator('.tile:not([data-self]) video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);

  // Pens out: a moustache and a scribble on Mia, which she sees on herself.
  await admin.getByRole('button', { name: 'Draw' }).click();
  await admin.getByRole('button', { name: 'Moustache' }).click();
  await admin.locator('.tile:not([data-self]) .tile-ink').click();
  await admin.getByRole('button', { name: 'Blue felt tip' }).click();
  await draw(admin, '.tile:not([data-self]) .tile-ink', [[0.3, 0.3], [0.5, 0.2], [0.7, 0.3]]);
  await expect.poll(() => inkPixels(kid, '.tile[data-self] .tile-ink')).toBeGreaterThan(200);
  await shot(admin, '22-call-drawing');
  await shot(kid, '23-phone-call');
  await admin.getByRole('button', { name: 'Share to the chat' }).click();
  await admin.getByRole('button', { name: 'Pens away' }).click();

  // Pull a Face: both cameras take a photo.
  await admin.getByRole('button', { name: 'Play a game' }).click();
  await admin.getByRole('button', { name: /Pull a Face/ }).click();
  await expect(kid.locator('.cg-polaroid img')).toHaveCount(2, { timeout: 15_000 });
  await shot(kid, '24-phone-pull-a-face');

  await kid.getByRole('button', { name: 'Leave' }).click();
  await admin.getByRole('button', { name: 'Leave' }).click();
  await expect(admin.locator('.call-note').last()).toContainText('Mia', { timeout: 20_000 });
  await expect(admin.locator('.msg-text', { hasText: 'Drawn on in our video call' })).toBeVisible();
});

test('Word Garden, against each other', async () => {
  await admin.goto('/#/games');
  await admin.getByRole('button', { name: 'New game' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByRole('button', { name: /Word Garden/ }).click();
  await dialog.getByRole('radio', { name: /Against each other/ }).click();
  await dialog.getByRole('button', { name: /Mia/ }).click();
  await expect(dialog.locator('.vs-pick .field-hint')).toHaveText(/your chat with them|starts a chat for you and Mia/);
  await dialog.getByRole('radio', { name: 'One each' }).click();
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(admin.getByText('Your turn: pick a letter')).toBeVisible();
  const url = admin.url();
  await kid.goto(url);
  await expect(kid.locator('.game-body')).toContainText('Alex');
  // A letter that isn't in the word passes the turn to Mia.
  for (const letter of ['Q', 'Z', 'X', 'J']) {
    if (await admin.getByText('Your turn: pick a letter').isHidden()) break;
    await admin.getByRole('button', { name: letter, exact: true }).click();
    await admin.waitForTimeout(400);
  }
  await expect(kid.getByText('Your turn: pick a letter')).toBeVisible();
  await shot(kid, '25-phone-word-garden-versus');
});

test('games: press and hold, or right-click, to take one off the list', async () => {
  // Mia holds the finished doodle on her phone: it goes from her list, not Alex's.
  await kid.goto('/#/games');
  const doodle = kid.locator('.game-item', { hasText: 'Doodle Together' });
  const box = (await doodle.boundingBox())!;
  const finger = { pointerType: 'touch', isPrimary: true, bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  await doodle.dispatchEvent('pointerdown', finger);
  await kid.waitForTimeout(700);
  await doodle.dispatchEvent('pointerup', finger);
  const confirm = kid.getByRole('dialog');
  await expect(confirm).toContainText('off your list?');
  await expect(confirm).toContainText('It stays in the chat.');
  await shot(kid, '31a-phone-hold-to-remove');
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(kid.getByText(/^Took .* off your list\.$/)).toBeVisible();
  await expect(doodle).toHaveCount(0);
  await admin.goto('/#/games');
  await expect(admin.locator('.game-item', { hasText: 'Doodle Together' })).toBeVisible();

  // Alex right-clicks a game he started, and it stops for everyone.
  await admin.getByRole('button', { name: 'New game' }).click();
  await admin.getByRole('button', { name: /Chess/ }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(admin.locator('.game-head')).toBeVisible();
  const id = admin.url().split('/').pop();
  await admin.goto('/#/games');
  const chess = admin.locator(`a[href="#/games/${id}"]`);
  await chess.click({ button: 'right' });
  await expect(admin.getByRole('dialog')).toContainText('It stops for everyone playing.');
  await shot(admin, '31b-right-click-to-remove');
  await admin.getByRole('dialog').getByRole('button', { name: 'Stop and remove' }).click();
  await expect(admin.getByText(/^Stopped .* and took it off your list\.$/)).toBeVisible();
  await expect(chess).toHaveCount(0);
});

test('daily tasks: a task for Mia, ticked off on her phone and seen straight away', async () => {
  await admin.getByRole('link', { name: /^Calendar\b/ }).click();
  await expect(admin.getByRole('radio', { name: 'Month' })).toBeVisible();
  await admin.getByRole('radio', { name: 'Tasks' }).click();
  await expect(admin.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  await admin.getByRole('button', { name: 'Add a task' }).first().click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('The task').fill('Feed the cat');
  await dialog.getByRole('button', { name: '🐱' }).click();
  await dialog.getByRole('button', { name: /Mia/ }).click();
  await dialog.getByRole('button', { name: /Alex \(you\)/ }).click();
  await dialog.getByRole('radio', { name: 'Afternoon' }).click();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  const chart = admin.locator('.chart', { hasText: 'Mia' });
  await expect(chart).toContainText('Feed the cat');
  await expect(chart).toContainText('Every day · Afternoon');

  // Alex watches the week chart while Mia ticks the cat off on her phone.
  const weekday = new Date().toLocaleDateString('en-GB', { weekday: 'long' });
  const cell = chart.getByRole('checkbox', { name: `Feed the cat, ${weekday}` });
  await expect(cell).toHaveAttribute('aria-checked', 'false');
  await kid.goto('/#/calendar');
  const job = kid.getByRole('checkbox', { name: /Feed the cat/ });
  await expect(job).toHaveAttribute('aria-checked', 'false');
  await job.click();
  // Her tick waits for a grown-up, and she only sees her own tasks, not Alex's.
  await expect(job).toHaveAttribute('aria-checked', 'mixed');
  await expect(job).toContainText('Waiting for a grown-up to check');
  await expect(kid.getByText('Well done, Mia!')).toBeVisible();
  await expect(kid.getByRole('region', { name: "Alex's tasks" })).toHaveCount(0);
  await expect(kid.getByText('Nothing on the calendar today.')).toBeVisible();
  await shot(kid, '26-phone-tasks-today');
  await expect(cell).toHaveAttribute('aria-checked', 'mixed');
  await shot(admin, '27-week-chart');

  // Alex says yes on Today, and it's done for real; Mia can't untick it now.
  await admin.getByRole('radio', { name: 'Today' }).click();
  const toCheck = admin.getByRole('region', { name: 'To check' });
  await expect(toCheck).toContainText('Feed the cat');
  await expect(toCheck).toContainText('Mia · ticked today');
  await shot(admin, '27a-to-check');
  await toCheck.getByRole('button', { name: /^Yes, done: Feed the cat, Mia/ }).click();
  await expect(toCheck).toHaveCount(0);
  await expect(job).toHaveAttribute('aria-checked', 'true');
  await expect(job).toBeDisabled();
});

test('another family: the home family chooses what they can use, and they are never admins', async ({ browser }) => {
  await admin.getByRole('link', { name: /^Family\b/ }).click();
  await admin.getByRole('button', { name: 'Add someone' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Sam');
  await dialog.getByLabel('Email').fill('sam@example.com');
  await dialog.getByRole('radio', { name: 'Grown-up' }).click();
  await dialog.getByLabel('Family', { exact: true }).selectOption('new');
  await dialog.getByLabel("The family's name").fill('The Smiths');
  await expect(dialog.getByRole('radio', { name: 'Admin' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Add and send the invitation' }).click();
  const samOtp = (await dialog.locator('.otp-code').textContent())!.trim();
  await dialog.getByRole('button', { name: 'Done' }).first().click();

  // Alex switches games off for the Smiths.
  await admin.getByRole('button', { name: 'Change The Smiths' }).click();
  await expect(dialog.getByRole('switch', { name: 'Games' })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('switch', { name: 'Games' }).click();
  await shot(admin, '28-bubble-features');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  const sam = await open(browser, phone);
  await sam.goto('/');
  await sam.getByLabel('Email').fill('sam@example.com');
  await sam.getByLabel('Password').fill(samOtp);
  await sam.getByRole('button', { name: 'Sign in', exact: true }).click();
  await sam.getByLabel('New password', { exact: true }).fill('the smiths say hello');
  await sam.getByLabel('New password again').fill('the smiths say hello');
  await sam.getByRole('button', { name: 'Save my password' }).click();
  await expect(sam.getByRole('heading', { name: 'Chats' })).toBeVisible();
  await expect(sam.getByRole('link', { name: /^Tasks\b/ })).toBeVisible();
  await expect(sam.getByRole('link', { name: /^Games\b/ })).toHaveCount(0);

  // Sam can't be made an admin, and his games show as switched off by his family.
  await admin.getByRole('link', { name: /Sam/ }).click();
  await expect(admin.getByRole('heading', { name: 'What Sam can do' })).toBeVisible();
  await expect(admin.getByRole('radio', { name: 'Admin' })).toHaveCount(0);
  await expect(admin.getByRole('switch', { name: 'Play games' })).toBeDisabled();
  await expect(admin.getByText('Switched off for everyone in The Smiths.').first()).toBeVisible();
  await shot(admin, '29-bubble-person');

  // Games come back for the Smiths straight away.
  await admin.getByRole('link', { name: /^Family\b/ }).click();
  await admin.getByRole('button', { name: 'Change The Smiths' }).click();
  await dialog.getByRole('switch', { name: 'Games' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(sam.getByRole('link', { name: /^Games\b/ })).toBeVisible();
});

test('friends from another family: a guardian from each says yes, and family from other homes', async ({ browser }) => {
  // Ollie is Sam's son, in the Smiths.
  await admin.getByRole('link', { name: /^Family\b/ }).click();
  await admin.getByRole('button', { name: 'Add someone' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Ollie');
  await dialog.getByLabel('Email').fill('sam+ollie@example.com');
  await dialog.getByRole('radio', { name: 'Kid' }).click();
  const family = dialog.getByLabel('Family', { exact: true });
  await family.selectOption((await family.locator('option', { hasText: 'The Smiths' }).getAttribute('value'))!);
  await dialog.getByRole('button', { name: 'Add and send the invitation' }).click();
  await expect(dialog.locator('.otp-code')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).first().click();

  // Mia can't message Ollie or his dad, but can ask to chat with Ollie.
  await kid.goto('/#/chats');
  await kid.getByRole('button', { name: 'New chat' }).click();
  const newChat = kid.getByRole('dialog');
  await expect(newChat.getByRole('button', { name: /Sam/ })).toHaveCount(0);
  await shot(kid, '30a-phone-ask-to-chat');
  await newChat.getByRole('button', { name: 'Ask to chat with Ollie' }).click();
  await expect(kid.getByText('Asked. You and Ollie can chat once a guardian from each family says yes.')).toBeVisible();
  await expect(newChat.getByRole('button', { name: 'Ollie, waiting for a yes' })).toBeDisabled();
  await kid.keyboard.press('Escape');

  // Alex says yes for Mia.
  const waiting = admin.locator('.waiting');
  await expect(admin.getByRole('link', { name: /^Family\b.*waiting for your yes/ })).toBeVisible();
  await expect(waiting).toContainText('Can Mia chat with Ollie from The Smiths?');
  await expect(waiting).toContainText('Mia asked. The Smiths needs to say yes too.');
  await shot(admin, '30b-waiting-for-your-yes');
  await waiting.getByRole('button', { name: 'Say yes' }).click();
  await expect(admin.getByText('Thanks. The Smiths needs to say yes too.')).toBeVisible();
  await expect(waiting).toHaveCount(0);

  // Sam says yes for Ollie, on his phone.
  const sam = await open(browser, phone);
  await sam.goto('/');
  await sam.getByLabel('Email').fill('sam@example.com');
  await sam.getByLabel('Password').fill('the smiths say hello');
  await sam.getByRole('button', { name: 'Sign in', exact: true }).click();
  await sam.getByRole('link', { name: /^Family\b/ }).click();
  await expect(sam.locator('.waiting')).toContainText('Can Ollie chat with Mia');
  await expect(sam.locator('.waiting')).toContainText('said yes.');
  await shot(sam, '30c-phone-guardian-says-yes');
  await sam.locator('.waiting').getByRole('button', { name: 'Say yes' }).click();
  await expect(sam.getByText('Ollie and Mia can chat now.')).toBeVisible();

  // Now Mia can message Ollie.
  await kid.getByRole('button', { name: 'New chat' }).click();
  await newChat.getByRole('button', { name: 'Ollie', exact: true }).click();
  await kid.getByLabel('Message', { exact: true }).fill('Park after school?');
  await kid.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(kid.locator('.msg-text', { hasText: 'Park after school?' })).toBeVisible();

  // Sam isn't family to Mia, so they can't chat, until Alex makes him family to the kids at home.
  await sam.getByRole('link', { name: /Mia/ }).first().click();
  await expect(sam.getByText("Sam isn't family to Mia, so they can't chat.", { exact: false })).toBeVisible();
  await expect(sam.getByRole('button', { name: 'Message' })).toHaveCount(0);
  await admin.getByRole('button', { name: /^Change Alex/ }).click();
  await dialog.getByRole('button', { name: /Sam/ }).click();
  await shot(admin, '30d-family-from-other-homes');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(admin.getByText('Family to the kids here: Sam')).toBeVisible();
  await expect(sam.getByRole('button', { name: 'Message' })).toBeVisible();

  // Alex stops Mia and Ollie chatting, and their chat closes.
  await admin.getByRole('link', { name: /Mia/ }).first().click();
  const panel = admin.locator('.panel', { hasText: 'Who Mia can chat with' });
  await expect(panel).toContainText('Ollie');
  await expect(panel).toContainText('Sam');
  await shot(admin, '30e-who-mia-chats-with');
  await panel.getByRole('button', { name: 'Stop' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Stop' }).click();
  await expect(kid.getByText('This chat is closed.')).toBeVisible();
  await expect(kid.getByLabel('Message', { exact: true })).toHaveCount(0);
  await shot(kid, '30f-phone-chat-closed');
  await sam.context().close();

  // Ollie's account goes, so Sam can go later on.
  await admin.getByRole('link', { name: /Ollie/ }).click();
  await admin.getByRole('button', { name: 'Delete account' }).click();
  await dialog.getByLabel('Type Ollie to be sure').fill('Ollie');
  await dialog.getByRole('button', { name: 'Delete for good' }).click();
  await expect(admin.getByText("Ollie's account has gone.")).toBeVisible();
});

test('rewards, reminders, homework, and labels on buttons', async () => {
  // A task for Mia that earns two stars, a sticker and 50p.
  await admin.getByRole('link', { name: /^Calendar\b/ }).click();
  await admin.getByRole('radio', { name: 'Tasks' }).click();
  await admin.getByRole('button', { name: 'Add a task' }).first().click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('The task').fill('Make the bed');
  await dialog.getByRole('button', { name: /Mia/ }).click();
  await dialog.getByRole('button', { name: /Alex \(you\)/ }).click();
  await dialog.getByRole('radio', { name: '⭐ 2' }).click();
  await dialog.getByRole('switch', { name: 'A surprise sticker' }).click();
  await dialog.getByLabel('Pocket money (£)').fill('0.50');
  await shot(admin, '30-task-rewards');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await kid.goto('/#/calendar');
  const bed = kid.getByRole('checkbox', { name: /Make the bed/ });
  await expect(bed).toContainText('⭐ 2 · 50p · a sticker');
  await bed.click();
  await expect(bed).toContainText('Waiting for a grown-up to check, then ⭐ 2 · 50p · a sticker');

  // It earns once Alex checks it.
  await admin.getByRole('radio', { name: 'Today' }).click();
  await admin.getByRole('region', { name: 'To check' }).getByRole('button', { name: /^Yes, done: Make the bed, Mia/ }).click();
  await expect(bed).toContainText('Got ');

  // Alex pays Mia and sets her a goal.
  await admin.getByRole('radio', { name: 'Rewards' }).click();
  const card = admin.getByRole('region', { name: "Mia's rewards" });
  await expect(card).toContainText('50p to come');
  await expect(card).toContainText('Sticker book · 1 of 30');
  await card.getByRole('button', { name: 'Mark paid' }).click();
  await dialog.getByRole('button', { name: 'Mark paid' }).click();
  await expect(card).toContainText('50p paid so far');
  await card.getByRole('button', { name: 'Set a goal' }).click();
  await dialog.getByLabel('The treat').fill('Trip to the park');
  await dialog.getByRole('button', { name: '🛝' }).click();
  await dialog.getByLabel('Stars needed').fill('5');
  await dialog.getByRole('button', { name: 'Set the goal' }).click();
  await expect(card).toContainText('0 of 5 stars');
  await shot(admin, '31-rewards');

  // A reminder for grown-ups: PE kit, which Mia never sees.
  await admin.getByRole('radio', { name: 'Tasks' }).click();
  await admin.getByRole('button', { name: 'Reminder', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: 'Reminder' })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByLabel('What they need').fill('PE kit');
  await dialog.getByRole('button', { name: /Mia/ }).click();
  await dialog.getByLabel('Anything to remember').fill('Trainers and shorts');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await admin.getByRole('radio', { name: 'Today' }).click();
  const pe = admin.getByRole('checkbox', { name: /Mia: PE kit/ });
  await expect(pe).toContainText('Trainers and shorts');
  await pe.click();
  await expect(pe).toHaveAttribute('aria-checked', 'true');
  await expect(admin.getByText('PE kit for Mia')).toBeVisible();
  await shot(admin, '32-kids-need');
  await kid.reload();
  await expect(kid.getByRole('checkbox', { name: /Make the bed/ })).toBeVisible();
  await expect(kid.getByText('What the kids need')).toHaveCount(0);
  await expect(kid.getByText(/PE kit/)).toHaveCount(0);

  // Mia sets a reminder for herself. It's on her Today, and Alex sees it too.
  const kidDialog = kid.getByRole('dialog');
  await kid.getByRole('radio', { name: 'Tasks' }).click();
  await kid.getByRole('button', { name: 'Reminder', exact: true }).click();
  await kidDialog.getByLabel('What you need').fill('Library book');
  await kidDialog.getByRole('button', { name: '📚' }).click();
  await kidDialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(kid.locator('.cal-event', { hasText: 'Library book' })).toContainText('Every day');
  await kid.getByRole('radio', { name: 'Today' }).click();
  await expect(kid.getByRole('heading', { name: 'Things to remember' })).toBeVisible();
  const book = kid.getByRole('checkbox', { name: /^Library book/ });
  await book.click();
  await expect(book).toHaveAttribute('aria-checked', 'true');
  await expect(kid.getByText(/PE kit/)).toHaveCount(0);
  await shot(kid, '32a-phone-my-reminder');
  await expect(admin.getByRole('checkbox', { name: /Mia: Library book/ })).toHaveAttribute('aria-checked', 'true');

  // The (i) beside a heading explains it, and a held button says what it does.
  await admin.getByRole('button', { name: "About today's tasks" }).click();
  await expect(admin.locator('.info-note')).toContainText('Tap a task to tick it off.');
  await shot(admin, '32b-info-note');
  await admin.keyboard.press('Escape');
  await expect(admin.locator('.info-note')).toHaveCount(0);
  await admin.getByRole('radio', { name: 'Tasks' }).click();
  await admin.getByRole('button', { name: 'Next week' }).hover();
  await expect(admin.locator('.tip-bubble')).toHaveText('Next week');
  await kid.getByRole('radio', { name: 'Tasks' }).click();
  const next = kid.getByRole('button', { name: 'Next week' });
  await next.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, bubbles: true });
  await expect(kid.locator('.tip-bubble')).toHaveText('Next week');
  await shot(kid, '32c-phone-hold-for-a-label');
  await next.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true, bubbles: true });
  await next.dispatchEvent('click');
  await expect(kid.locator('.week-name')).toContainText('This week');

  // Mia adds her own homework and hands it in on time. What she sets herself earns nothing.
  await kid.getByRole('radio', { name: 'Homework' }).click();
  await kid.getByRole('button', { name: 'Add homework' }).first().click();
  await expect(kidDialog.getByText(/Tasks you set yourself are just for you/)).toBeVisible();
  await expect(kidDialog.getByRole('switch', { name: 'A surprise sticker' })).toHaveCount(0);
  await kidDialog.getByLabel('Subject').fill('Maths');
  await kidDialog.getByLabel('What to do').fill('Times tables');
  await kidDialog.getByRole('button', { name: 'Add', exact: true }).click();
  const hw = kid.getByRole('region', { name: "Mia's homework" });
  await expect(hw).toContainText('Times tables');
  await expect(hw).toContainText('1 to hand in');
  await shot(kid, '33-phone-homework');
  await hw.getByRole('radio', { name: 'Handed in' }).click();
  await expect(kid.getByText(/Handed in on time/)).toBeVisible();
  await expect(hw).toContainText('All handed in');

  await admin.getByRole('radio', { name: 'Homework' }).click();
  await expect(admin.getByRole('region', { name: "Mia's homework" })).toContainText('Handed in lately (1)');
});

test('the family calendar, linked both ways with a calendar the family already uses', async () => {
  const caldav = await startFakeCaldav();
  const saved = (text: string) => [...caldav.objects.values()].some((o) => o.data.includes(text));
  try {
    await admin.getByRole('link', { name: /^Calendar\b/ }).click();
    await admin.getByRole('radio', { name: 'Month' }).click();
    await admin.getByRole('button', { name: 'Link a calendar' }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByRole('button', { name: /Another calendar server/ }).click();
    await dialog.getByLabel('Server address').fill(caldav.url);
    await dialog.getByLabel('Username').fill('alex');
    await dialog.getByLabel('Password', { exact: true }).fill('not the password');
    await dialog.getByRole('button', { name: 'Find calendars' }).click();
    await expect(dialog.getByText("The server didn't accept that username and password.")).toBeVisible();
    await dialog.getByLabel('Password', { exact: true }).fill('app-password');
    await dialog.getByRole('button', { name: 'Find calendars' }).click();

    // The reminders list isn't for events, so only the family calendar is offered.
    await expect(dialog.getByRole('checkbox', { name: /Family/ })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('checkbox', { name: /Reminders/ })).toHaveCount(0);
    await shot(admin, '34-link-pick');
    await dialog.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(dialog.locator('.link-row', { hasText: 'Family' })).toContainText('both ways');
    await expect(dialog.locator('.link-row', { hasText: 'Family' })).toContainText('new events go here');

    // And the school's calendar, to look at.
    await dialog.getByRole('button', { name: /A calendar's address/ }).click();
    await dialog.getByLabel("The calendar's address").fill(`${caldav.url}/feeds/school.ics`);
    await dialog.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(dialog.locator('.link-row', { hasText: 'Oak Primary' })).toContainText('shown here');
    await shot(admin, '35-linked-calendars');
    await dialog.getByRole('button', { name: 'Done' }).click();

    await expect(admin.locator('.month-item', { hasText: 'Dentist' })).toBeVisible();
    await expect(admin.locator('.links-chip', { hasText: 'Oak Primary' })).toBeVisible();

    // Added here, it's saved in the family's calendar too.
    await admin.getByRole('button', { name: 'Add an event' }).click();
    await dialog.getByLabel("What's happening").fill('Swimming');
    await expect(dialog.getByLabel('Calendar')).not.toHaveValue('here');
    await dialog.getByRole('button', { name: /Mia/ }).click();
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => saved('SUMMARY:Swimming')).toBe(true);
    await shot(admin, '36-month-linked');

    // Changed here, changed there.
    await admin.getByRole('button', { name: /Dentist/ }).first().click();
    await expect(dialog.getByText('In Family. Changes are saved there too.')).toBeVisible();
    await dialog.getByLabel("What's happening").fill('Dentist (Mia)');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => saved('SUMMARY:Dentist (Mia)')).toBe(true);

    // Football repeats in that calendar, so it's changed there.
    await admin.getByRole('radio', { name: 'Today' }).click();
    await admin.getByRole('button', { name: /Football/ }).first().click();
    await expect(dialog.getByText(/This repeats in Family/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    // Mia sees it all on her phone.
    await kid.goto('/#/calendar');
    await expect(kid.getByRole('button', { name: /Dentist \(Mia\)/ })).toBeVisible();
    await expect(kid.getByRole('button', { name: /Swimming/ })).toBeVisible();
    await expect(kid.getByRole('button', { name: /INSET day/ })).toBeVisible();
    await shot(kid, '37-phone-calendar');
  } finally {
    caldav.close();
  }
});

test('Google and Outlook calendars, linked both ways by signing in', async () => {
  const stand = await startFakeConnect();
  try {
    await admin.getByRole('link', { name: /^Calendar\b/ }).click();
    await admin.getByRole('radio', { name: 'Month' }).click();
    await admin.getByRole('button', { name: 'Linked calendars' }).click();
    const dialog = admin.getByRole('dialog');

    // Set up once by an admin, with the app registered with Google.
    await dialog.getByRole('button', { name: /^Google/ }).click();
    await expect(dialog.getByRole('heading', { name: 'Set up signing in to Google' })).toBeVisible();
    await expect(dialog.getByLabel('Redirect address')).toHaveValue(/\/calendar-connect\/google$/);
    await dialog.getByLabel('Client ID').fill('GOCSPX-not-the-id');
    await dialog.getByLabel('Client secret').fill(googleClient.secret);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByText("Google's client ID ends in .apps.googleusercontent.com.")).toBeVisible();
    await shot(admin, '48-google-setup');
    await dialog.getByLabel('Client ID').fill(googleClient.id);
    await dialog.getByRole('button', { name: 'Save' }).click();

    // Then anyone who can change the calendar signs in and picks calendars.
    await dialog.getByRole('button', { name: /^Google/ }).click();
    await expect(dialog.getByText(/hasn't checked this app/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Continue to Google' }).click();
    await admin.getByRole('link', { name: 'Allow' }).click();
    await expect(dialog.getByText('Signed in to Google as family.calendar@gmail.com.')).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: /Family/ })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('checkbox', { name: /Holidays/ })).toContainText('Shown here only');
    await shot(admin, '49-google-pick');
    await dialog.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(admin).toHaveURL(/#\/calendar\/month$/);
    await expect(admin.locator('.month-item', { hasText: 'Bake sale' })).toBeVisible();

    // Added here, saved in Google, with its emoji kept alongside.
    await admin.getByRole('button', { name: 'Add an event' }).click();
    await dialog.getByLabel("What's happening").fill('Cinema');
    await dialog.getByLabel('Calendar').selectOption({ label: 'Family (Google)' });
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => [...stand.google.values()].some((i) => i.summary === 'Cinema')).toBe(true);

    // Outlook isn't set up yet, so only an admin can start it; the same steps follow.
    await admin.getByRole('button', { name: 'Linked calendars' }).click();
    await expect(dialog.locator('.link-row', { hasText: 'Google' })).toContainText('Google · both ways');
    await dialog.getByRole('button', { name: /^Outlook/ }).click();
    await dialog.getByLabel('Application (client) ID').fill(microsoftClient.id);
    await dialog.getByLabel('Client secret').fill(microsoftClient.secret);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.getByRole('button', { name: /^Outlook/ }).click();
    await dialog.getByRole('button', { name: 'Continue to Microsoft' }).click();
    await admin.getByRole('link', { name: 'Allow' }).click();
    await expect(dialog.getByText('Signed in to Microsoft as family.calendar@outlook.com.')).toBeVisible();
    await dialog.getByRole('radio', { name: 'Just me' }).click();
    await dialog.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await admin.getByRole('button', { name: 'Linked calendars' }).click();
    await expect(dialog.locator('.link-row', { hasText: 'Outlook' })).toContainText('only you see it');
    await shot(admin, '50-linked-google-outlook');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(admin.locator('.month-item', { hasText: 'Dentist' }).first()).toBeVisible();

    // Mia sees the family's Google calendar, not Alex's own Outlook one.
    await kid.goto('/#/calendar');
    await kid.getByRole('radio', { name: 'Month' }).click();
    await expect(kid.locator('.month-item', { hasText: 'Bake sale' })).toBeVisible();
    await expect(kid.locator('.month-item', { hasText: 'Cinema' })).toBeVisible();
  } finally {
    stand.close();
  }
});

test('notifications: on for a phone, a message pops up while the app is closed, and a chat can be muted', async ({ baseURL }) => {
  const push = await startFakePush();
  // The lighter headless browser always says notifications are blocked, so
  // Mum's phone is the full one.
  const phoneBrowser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' });
  const context = await phoneBrowser.newContext({ viewport: phone, deviceScaleFactor: 1, baseURL });
  await context.grantPermissions(['notifications']);
  // The browser's push service isn't reachable from here, so the phone's
  // subscription points at the fake one.
  await context.addInitScript(
    ({ endpoint, keys }) => {
      const saved = 'fake-push-key';
      const sub = (key: ArrayBuffer) => ({
        endpoint,
        options: { applicationServerKey: key, userVisibleOnly: true },
        toJSON: () => ({ endpoint, expirationTime: null, keys }),
        unsubscribe: async () => (localStorage.removeItem(saved), true),
      });
      PushManager.prototype.subscribe = async function (options?: PushSubscriptionOptionsInit) {
        const key = new Uint8Array(options!.applicationServerKey as Uint8Array);
        localStorage.setItem(saved, btoa(String.fromCharCode(...key)));
        return sub(key.buffer) as unknown as PushSubscription;
      };
      PushManager.prototype.getSubscription = async function () {
        const key = localStorage.getItem(saved);
        return key ? (sub(Uint8Array.from(atob(key), (c) => c.charCodeAt(0)).buffer) as unknown as PushSubscription) : null;
      };
    },
    { endpoint: push.endpoint, keys: push.keys },
  );
  const notifications = (page: Page) =>
    page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag })));

  try {
    const mum = await context.newPage();
    await mum.goto('/');
    await mum.getByLabel('Email').fill('mum@example.com');
    await mum.getByLabel('Password').fill('tea and toast please');
    await mum.getByRole('button', { name: 'Sign in', exact: true }).click();
    await mum.getByRole('link', { name: /^Me\b/ }).click();
    await mum.getByRole('switch', { name: 'On this device' }).click();
    await expect(mum.getByText('Notifications are on for this device.')).toBeVisible();
    await expect(mum.getByRole('switch', { name: 'On this device' })).toHaveAttribute('aria-checked', 'true');
    await mum.getByRole('button', { name: 'Send a test' }).click();
    await expect.poll(() => push.received.length).toBe(1);
    expect(push.open(push.received[0])).toMatchObject({ kind: 'test', body: 'Notifications work on this device.' });

    // Grown-ups get a morning summary at seven and tomorrow's at eight in the evening.
    // Mum moves the morning one to half past six and switches the evening one off.
    await expect(mum.getByRole('switch', { name: 'Morning summary' })).toHaveAttribute('aria-checked', 'true');
    await expect(mum.getByRole('switch', { name: 'Evening summary' })).toHaveAttribute('aria-checked', 'true');
    await expect(mum.getByLabel('Evening time')).toHaveValue('20:00');
    await mum.getByLabel('Morning time').fill('06:30');
    await mum.getByLabel('Morning time').blur();
    await expect.poll(async () => (await (await mum.request.get('/api/me')).json()).me.morning).toBe('06:30');
    await mum.getByRole('switch', { name: 'Evening summary' }).click();
    await expect(mum.getByLabel('Evening time')).toHaveCount(0);
    expect((await (await mum.request.get('/api/me')).json()).me).toMatchObject({ morning: '06:30', evening: null });
    await mum.getByRole('switch', { name: 'Evening summary' }).click();
    await expect(mum.getByLabel('Evening time')).toHaveValue('20:00');
    while (await mum.locator('.toast-close').count()) await mum.locator('.toast-close').first().click();
    await mum.getByRole('switch', { name: 'Evening summary' }).scrollIntoViewIfNeeded();
    await shot(mum, '38-notifications');

    // Mum puts her phone away; Alex writes in the family chat.
    const cdp = await context.newCDPSession(mum);
    await cdp.send('ServiceWorker.enable');
    const registration = new Promise<string>((resolve) =>
      cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
        const live = registrations.find((r) => !r.isDeleted);
        if (live) resolve(live.registrationId);
      }),
    );
    const registrationId = await registration;
    const origin = new URL(mum.url()).origin;
    await mum.goto('about:blank');
    await admin.goto('/#/chats');
    await admin.getByRole('link', { name: /Whole family/ }).click();
    for (const text of ["Dinner's ready", 'Bring a jumper']) {
      await admin.getByLabel('Message', { exact: true }).fill(text);
      await admin.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(admin.locator('.msg-text', { hasText: text })).toBeVisible();
    }
    await expect.poll(() => push.received.length).toBe(3);
    const messages = push.received.slice(1).map(push.open);
    expect(messages[0]).toMatchObject({ kind: 'message', body: "Alex: Dinner's ready" });
    expect(String(messages[0].title)).toContain('Whole family');
    expect(push.received[1].headers['content-encoding']).toBe('aes128gcm');

    // The phone shows them as one notification for the chat.
    for (const m of messages) await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify(m) });
    const shown = await context.newPage();
    await shown.goto('/manifest.webmanifest');
    await expect.poll(async () => (await notifications(shown)).length).toBe(1);
    expect((await notifications(shown))[0]).toMatchObject({ body: "Alex: Dinner's ready\nAlex: Bring a jumper", tag: messages[0].tag });
    await shown.close();

    // Opening the app clears them; muting the chat stops them.
    await mum.goto('/#/chats');
    await expect.poll(async () => (await notifications(mum)).length).toBe(0);
    await mum.getByRole('link', { name: /Whole family/ }).click();
    await mum.getByRole('button', { name: 'Mute this chat' }).click();
    await expect(mum.getByRole('button', { name: 'Mute this chat' })).toHaveAttribute('aria-pressed', 'true');
    await mum.goto('about:blank');
    await admin.getByLabel('Message', { exact: true }).fill('Anyone for tea?');
    await admin.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(admin.locator('.msg-text', { hasText: 'Anyone for tea?' })).toBeVisible();
    await admin.waitForTimeout(1500);
    expect(push.received.length).toBe(3);
  } finally {
    await phoneBrowser.close();
    push.close();
  }
});

test('your things: downloads, and accounts deleted for good', async ({ browser }) => {
  // Alex downloads the whole family.
  await admin.getByRole('link', { name: /^Family\b/ }).click();
  const [everything] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('link', { name: /Download everything/ }).click()]);
  expect(everything.suggestedFilename()).toMatch(/^kitchen-table-family-\d{4}-\d\d-\d\d\.zip$/);
  const zip = await fs.readFile(await everything.path());
  expect(zip.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');
  for (const name of ['family.json', 'calendar.json', 'tasks.json', 'chats/001-whole-family.json', 'media/']) expect(zip.includes(name)).toBe(true);

  // Sam is the only one in the Smiths; Alex deletes his account, and the Smiths go too.
  await admin.getByRole('link', { name: /Sam/ }).click();
  await admin.getByRole('button', { name: 'Delete account' }).click();
  const dialog = admin.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Delete for good' })).toBeDisabled();
  await dialog.getByLabel('Type Sam to be sure').fill('Sam');
  await shot(admin, '39-delete-person');
  await dialog.getByRole('button', { name: 'Delete for good' }).click();
  await expect(admin.getByText("Sam's account has gone.")).toBeVisible();
  await expect(admin.getByRole('link', { name: /Sam/ })).toHaveCount(0);
  await expect(admin.getByRole('heading', { name: 'The Smiths' })).toHaveCount(0);

  // Mum takes her things, then deletes her own account.
  const mum = await open(browser, phone);
  await mum.goto('/');
  await mum.getByLabel('Email').fill('mum@example.com');
  await mum.getByLabel('Password').fill('tea and toast please');
  await mum.getByRole('button', { name: 'Sign in', exact: true }).click();
  await mum.getByRole('link', { name: /^Me\b/ }).click();
  const [mine] = await Promise.all([mum.waitForEvent('download'), mum.getByRole('link', { name: 'Download my things' }).click()]);
  expect(mine.suggestedFilename()).toMatch(/^kitchen-table-mum-/);
  expect((await fs.readFile(await mine.path())).includes('me.json')).toBe(true);
  await mum.getByRole('button', { name: 'Delete my account' }).click();
  const confirm = mum.getByRole('dialog');
  await confirm.getByLabel('Your password').fill('not my password');
  await confirm.getByRole('button', { name: 'Delete for good' }).click();
  await expect(confirm.getByText("That password isn't right.")).toBeVisible();
  await shot(mum, '40-delete-me');
  await confirm.getByLabel('Your password').fill('tea and toast please');
  await confirm.getByRole('button', { name: 'Delete for good' }).click();
  await expect(mum.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await mum.context().close();
  await admin.reload();
  await expect(admin.getByRole('link', { name: /Mum/ })).toHaveCount(0);
});

test('a kid with no email signs in with a code a grown-up makes', async ({ browser }) => {
  const dialog = admin.getByRole('dialog');
  await admin.getByRole('link', { name: /^Family\b/ }).click();
  await admin.getByRole('button', { name: 'Add someone' }).click();
  await dialog.getByLabel('Name').fill('Robin');
  await dialog.getByRole('radio', { name: 'Kid' }).click();
  await expect(dialog).toContainText('sign in with a code');
  await dialog.getByRole('button', { name: 'Add and make a sign-in code' }).click();
  await expect(dialog).toContainText("Robin's sign-in code");
  const code = (await dialog.locator('.otp-code').textContent())!.trim();
  await shot(admin, '60-sign-in-code');
  await dialog.getByRole('button', { name: 'Done' }).first().click();

  // On Robin's tablet: the code, typed with spaces the way a kid might.
  const robin = await open(browser);
  await robin.goto('/');
  await robin.getByRole('button', { name: 'No email? Sign in with a code' }).click();
  await robin.getByLabel('Code').fill(code.replaceAll('-', ' '));
  await shot(robin, '61-tablet-code-sign-in');
  await robin.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(robin.getByRole('heading', { name: 'Chats', exact: true })).toBeVisible();
  await robin.getByRole('link', { name: /^Me\b/ }).click();
  await expect(robin.getByRole('heading', { name: 'Password' })).toHaveCount(0);
  await robin.context().close();

  // The code worked once; a new one is made on Robin's page.
  await admin.getByRole('link', { name: /Robin/ }).click();
  await expect(admin.getByText('No email: signs in with a code')).toBeVisible();
  await admin.getByRole('button', { name: 'New sign-in code' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Make a code' }).click();
  await expect(admin.locator('.otp-code')).not.toHaveText(code);
});

test('Learn: holiday phrases in Japanese and French, learned as a family', async () => {
  await admin.goto('/#/chats');
  await admin.getByRole('link', { name: /^Learn\b/ }).click();
  await expect(admin.getByRole('heading', { name: 'Learn', level: 1 })).toBeVisible();
  await admin.getByRole('radio', { name: /Japanese/ }).click();
  await admin.getByRole('radio', { name: '8–10' }).click();
  await expect(admin.locator('.learn-today')).toContainText("Today's phrase, for everyone");
  await expect(admin.locator('.learn-family')).toContainText('Nobody has marked a Japanese phrase yet');

  // Each phrase has its words, how to say it, a speaker, and I know it.
  const thanks = admin.locator('.phrase', { hasText: 'ありがとう' }).first();
  await expect(thanks).toContainText('ah-ree-gah-toh');
  await expect(thanks.getByRole('button', { name: 'Hear "Thank you"' })).toBeVisible();
  await thanks.getByRole('button', { name: 'I know "Thank you"' }).click();
  await expect(thanks.getByRole('button', { name: 'I know "Thank you"' })).toHaveAttribute('aria-pressed', 'true');
  await expect(admin.locator('.learn-family')).toContainText('1 phrase');
  await shot(admin, '70-learn-phrases');

  // Mia sees it on her phone, and what she learns shows on Alex's screen.
  await kid.goto('/#/learn');
  await kid.getByRole('radio', { name: /Japanese/ }).click();
  await expect(kid.locator('.learn-family')).toContainText('Alex');
  await kid.getByRole('button', { name: 'I know "Hello"' }).click();
  await expect(admin.locator('.learn-family')).toContainText('Mia');
  await expect(admin.locator('.phrase', { hasText: 'こんにちは' }).locator('.faces .avatar')).toHaveCount(1);
  await shot(kid, '71-phone-learn');

  // Cards: the English, then the Japanese and how to say it.
  await admin.getByRole('radio', { name: 'Practise', exact: true }).click();
  await expect(admin.locator('.flash-count')).toHaveText('1 of 10');
  await admin.getByRole('button', { name: 'Show me' }).click();
  await expect(admin.locator('.flash-native')).toBeVisible();
  await shot(admin, '72-learn-practise');
  await admin.getByRole('button', { name: 'I knew it' }).click();
  await expect(admin.locator('.flash-count')).toHaveText('2 of 10');
  await expect(admin.locator('.learn-family')).toContainText('2 phrases');

  // Characters: a chart of all 46 to tap and hear, and a quiz.
  await admin.getByRole('radio', { name: 'Characters', exact: true }).click();
  await expect(admin.getByRole('group', { name: 'Hiragana chart' }).getByRole('button')).toHaveCount(46);
  await admin.getByRole('button', { name: 'Quiz me on Hiragana' }).click();
  await admin.locator('.kana-choice').first().click();
  await expect(admin.locator('.flash-feedback')).toHaveText(/^(Yes! That's|Not quite: it's) \w+\.$/);
  await shot(admin, '73-learn-characters');

  // French has no characters to learn, but signs to spot.
  await admin.getByRole('radio', { name: /French/ }).click();
  await expect(admin.getByRole('radio', { name: 'Characters', exact: true })).toHaveCount(0);
  await admin.getByRole('radio', { name: 'Signs', exact: true }).click();
  await expect(admin.locator('.phrase-sign', { hasText: 'Sortie' })).toContainText('sor-tee');
  await shot(admin, '74-learn-signs');
});

test('Learn: bullet trains for everyone, and road signs and a road test for grown-ups', async () => {
  // Answers every question right: from the quiz's own list, or for a sign, from its picture.
  const answers = new Map([...roadRules, ...trainQuestions].map((q) => [q.q, q.right]));
  async function answerAll(page: Page, count: number) {
    const quiz = page.locator('.quiz');
    for (let i = 0; i < count; i++) {
      await expect(page.locator('.flash-count')).toHaveText(`${i + 1} of ${count}`);
      const q = (await quiz.locator('.quiz-q').textContent()) ?? '';
      const right = answers.get(q) ?? ((await quiz.locator('.road-sign-picture').getAttribute('aria-label')) ?? '').replace(/^Sign: /, '');
      await quiz.getByRole('button', { name: right, exact: true }).click();
      await expect(quiz.locator('.flash-feedback')).toHaveText('Yes!');
      await quiz.getByRole('button', { name: i === count - 1 ? 'See how you did' : 'Next' }).click();
    }
  }
  const result = (page: Page) => page.locator('.flashcard[role="status"]');

  await admin.goto('/#/learn');
  await admin.getByRole('radio', { name: /Japanese/ }).click();
  await admin.getByRole('radio', { name: 'Travel', exact: true }).click();
  await expect(admin.getByRole('radiogroup', { name: 'Ages' })).toHaveCount(0);
  await admin.getByRole('radio', { name: /Bullet trains/ }).click();
  await admin.getByRole('button', { name: 'Bullet train quiz' }).click();
  await answerAll(admin, 8);
  await expect(result(admin)).toContainText('8 of 8 right');
  await expect(result(admin)).toContainText("You're a bullet train expert!");
  await admin.getByRole('button', { name: 'Done' }).click();
  await expect(admin.locator('.travel-badge')).toContainText('bullet train expert');
  await expect(admin.locator('.learn-family')).toContainText('Bullet train expert');
  await shot(admin, '75-learn-bullet-trains');

  // Driving: every sign drawn, each to mark as known, and the road test.
  await admin.getByRole('radio', { name: /Driving/ }).click();
  await expect(admin.locator('.road-sign')).toHaveCount(roadSigns.length);
  await expect(admin.getByRole('img', { name: 'Sign: Stop' })).toBeVisible();
  await admin.getByRole('button', { name: 'I know "Stop"' }).click();
  await expect(admin.locator('.learn-family')).toContainText('1 road sign');
  await shot(admin, '76-learn-road-signs');
  await admin.getByRole('button', { name: 'Take the road test' }).click();
  await answerAll(admin, 10);
  await expect(result(admin)).toContainText('10 of 10 right');
  await expect(result(admin)).toContainText('You passed the road test!');
  await admin.getByRole('button', { name: 'Done' }).click();
  await expect(admin.locator('.learn-family')).toContainText('Passed the road test');

  // Station signs have their own heading in Signs.
  await admin.getByRole('radio', { name: 'Signs', exact: true }).click();
  await expect(admin.getByRole('heading', { name: 'At the station' })).toBeVisible();
  await expect(admin.locator('.phrase-sign', { hasText: '改札' })).toContainText('kai-sat-soo');

  // Mia has bullet trains but no driving, and sees Alex's pass come in.
  await kid.goto('/#/learn');
  await kid.getByRole('radio', { name: /Japanese/ }).click();
  await kid.getByRole('radio', { name: 'Travel', exact: true }).click();
  await kid.getByRole('radio', { name: /Bullet trains/ }).click();
  await expect(kid.getByRole('button', { name: 'Bullet train quiz' })).toBeVisible();
  await expect(kid.getByRole('radio', { name: /Driving/ })).toHaveCount(0);
  await expect(kid.locator('.learn-family')).toContainText('Passed the road test');
  await kid.getByRole('button', { name: 'Bullet train quiz' }).click();
  await kid.locator('.quiz-choice').first().click();
  await expect(kid.locator('.quiz-why')).not.toBeEmpty();
  await shot(kid, '77-phone-bullet-train-quiz');
});

test('Learn: counting down to Japan, and spotting things on the trip', async () => {
  await admin.goto('/#/learn');
  await admin.getByRole('radio', { name: /Japanese/ }).click();
  // A grown-up sets the date, three weeks away.
  const trip = new Date(Date.now() + 21 * 86_400_000);
  const iso = [trip.getFullYear(), String(trip.getMonth() + 1).padStart(2, '0'), String(trip.getDate()).padStart(2, '0')].join('-');
  await admin.getByLabel('When do you go to Japan?').fill(iso);
  await admin.getByRole('button', { name: 'Start the countdown' }).click();
  await expect(admin.locator('.countdown')).toContainText('21 sleeps until Japan!');
  await expect(admin.locator('.countdown-weeks')).toHaveText("That's 3 weeks.");
  await expect(admin.locator('.countdown')).toContainText('Did you know?');
  await shot(admin, '78-learn-countdown');

  // Mia sees it too, but can't change it.
  await kid.goto('/#/learn');
  await kid.getByRole('radio', { name: /Japanese/ }).click();
  await expect(kid.locator('.countdown')).toContainText('21 sleeps until Japan!');
  await expect(kid.getByRole('button', { name: 'Change the date' })).toHaveCount(0);

  // Spot it: four in a row is bingo, and Alex sees who spotted what.
  await kid.getByRole('radio', { name: 'Travel', exact: true }).click();
  await kid.getByRole('radio', { name: /Spot it/ }).click();
  for (const name of ['Shrine gate', 'Mount Fuji', 'Bullet train', 'Deer']) await kid.getByRole('button', { name, exact: true }).click();
  await expect(kid.locator('.spot-score')).toContainText('Bingo!');
  await expect(kid.getByRole('button', { name: 'Deer', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await shot(kid, '79-phone-spot-it');
  await admin.getByRole('radio', { name: 'Travel', exact: true }).click();
  await admin.getByRole('radio', { name: /Spot it/ }).click();
  await expect(admin.getByRole('button', { name: 'Deer', exact: true }).locator('.faces .avatar')).toHaveCount(1);
  await expect(admin.locator('.learn-family')).toContainText('4 spotted');

  // No date after all: the countdown goes, and the question comes back.
  await admin.getByRole('button', { name: 'Change the date' }).click();
  await admin.getByRole('button', { name: 'No date yet' }).click();
  await expect(admin.locator('.countdown')).toHaveCount(0);
  await expect(admin.getByLabel('When do you go to Japan?')).toBeVisible();
});

test('no text runs out of its box on any screen', async () => {
  await fs.mkdir(path.join(import.meta.dirname, '..', 'test-results'), { recursive: true });
  await fs.writeFile(path.join(import.meta.dirname, '..', 'test-results', 'spills.json'), JSON.stringify(spilt, null, 2));
  expect(spilt).toEqual([]);
});
