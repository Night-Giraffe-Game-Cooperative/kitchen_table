import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanContrast, type LowContrast } from './fixtures/contrast';
import { spills, type Spill } from './fixtures/spills';

// Every screen, for an admin and a kid, on a phone and a tablet, light and
// dark, checked with axe against WCAG 2.2 AA. Runs after the family story,
// which leaves a family with chats, games, tasks and events to look at.

test.describe.configure({ mode: 'serial' });

const phone = { width: 390, height: 844 };
const tablet = { width: 1180, height: 820 };

interface Found {
  where: string;
  id: string;
  impact: string;
  help: string;
  nodes: { target: string; html: string; summary: string }[];
}

const found: Found[] = [];
const unsure: Found[] = [];
const contrast: (LowContrast & { where: string })[] = [];
const spilt: (Spill & { where: string })[] = [];

async function signIn(browser: Browser, email: string, password: string, size: typeof phone, colorScheme: 'light' | 'dark') {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, colorScheme });
  const page = await context.newPage();
  await page.goto('/');
  if (email) {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Chats', exact: true })).toBeVisible();
  }
  return page;
}

async function check(page: Page, where: string) {
  await page.waitForTimeout(400);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  for (const v of result.violations)
    found.push({
      where,
      id: v.id,
      impact: v.impact ?? 'unknown',
      help: v.help,
      nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160), summary: (n.failureSummary ?? '').slice(0, 300) })),
    });
  const low = await page.evaluate(scanContrast);
  for (const l of low) contrast.push({ where, ...l });
  expect.soft(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 80)}`), where).toEqual([]);
  expect.soft(low.map((l) => `${l.text} (${l.ratio})`), `contrast, ${where}`).toEqual([]);
  for (const v of result.incomplete.filter((v) => v.id === 'color-contrast'))
    unsure.push({
      where,
      id: v.id,
      impact: v.impact ?? 'unknown',
      help: v.help,
      nodes: v.nodes.slice(0, 40).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160), summary: JSON.stringify(n.any[0]?.data ?? {}).slice(0, 300) })),
    });
}

async function dialog(page: Page, hash: string, opener: string | RegExp, where: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
  const button = page.getByRole('button', { name: opener }).or(page.getByRole('link', { name: opener })).first();
  await button.click({ timeout: 4000 });
  await expect(page.getByRole('dialog').last()).toBeVisible();
  await check(page, where);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function visit(page: Page, hash: string, where: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
  await check(page, where);
}

async function api<T>(page: Page, url: string): Promise<T> {
  return page.evaluate(async (u) => (await fetch(u)).json(), url);
}

for (const scheme of ['light', 'dark'] as const)
  for (const [sizeName, size] of [
    ['phone', phone],
    ['tablet', tablet],
  ] as const) {
    test(`admin screens, ${sizeName}, ${scheme}`, async ({ browser }) => {
      const signedOut = await signIn(browser, '', '', size, scheme);
      await check(signedOut, `sign in (${sizeName}, ${scheme})`);
      await signedOut.context().close();

      const page = await signIn(browser, 'alex@example.com', 'kitchen table one', size, scheme);
      const tag = `admin ${sizeName} ${scheme}`;
      await check(page, `chats (${tag})`);
      const { rooms } = await api<{ rooms: { id: number; kind: string; member: boolean }[] }>(page, '/api/rooms');
      for (const room of rooms.slice(0, 3)) await visit(page, `#/chats/${room.id}`, `chat ${room.kind} (${tag})`);
      await visit(page, '#/games', `games (${tag})`);
      await visit(page, '#/learn', `learn (${tag})`);
      const { games } = await api<{ games: { id: number; type: string; mode: string }[] }>(page, '/api/games');
      const seen = new Set<string>();
      for (const game of games) {
        const kind = `${game.type} ${game.mode}`;
        if (seen.has(kind)) continue;
        seen.add(kind);
        await visit(page, `#/games/${game.id}`, `game ${kind} (${tag})`);
      }
      await dialog(page, `#/games/${games[0].id}`, 'How to play', `how to play (${tag})`);
      await dialog(page, '#/games', 'New game', `new game (${tag})`);
      await dialog(page, '#/chats', 'New chat', `new chat (${tag})`);
      await dialog(page, '#/calendar', 'Add an event', `new event (${tag})`);
      await dialog(page, '#/calendar/tasks', 'Add a task', `new task (${tag})`);
      await dialog(page, '#/calendar/homework', /^Add homework/, `new homework (${tag})`);
      await dialog(page, '#/calendar/rewards', /goal/i, `new goal (${tag})`);
      await dialog(page, '#/calendar/month', /^Linked calendars$/, `linked calendars (${tag})`);
      await dialog(page, '#/people', 'Add someone', `add someone (${tag})`);
      const group = rooms.find((r) => r.kind === 'group' && r.member);
      if (group) await dialog(page, `#/chats/${group.id}`, 'Change group', `change group (${tag})`);
      for (const view of ['', '/month', '/tasks', '/homework', '/rewards']) await visit(page, `#/calendar${view}`, `calendar${view || ' today'} (${tag})`);
      await visit(page, '#/people', `family (${tag})`);
      const { people } = await api<{ people: { id: number }[] }>(page, '/api/people');
      await visit(page, `#/people/${people[1].id}`, `person (${tag})`);
      const kid = people.find((p) => (p as { role?: string }).role === 'kid');
      if (kid) await dialog(page, `#/people/${kid.id}`, 'Add a friend', `add a friend (${tag})`);
      await visit(page, '#/outbox', `outbox (${tag})`);
      await visit(page, '#/me', `me (${tag})`);
      await page.context().close();
    });
  }

