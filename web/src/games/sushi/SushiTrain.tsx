// Sushi Train: everyone in the chat runs a sushi bar together. Customers
// order at the counter, each person makes dishes at their own station, and
// plates go down the belt to whoever ordered them. The rules are in rules.ts.

import { useEffect, useRef, useState } from 'react';
import { confirmFirst } from '../../components/confirm';
import { Button } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { GameDef, GameProps } from '../common';
import { listNames, nameOf, startGame } from '../common';
import { bandOf } from '../bands';
import { BoardArt, DishArt, IngredientArt } from './Food';
import {
  DINERS,
  PLATE_HOLDS,
  SIDES,
  canRoll,
  close,
  dishJapanese,
  dishName,
  ingredientNames,
  menuFor,
  newGame,
  nextStep,
  orderWords,
  roll,
  send,
  summary,
  tap,
  type Board as Making,
  type Dish,
  type Ingredient,
  type Sent,
  type State,
  type Topping,
} from './rules';

const TYPE = 'sushi_train';

/** How many people in the chat can play, which sets how many customers sit down. */
const playersIn = (ids: number[], people: Map<number, { permissions?: { play_games?: boolean } }>) =>
  ids.filter((id) => people.get(id)?.permissions?.play_games !== false).length;

function Stars({ n }: { n: number }) {
  return (
    <span className="sushi-stars" aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}>
      {'⭐'.repeat(n)}
    </span>
  );
}

