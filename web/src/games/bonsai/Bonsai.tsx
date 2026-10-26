// Bonsai: one person's little tree to look after, a few minutes a day. Water
// it when the soil is dry, trim the shoots to make it bushy, feed it now and
// then, and sweep up the autumn leaves. It grows and changes with the real
// seasons, and looking after it unlocks pots and things to put beside it.

import { useEffect, useMemo, useState } from 'react';
import { Field, Input, Toggle } from '../../components/ui';
import type { GameDef, GameProps, OptionsProps } from '../common';
import { nameOf } from '../common';
import { bandOf } from '../bands';
import { HEIGHT, Scene, WIDTH, at, visitorSpot } from './Scene';
import {
  FEED_EVERY,
  POTS,
  TRIM_AT,
  advance,
  age,
  canFeed,
  dayOf,
  feed,
  kindNames,
  kindWords,
  mood,
  nameMeanings,
  needsYou,
  newlyUnlocked,
  nextJob,
  plant,
  potNames,
  setAway,
  setPot,
  shootEnds,
  soilWords,
  suggestedNames,
  sweep,
  toggleExtra,
  trim,
  unlocked,
  unlocks,
  visitorFor,
  visitorHello,
  water,
  type Done,
  type Extra,
  type Job,
  type Kind,
  type Pot,
  type State,
} from './rules';

interface Options {
  kind: Kind;
  name: string;
}

const KINDS: { kind: Kind; emoji: string; blurb: string }[] = [
  { kind: 'maple', emoji: '🍁', blurb: 'Red and orange leaves in autumn' },
  { kind: 'pine', emoji: '🌲', blurb: 'Green all year round' },
  { kind: 'cherry', emoji: '🌸', blurb: 'Pink blossom in spring' },
];

const EXTRAS: Extra[] = ['moss', 'stone', 'giraffe', 'lantern', 'frog'];
const extraNames: Record<Extra, string> = { moss: 'Moss', stone: 'Stone', giraffe: 'Night Giraffe', lantern: 'Lantern', frog: 'Frog' };
const potSwatch: Record<Pot, string> = { blue: '#5b7fa6', clay: '#c0714f', cream: '#e6d9bf', night: '#323a5c' };