for (const scheme of ['light', 'dark'] as const)
  test(`kid screens, phone, ${scheme}`, async ({ browser }) => {
    const page = await signIn(browser, 'alex+mia@example.com', 'unicorns are best', phone, scheme);
    const tag = `kid phone ${scheme}`;
    await check(page, `chats (${tag})`);
    for (const hash of ['#/games', '#/learn', '#/calendar', '#/calendar/tasks', '#/calendar/homework', '#/calendar/rewards', '#/people', '#/me']) await visit(page, hash, `${hash} (${tag})`);
    const { me } = await api<{ me: { id: number } }>(page, '/api/me');
    await visit(page, `#/people/${me.id}`, `own page (${tag})`);
    await page.context().close();
  });

test('keyboard: skip link, dialogs and message actions', async ({ browser }) => {
  const page = await signIn(browser, 'alex@example.com', 'kitchen table one', tablet, 'light');
  const focused = () => page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    return { tag: e?.tagName ?? '', text: (e?.getAttribute('aria-label') || e?.textContent || '').trim().slice(0, 40), inDialog: !!e?.closest('dialog[open]') };
  });

  // The first Tab offers a jump past the menu.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  expect((await focused()).text).toMatch(/^Skip/);

  // Every control on the way shows where the focus is.
  const unseen: string[] = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body) return 'none';
      const s = getComputedStyle(e);
      return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 ? 'ring' : s.boxShadow !== 'none' ? 'shadow' : `${e.tagName}.${e.className}`;
    });
    if (ring !== 'ring' && ring !== 'shadow' && ring !== 'none') unseen.push(ring);
  }
  expect(unseen).toEqual([]);

  // A dialog keeps the focus inside it, closes with Escape, and hands the
  // focus back to the button that opened it.
  for (const [hash, opener] of [
    ['#/people', 'Add someone'],
    ['#/calendar/month', 'Linked calendars'],
    ['#/calendar', 'Add an event'],
  ]) {
    await page.evaluate((h) => (window.location.hash = h), hash);
    const button = page.getByRole('button', { name: opener, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    expect((await focused()).inDialog).toBe(true);
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const f = await focused();
      expect(f.inDialog || f.tag === 'BODY', `${opener}: focus went to ${f.tag} ${f.text}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(button).toBeFocused();
  }

  // A message's actions open from the keyboard.
  const { rooms } = await api<{ rooms: { id: number; kind: string }[] }>(page, '/api/rooms');
  await page.evaluate((h) => (window.location.hash = h), `#/chats/${rooms.find((r) => r.kind === 'family')!.id}`);
  const more = page.locator('.msg-more').last();
  await more.focus();
  expect((await more.boundingBox())!.width).toBeGreaterThan(40);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('toolbar', { name: 'Message actions' })).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await page.context().close();
});

test('small phones and large text: nothing runs off the side', async ({ browser }) => {
  // 320 pixels wide is the narrowest phone in use, and the width WCAG asks
  // pages to fit without scrolling sideways. Large text is the Me setting.
  const page = await signIn(browser, 'alex@example.com', 'kitchen table one', { width: 320, height: 640 }, 'light');
  await page.evaluate(() => (document.documentElement.dataset.text = 'large'));
  const { rooms } = await api<{ rooms: { id: number }[] }>(page, '/api/rooms');
  const { games } = await api<{ games: { id: number }[] }>(page, '/api/games');
  const { people } = await api<{ people: { id: number }[] }>(page, '/api/people');
  const hashes = [
    '#/chats',
    ...rooms.slice(0, 3).map((r) => `#/chats/${r.id}`),
    '#/games',
    ...games.map((g) => `#/games/${g.id}`),
    '#/learn',
    '#/calendar',
    '#/calendar/month',
    '#/calendar/tasks',
    '#/calendar/homework',
    '#/calendar/rewards',
    '#/people',
    `#/people/${people[1].id}`,
    '#/outbox',
    '#/me',
  ];
  const spills: string[] = [];
  for (const hash of hashes) {
    await page.evaluate((h) => (window.location.hash = h), hash);
    await page.waitForTimeout(400);
    const spill = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const out: string[] = [];
      if (document.documentElement.scrollWidth > width + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide`);
      for (const e of document.querySelectorAll('button, a, input, select, textarea, h1, h2, p, label')) {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        let clipped = false;
        for (let a = e.parentElement; a && !clipped; a = a.parentElement) {
          const s = getComputedStyle(a);
          clipped = s.overflowX !== 'visible' && s.overflowX !== 'clip' ? a.scrollWidth > a.clientWidth + 1 && a.getBoundingClientRect().right <= width + 1 : false;
        }
        if (!clipped && (r.right > width + 1 || r.left < -1)) out.push(`${e.tagName.toLowerCase()}.${e.className} "${(e.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.left)}-${Math.round(r.right)}`);
      }
      return out.slice(0, 5);
    });
    if (spill.length) spills.push(`${hash}: ${spill.join('; ')}`);
  }
  expect(spills).toEqual([]);
  await page.context().close();
});