function Board({ game, play, me, people, room }: GameProps<State>) {
  const { toast } = useStore();
  const s = game.state;
  const band = bandOf(s);
  const done = game.status === 'finished' || !!s.ended;
  const canPlay = me.permissions.play_games && !done;
  const [board, setBoard] = useState<Making>(null);
  const [plate, setPlate] = useState<Dish[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [making, setMaking] = useState<number | null>(null);
  const [arriving, setArriving] = useState<Sent[]>([]);
  const [welcome, setWelcome] = useState(false);
  const [again, setAgain] = useState(false);
  const seen = useRef<Set<number> | null>(null);
  const wave = useRef(s.wave);

  // Plates someone has just sent slide along the belt to their customer.
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(s.log.map((l) => l.id));
      return;
    }
    const fresh = s.log.filter((l) => !seen.current!.has(l.id));
    if (!fresh.length) return;
    fresh.forEach((l) => seen.current!.add(l.id));
    setArriving((a) => [...a, ...fresh.filter((l) => l.to !== null)]);
    setTimeout(() => setArriving((a) => a.filter((x) => !fresh.includes(x))), 1700);
  }, [s.log]);

  // New customers: the chefs shout a welcome, as they do in Japan.
  useEffect(() => {
    if (s.wave === wave.current) return;
    wave.current = s.wave;
    setMaking(null);
    setWelcome(true);
    const t = setTimeout(() => setWelcome(false), 2400);
    return () => clearTimeout(t);
  }, [s.wave]);

  useEffect(() => {
    if (making != null && s.diners[making]?.served) setMaking(null);
  }, [making, s.diners]);

  const { toppings, fillings } = menuFor(band);
  const shelf: Ingredient[] = ['rice', 'nori', ...new Set<Topping>([...toppings, ...fillings])];
  const target = making != null ? s.diners[making] : undefined;
  const step = target && !target.served && band !== '14+' ? nextStep(target.order, plate, board) : null;
  const full = plate.length >= PLATE_HOLDS;

  function add(i: Ingredient) {
    if (full) return setNote('The plate is full. Send it down the belt!');
    const r = tap(board, i);
    setBoard(r.board);
    setNote(r.note ?? null);
    if (r.made) setPlate((p) => [...p, r.made!]);
  }

  function rollIt() {
    const d = roll(board);
    if (!d) return;
    if (full) return setNote('The plate is full. Send it down the belt!');
    setPlate((p) => [...p, d]);
    setBoard(null);
    setNote(null);
  }

  async function sendPlate() {
    const dishes = plate;
    let who: string | null = null;
    const ok = await play.move((st) => {
      const r = send(st, dishes, me.id, Date.now());
      if (!r) return null;
      who = r.to === null ? null : DINERS[st.diners[r.to].who].name;
      return r.state.ended ? { state: r.state, status: 'finished', summary: summary(r.state) } : { state: r.state };
    });
    if (!ok) return;
    setPlate([]);
    setNote(who ? `${who} says arigatō! (thank you)` : "Nobody's ordered that yet, so it's going round the belt for later.");
  }

  async function closeUp() {
    if (!(await confirmFirst('Close the sushi bar for today?', 'Close it', 'It ends the game for everyone.'))) return;
    await play.move((st) => {
      const next = close(st);
      return next && { state: next, status: 'finished', summary: summary(next) };
    });
  }

  async function playAgain() {
    setAgain(true);
    try {
      await startGame(game, TYPE, { mode: 'coop', seats: {}, state: newGame(Math.floor(Math.random() * 2 ** 31), s.size - 1, Date.now(), s.band) });
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setAgain(false);
    }
  }

  const chefs = [...new Set(s.log.map((l) => l.by))];
  const totalStars = s.stars.reduce((a, b) => a + b, 0);

  if (done) {
    return (
      <div className="sushi">
        <div className="sushi-end sheet" role="status">
          <p className="sushi-end-art" aria-hidden="true">
            🍣
          </p>
          <h2>{s.ended === 'closed' ? 'The sushi bar is closed' : 'Closing time!'}</h2>
          <p>{summary(s)}.</p>
          {s.stars.length > 0 && (
            <ol className="sushi-waves">
              {s.stars.map((n, i) => (
                <li key={i}>
                  Wave {i + 1}: <Stars n={n} />
                </li>
              ))}
            </ol>
          )}
          {chefs.length > 0 && <p className="muted">Chefs: {listNames(chefs.map((id) => nameOf(people, id, me.id)))}.</p>}
          {me.permissions.start_games && (
            <Button variant="primary" icon="refresh" busy={again} onClick={playAgain}>
              Play again
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sushi">
      <div className="sushi-bar sheet">
        {welcome && (
          <p className="sushi-welcome" aria-hidden="true">
            Irasshaimase! <span>(Welcome!)</span>
          </p>
        )}
        <ol className="sushi-diners" style={{ ['--seats' as string]: s.diners.length }} aria-label="Customers">
          {s.diners.map((d, i) => {
            const a = DINERS[d.who];
            return (
              <li key={`${s.wave}-${i}`}>
                <button
                  type="button"
                  className="sushi-diner"
                  data-served={d.served ? true : undefined}
                  aria-pressed={making === i}
                  disabled={!!d.served || !canPlay}
                  aria-label={d.served ? `${a.name} has their food` : `${a.name} would like ${orderWords(d.order).toLowerCase()}. Make this.`}
                  onClick={() => (setMaking(making === i ? null : i), setNote(null))}
                >
                  <span className="sushi-bubble">
                    {d.served ? (
                      <span className="sushi-yum">Arigatō!</span>
                    ) : (
                      d.order.map((dish, k) => <DishArt key={k} dish={dish} size={34} />)
                    )}
                  </span>
                  <span className="sushi-animal" aria-hidden="true">
                    {d.served ? '😋' : a.emoji}
                  </span>
                  <span className="sushi-diner-name">{a.name}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="sushi-belt" aria-hidden="true">
          {s.spares.map((p, i) => (
            <span key={p.id} className="sushi-plate sushi-going-round" style={{ animationDelay: `${-i * 2.4}s` }} data-colour={people.get(p.by)?.colour}>
              {p.dishes.map((d, k) => (
                <DishArt key={k} dish={d} size={26} />
              ))}
            </span>
          ))}
          {arriving.map((p) => (
            <span key={p.id} className="sushi-plate sushi-arriving" style={{ ['--to' as string]: `${((p.to! + 0.5) / s.diners.length) * 100}%` }} data-colour={people.get(p.by)?.colour}>
              {p.dishes.map((d, k) => (
                <DishArt key={k} dish={d} size={26} />
              ))}
            </span>
          ))}
        </div>
      </div>

      <p className="sushi-score">
        Wave {s.wave + 1} of {s.waves} · {s.served} served {totalStars > 0 && <Stars n={totalStars} />}
      </p>

      {canPlay ? (
        <section className="sushi-station sheet" aria-label="Your station">
          <p className="sushi-note" role="status">
            {note ??
              (target && !target.served
                ? `Making for ${DINERS[target.who].name}: ${orderWords(target.order).toLowerCase()}.`
                : 'Tap a customer to see how to make their order, or make anything you like.')}
          </p>
          {target && !target.served && (
            <ul className="sushi-recipe">
              {target.order.map((d, i) => (
                <li key={i}>
                  <DishArt dish={d} size={28} />
                  <span>
                    {dishName(d)} <span className="muted" lang="ja-Latn">({dishJapanese(d)})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="sushi-work">
            <div className="sushi-board" aria-label="Chopping board" role="group">
              {board ? <BoardArt board={board} /> : <span className="muted">Empty</span>}
              {board && (
                <span className="sr-only">
                  {board.base === 'rice' ? 'Rice, ready for a topping' : `Seaweed${board.rice ? ' with rice' : ''}${board.fill.length ? `, ${board.fill.join(' and ')}` : ''}`}
                </span>
              )}
            </div>
            <div className="sushi-plate-now" role="group" aria-label="Your plate">
              {plate.length ? (
                plate.map((d, i) => (
                  <button key={i} type="button" className="sushi-on-plate" aria-label={`Take the ${dishName(d).toLowerCase()} off the plate`} onClick={() => setPlate((p) => p.filter((_, k) => k !== i))}>
                    <DishArt dish={d} size={42} />
                  </button>
                ))
              ) : (
                <span className="muted">Plate</span>
              )}
            </div>
          </div>

          <div className="sushi-shelf" role="group" aria-label="Ingredients">
            {[...shelf, ...SIDES].map((i) => (
              <button key={i} type="button" className="sushi-ingredient" data-glow={step === i || undefined} onClick={() => add(i)}>
                <IngredientArt what={i} />
                <span>{ingredientNames[i]}</span>
              </button>
            ))}
          </div>

          <div className="sushi-actions">
            <Button variant="ghost" icon="trash" disabled={!board} onClick={() => (setBoard(null), setNote(null))} className={step === 'bin' ? 'sushi-glow' : undefined}>
              Bin it
            </Button>
            <Button disabled={!canRoll(board)} onClick={rollIt} className={step === 'roll' ? 'sushi-glow' : undefined}>
              🍥 Roll it
            </Button>
            <Button variant="primary" icon="send" busy={play.busy} disabled={!plate.length} onClick={sendPlate} className={step === 'send' ? 'sushi-glow' : undefined}>
              Send down the belt
            </Button>
          </div>
        </section>
      ) : (
        <p className="muted center">Games are switched off for you just now, but you can watch.</p>
      )}

      {canPlay && room && (
        <div className="row row-end">
          <Button size="sm" variant="ghost" onClick={closeUp}>
            Close the sushi bar
          </Button>
        </div>
      )}
    </div>
  );
}

export const sushiTrain: GameDef<State, Record<string, never>> = {
  type: TYPE,
  name: 'Sushi Train',
  emoji: '🍣',
  blurb: 'Run a sushi bar together: make what the customers order and send it down the belt. Each wave orders something trickier.',
  modes: ['coop'],
  players: '1 or more, all at once',
  defaults: () => ({}),
  create: (_o, { room, band, people }) => ({
    mode: 'coop',
    seats: {},
    state: newGame(Math.floor(Math.random() * 2 ** 31), Math.max(1, playersIn(room.member_ids, people) - 1), Date.now(), band),
  }),
  bands: {
    '5-7': 'Four waves, three toppings, and the next thing to tap glows.',
    '8-10': 'Five waves, with tuna and prawn too, and the next thing to tap glows.',
    '11-13': 'Six waves, the whole menu, and rolls with two fillings.',
    '14+': 'Six waves of the whole menu, and no glowing hints.',
  },
  Board,
  guide: [
    {
      title: 'The aim',
      body: "Customers sit at the counter and show what they'd like. Make it, put it on your plate and send it down the belt. When everyone's eaten, the next customers come in, a bit hungrier. Quick waves earn more stars.",
    },
    {
      title: 'Making sushi',
      body: [
        'Nigiri: tap Rice, then a topping, like salmon.',
        'A roll (maki): tap Seaweed, then Rice, then one or two fillings, then Roll it.',
        'Miso soup and edamame beans are ready with one tap.',
        'Tap a customer to see their order, and what to tap next glows.',
      ],
    },
    {
      title: 'Together',
      body: "Everyone has their own station and can send plates at the same time. Say who's making what! A plate nobody ordered goes round the belt, and a customer who wants it later gets it straight away.",
    },
    {
      title: 'Japanese at the sushi bar',
      body: 'Irasshaimase means welcome, arigatō means thank you, sāmon is salmon, maguro is tuna, tamago is egg, ebi is prawn, and a cucumber roll is kappa maki.',
    },
  ],
  status: (g) => {
    if (g.status === 'finished') return g.summary || 'Closed';
    const s = g.state;
    return `Wave ${s.wave + 1} of ${s.waves} · ${s.served} served`;
  },
};