/** The time, ticking over once a minute, so the soil dries and night falls while the page is open. */
function useNow(every = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/** What happened since it was last looked after, to say when it's opened. */
function whatsNew(before: State, after: State): string | null {
  if (after.day <= before.day) return null;
  const shoots = after.shoots.filter((x) => x.day > before.day).length;
  const branches = after.twigs.length - before.twigs.length;
  const bits = [
    shoots && (shoots === 1 ? 'a new shoot' : `${shoots} new shoots`),
    branches && (branches === 1 ? 'a new branch' : `${branches} new branches`),
    after.fallen > before.fallen && 'some fallen leaves',
  ].filter(Boolean) as string[];
  if (!bits.length) return null;
  const list = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;
  return `Since you last looked: ${list}.`;
}

function feedHint(s: State, now: number): string {
  const can = canFeed(s, now);
  if (can === 'winter') return 'Resting';
  if (can === 'soon') {
    const days = FEED_EVERY - (dayOf(now) - s.fed!);
    return days === 1 ? 'Tomorrow' : `In ${days} days`;
  }
  return 'Hungry';
}

function Tool({ emoji, label, hint, glow, pressed, onClick, disabled }: { emoji: string; label: string; hint: string; glow?: boolean; pressed?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="bonsai-tool" data-glow={glow || undefined} aria-pressed={pressed} onClick={onClick} disabled={disabled}>
      <span className="bonsai-tool-art" aria-hidden="true">
        {emoji}
      </span>
      <span className="bonsai-tool-label">{label}</span>
      <span className="bonsai-tool-hint">{hint}</span>
    </button>
  );
}

const pct = (p: { x: number; y: number }) => ({ left: `${(p.x / WIDTH) * 100}%`, top: `${(p.y / HEIGHT) * 100}%` });

function Board({ game, play, me, people }: GameProps<State>) {
  const now = useNow();
  const s = useMemo(() => advance(game.state, now), [game.state, now]);
  const mine = game.seats.gardener === me.id && me.permissions.play_games;
  const [news] = useState(() => whatsNew(game.state, advance(game.state, Date.now())));
  const [note, setNote] = useState<string | null>(null);
  const [trimming, setTrimming] = useState(false);
  const [decorating, setDecorating] = useState(false);
  const [pouring, setPouring] = useState(false);
  const [snipped, setSnipped] = useState<{ x: number; y: number } | null>(null);
  const [waved, setWaved] = useState(false);
  const visitor = waved ? null : visitorFor(s, now);
  const job: Job | null = mine ? nextJob(s, now) : null;
  const glow = bandOf(s) !== '14+';
  const long = s.shoots.filter((x) => x.len >= TRIM_AT).length;

  useEffect(() => {
    if (trimming && !s.shoots.length) setTrimming(false);
  }, [trimming, s.shoots.length]);

  /** Does one job on the latest tree, and says how it went. */
  async function act(job: (st: State, t: number) => Done) {
    const t = Date.now();
    let said = '';
    let fresh: string[] = [];
    const ok = await play.move((st) => {
      const done = job(st, t);
      said = done.note;
      if (!done.state) return null;
      fresh = newlyUnlocked(advance(st, t), done.state).map((u) => u.label);
      return { state: done.state };
    });
    if (said) setNote(fresh.length ? `${said} You've unlocked ${fresh.join(' and ').toLowerCase()}! Find it under Decorate.` : said);
    return ok;
  }

  async function pour() {
    setTrimming(false);
    setPouring(true);
    await act(water);
    setTimeout(() => setPouring(false), 1600);
  }

  async function snip(id: number) {
    const sh = s.shoots.find((x) => x.id === id);
    const t = sh && s.twigs.find((x) => x.id === sh.on);
    if (sh && t) {
      const e = shootEnds(t, sh);
      setSnipped(at({ x: (e.x0 + e.x1) / 2, y: (e.y0 + e.y1) / 2 }));
      setTimeout(() => setSnipped(null), 1100);
    }
    await act((st, now) => trim(st, id, now));
  }

  const decorate = (change: (st: State) => State | null) =>
    play.move((st) => {
      const next = change(advance(st, Date.now()));
      return next && { state: next };
    });

  const byId = new Map(s.twigs.map((t) => [t.id, t]));
  const owner = nameOf(people, game.seats.gardener, me.id);
  const label = `${game.title || s.name}: a ${kindWords[s.kind]} bonsai in a ${potNames[s.pot].toLowerCase()}, ${age(s, now).toLowerCase()}. ${mood(s, now)}`;

  return (
    <div className="bonsai">
      <div className="bonsai-scene sheet">
        <div className="bonsai-picture" role="img" aria-label={label}>
          <Scene s={s} now={now} visitor={visitor} pouring={pouring} snipped={snipped} />
        </div>
        {trimming &&
          s.shoots.map((sh) => {
            const t = byId.get(sh.on);
            if (!t) return null;
            const e = shootEnds(t, sh);
            return (
              <button key={sh.id} type="button" className="bonsai-snip-spot" style={pct(at({ x: e.x1, y: e.y1 }))} aria-label="Trim this shoot" onClick={() => snip(sh.id)} disabled={play.busy}>
                <span aria-hidden="true">✂️</span>
              </button>
            );
          })}
        {visitor && (
          <button
            type="button"
            className="bonsai-visitor"
            style={pct(visitorSpot(s, visitor))}
            aria-label={visitor === 'night_giraffe' ? 'Say goodnight to the Night Giraffe' : `Say hello to the ${visitor === 'bird' ? 'little bird' : visitor}`}
            onClick={() => {
              setNote(visitorHello[visitor](s.name));
              setWaved(true);
            }}
          />
        )}
      </div>

      <p className="bonsai-mood" role="status">
        {note ?? (trimming ? 'Tap the scissors on a shoot to trim it.' : (news ?? mood(s, now)))}
      </p>

      {mine ? (
        <>
          <div className="bonsai-tools">
            <Tool emoji="💧" label="Water" hint={soilWords(s.water)} glow={glow && job === 'water'} onClick={pour} disabled={play.busy || !!s.away} />
            <Tool
              emoji="✂️"
              label={trimming ? 'Done' : 'Trim'}
              hint={trimming ? 'Finished trimming' : long ? `${long} to trim` : s.shoots.length ? 'Short shoots' : 'All tidy'}
              glow={glow && job === 'trim' && !trimming}
              pressed={trimming}
              onClick={() => {
                if (!s.shoots.length) return setNote('Nothing to trim just now. New shoots grow in spring and summer.');
                setNote(null);
                setTrimming(!trimming);
              }}
              disabled={!!s.away}
            />
            <Tool emoji="🌱" label="Feed" hint={feedHint(s, now)} glow={glow && job === 'feed'} onClick={() => act(feed)} disabled={play.busy || !!s.away} />
            {s.fallen > 0 && (
              <Tool emoji="🧹" label="Sweep" hint={`${s.fallen} ${s.kind === 'cherry' && new Date(now).getMonth() === 3 ? 'petals' : s.fallen === 1 ? 'leaf' : 'leaves'}`} glow={glow && job === 'sweep'} onClick={() => act(sweep)} disabled={play.busy} />
            )}
            <Tool emoji="🎨" label="Decorate" hint="Pots and things" pressed={decorating} onClick={() => setDecorating(!decorating)} />
          </div>

          {decorating && (
            <section className="bonsai-decorate sheet" aria-labelledby="bonsai-decorate">
              <h2 id="bonsai-decorate">Decorate</h2>
              <p className="muted">
                Looked after on {s.cared} {s.cared === 1 ? 'day' : 'days'}. Each day you look after {s.name} brings new things.
              </p>
              <div className="bonsai-choices" role="radiogroup" aria-label="Pot">
                {POTS.map((p) => {
                  const open = unlocked(s, p);
                  const days = unlocks.find((u) => u.what === p)?.days;
                  return (
                    <button key={p} type="button" role="radio" aria-checked={s.pot === p} className="bonsai-choice" disabled={!open || play.busy} onClick={() => decorate((st) => setPot(st, p))}>
                      <span className="bonsai-swatch" style={{ background: potSwatch[p] }} aria-hidden="true" />
                      <span>{potNames[p]}</span>
                      {!open && <span className="bonsai-locked">After {days} days</span>}
                    </button>
                  );
                })}
              </div>
              <div className="bonsai-choices" role="group" aria-label="Things to put by it">
                {EXTRAS.map((e) => {
                  const open = unlocked(s, e);
                  const u = unlocks.find((x) => x.what === e)!;
                  return (
                    <button key={e} type="button" aria-pressed={s.extras.includes(e)} className="bonsai-choice" disabled={!open || play.busy} onClick={() => decorate((st) => toggleExtra(st, e))}>
                      <span>{open ? extraNames[e] : '🔒 ' + extraNames[e]}</span>
                      {!open && <span className="bonsai-locked">After {u.days} days</span>}
                    </button>
                  );
                })}
              </div>
              <Toggle
                label="Going away?"
                hint={`Someone kind looks after ${s.name} until you're back, so it won't get thirsty.`}
                checked={!!s.away}
                onChange={(away) => decorate((st) => setAway(st, away, Date.now()))}
              />
            </section>
          )}

          <p className="bonsai-facts muted">
            {age(s, now)} · Soil: {soilWords(s.water).toLowerCase()} · {s.fed == null ? 'Not fed yet' : dayOf(now) === s.fed ? 'Fed today' : `Fed ${dayOf(now) - s.fed} ${dayOf(now) - s.fed === 1 ? 'day' : 'days'} ago`}
          </p>
        </>
      ) : (
        <p className="muted center">
          {s.name} is {owner === 'you' ? 'yours' : `${owner}'s`} to look after.
        </p>
      )}
    </div>
  );
}

function Options({ value, onChange }: OptionsProps<Options>) {
  return (
    <>
      <div className="field">
        <span className="field-label">Which tree?</span>
        <div className="bonsai-kinds" role="radiogroup" aria-label="Which tree?">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={value.kind === k.kind}
              className="bonsai-kind"
              onClick={() => onChange({ kind: k.kind, name: !value.name.trim() || value.name === suggestedNames[value.kind] ? suggestedNames[k.kind] : value.name })}
            >
              <span className="bonsai-kind-art" aria-hidden="true">
                {k.emoji}
              </span>
              <strong>{kindNames[k.kind]}</strong>
              <span className="muted">{k.blurb}</span>
            </button>
          ))}
        </div>
      </div>
      <Field label="Its name" hint={nameMeanings[value.kind]}>
        {(p) => <Input {...p} value={value.name} maxLength={30} onChange={(e) => onChange({ ...value, name: e.target.value })} />}
      </Field>
    </>
  );
}