// Phones and kids' tablets both ways up, with normal and large
// text: every screen, game and game setup keeps its words inside its boxes.
for (const [sizeName, size, text, who, password] of [
  ['small phone, large text', { width: 320, height: 640 }, 'large', 'alex@example.com', 'kitchen table one'],
  ['phone', phone, 'normal', 'alex@example.com', 'kitchen table one'],
  ['phone, large text, kid', { width: 412, height: 892 }, 'large', 'alex+mia@example.com', 'unicorns are best'],
  ['tablet upright', { width: 800, height: 1280 }, 'normal', 'alex+mia@example.com', 'unicorns are best'],
  ['tablet sideways, large text', { width: 1280, height: 800 }, 'large', 'alex@example.com', 'kitchen table one'],
  ['tablet sideways', { width: 1280, height: 800 }, 'normal', 'alex@example.com', 'kitchen table one'],
] as const)
  test(`words stay inside their boxes: ${sizeName}`, async ({ browser }) => {
    const page = await signIn(browser, who, password, size, 'light');
    await page.evaluate((t) => (document.documentElement.dataset.text = t), text);
    const { rooms } = await api<{ rooms: { id: number }[] }>(page, '/api/rooms');
    const { games } = await api<{ games: { id: number }[] }>(page, '/api/games');
    const { people } = await api<{ people: { id: number }[] }>(page, '/api/people');
    const hashes = [
      '#/chats',
      ...rooms.map((r) => `#/chats/${r.id}`),
      '#/games',
      ...games.map((g) => `#/games/${g.id}`),
      '#/learn',
      '#/calendar',
      '#/calendar/month',
      '#/calendar/tasks',
      '#/calendar/homework',
      '#/calendar/rewards',
      '#/people',
      ...people.map((p) => `#/people/${p.id}`),
      '#/outbox',
      '#/me',
    ];
    const look = async (where: string) => {
      for (const s of await spills(page)) spilt.push({ where: `${where} (${sizeName})`, ...s });
    };
    for (const hash of hashes) {
      await page.evaluate((h) => (window.location.hash = h), hash);
      await page.waitForTimeout(400);
      await look(hash);
    }
    // Learn's other tabs.
    await page.evaluate(() => (window.location.hash = '#/learn'));
    for (const name of ['Signs', 'Practise', 'Characters']) {
      await page.getByRole('radio', { name, exact: true }).click();
      await page.waitForTimeout(200);
      await look(`Learn: ${name}`);
    }
    await page.getByRole('radio', { name: 'Travel', exact: true }).click();
    await page.getByRole('button', { name: 'Lucky cat', exact: true }).click();
    await look('Learn: spot it');
    await page.getByRole('radio', { name: /Bullet trains/ }).click();
    await page.getByRole('button', { name: 'Bullet train quiz' }).click();
    await page.locator('.quiz-choice').first().click();
    await look('Learn: bullet train quiz');
    if (who === 'alex@example.com') {
      await page.getByRole('radio', { name: /Driving/ }).click();
      await page.getByRole('button', { name: 'Take the road test' }).click();
      await page.locator('.quiz-choice').first().click();
      await look('Learn: driving and the road test');
    }
    // The New game list, and every game's setup.
    await page.evaluate(() => (window.location.hash = '#/games'));
    await page.getByRole('button', { name: 'New game' }).click();
    const dialog = page.getByRole('dialog');
    await page.waitForTimeout(300);
    await look('New game');
    const names = await dialog.locator('.game-pick, button[data-game]').allInnerTexts();
    const count = names.length || (await dialog.getByRole('button').count());
    for (let i = 0; i < count; i++) {
      const pick = names.length ? dialog.locator('.game-pick, button[data-game]').nth(i) : dialog.getByRole('button').nth(i);
      const label = (await pick.innerText()).split('\n')[0];
      await pick.click();
      await page.waitForTimeout(300);
      await look(`New game: ${label}`);
      // And each way of playing it: just me, together, or against someone.
      const whos = dialog.locator('.who-pick');
      for (let w = 0; w < (await whos.count()); w++) {
        await whos.nth(w).click();
        await page.waitForTimeout(150);
        await look(`New game: ${label}, ${await whos.nth(w).locator('strong').innerText()}`);
      }
      await dialog.getByRole('button', { name: 'Other games' }).click();
    }
    expect(spilt.filter((s) => s.where.endsWith(`(${sizeName})`))).toEqual([]);
    await page.context().close();
  });

test.afterAll(async () => {
  await fs.mkdir(path.join(import.meta.dirname, '..', 'test-results'), { recursive: true });
  await fs.writeFile(path.join(import.meta.dirname, '..', 'test-results', 'a11y.json'), JSON.stringify(found, null, 2));
  await fs.writeFile(path.join(import.meta.dirname, '..', 'test-results', 'a11y-contrast-unsure.json'), JSON.stringify(unsure, null, 2));
  await fs.writeFile(path.join(import.meta.dirname, '..', 'test-results', 'a11y-contrast.json'), JSON.stringify(contrast, null, 2));
  await fs.writeFile(path.join(import.meta.dirname, '..', 'test-results', 'a11y-spills.json'), JSON.stringify(spilt, null, 2));
});