export const bonsai: GameDef<State, Options> = {
  type: 'bonsai',
  name: 'Bonsai',
  emoji: '🪴',
  blurb: 'Grow your own little tree, a few minutes a day. Water it, trim it, and watch it change with the seasons.',
  modes: ['coop'],
  modeLabels: { coop: 'Just you' },
  players: '1 player, a little every day',
  solo: true,
  defaults: () => ({ kind: 'maple', name: suggestedNames.maple }),
  Options,
  ready: (o) => o.name.trim().length > 0,
  create: (o, { me }) => {
    const name = o.name.trim().slice(0, 30) || suggestedNames[o.kind];
    return {
      mode: 'coop',
      seats: { gardener: me.id },
      state: plant(o.kind, name, Date.now(), Math.floor(Math.random() * 2 ** 31)),
      title: `${name} the ${kindWords[o.kind]}`,
    };
  },
  bands: {
    '5-7': 'Dries out slowly, and the next job always glows.',
    '8-10': 'Needs a drink every few days, and the next job glows.',
    '11-13': 'Dries out like a real bonsai. The next job still glows.',
    '14+': 'Like a real bonsai, with no glowing hints: check the soil yourself.',
  },
  Board,
  guide: [
    { title: 'The aim', body: "There's no winning or losing: it's your tree to look after. Pop in every day or two, and it grows a little each night." },
    {
      title: 'Looking after it',
      body: [
        'Water it when the soil looks pale and dry. Too much water is bad for the roots, so it says when it has had enough.',
        'Trim the long new shoots. Each trim makes that part of the tree bushier, which is the art of bonsai.',
        "Feed it once a fortnight in spring, summer and autumn. It doesn't eat in winter.",
        'In autumn the leaves fall: sweep them up.',
      ],
    },
    {
      title: 'The seasons',
      body: 'It follows the real seasons. A maple turns red in autumn and sleeps without its leaves in winter, a cherry blossoms in spring, and a pine stays green all year.',
    },
    {
      title: 'Visitors and things to unlock',
      body: "Look out for ladybirds, butterflies and birds, and on some nights the Night Giraffe. Every day you look after your tree unlocks new pots and little things to put by it. Going on holiday? Switch on Going away under Decorate and someone kind will look after it.",
    },
  ],
  status: (g, me) => {
    if (g.status === 'finished') return g.summary || 'Put away';
    const now = Date.now();
    const s = advance(g.state, now);
    return g.seats.gardener === me ? mood(s, now) : `${s.name} the ${kindWords[s.kind]}`;
  },
  waitingOn: (g, me) => g.status === 'active' && g.seats.gardener === me && needsYou(advance(g.state, Date.now())),
};
