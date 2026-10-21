// Learning the games as you play: a "How to play" card for every game, and
// short tips that explain what's on the board at the moment it matters (how
// the piece you picked up moves, what check means) without telling anyone
// what to do. Each tip shows a few times on a device and then stops, so the
// tips fade as the game is learned, and older age bands get fewer of them.
//
// Learn mode goes further, for someone new to a game: the basics step by
// step before playing, every tip each game, and extra help that each game
// adds (the other side's moves explained, letters read aloud). It's switched
// on or off for each game. Everything here is per device.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog, Toggle } from '../components/ui';
import { tipsFor, type Band } from './bands';

export interface GuideSection {
  title: string;
  /** A paragraph, or a list of short points. */
  body: string | string[];
}

/** How many times one tip is shown on a device before it stays quiet. */
const SHOWS = 3;
const ON_KEY = 'tips:on';
const CHANGED = 'family:tips';
/** The key of a hint someone asked for; it shows even with tips off. */
export const HINT = 'hint';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private browsing: tips still work, they just aren't remembered */
  }
}

export function tipsOn(): boolean {
  return read(ON_KEY) !== 'off';
}

export function setTipsOn(on: boolean) {
  write(ON_KEY, on ? null : 'off');
  // Showing tips again starts their counts afresh.
  if (on) {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('tips:') && k !== ON_KEY)
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* nothing remembered to clear */
    }
  }
  window.dispatchEvent(new Event(CHANGED));
}

function useTipsOn(): boolean {
  const [on, setOn] = useState(tipsOn);
  useEffect(() => {
    const update = () => setOn(tipsOn());
    window.addEventListener(CHANGED, update);
    return () => window.removeEventListener(CHANGED, update);
  }, []);
  return on;
}

export interface Tip {
  key: string;
  text: ReactNode;
  /** How a piece moves, what the dice do: left out from 11–13 up, unless learn mode is on. */
  basic?: boolean;
}

/**
 * Tips for one game. `offer` shows a tip unless tips are off, the age band
 * leaves it out, it has already shown in this game, or it has been seen
 * enough times on this device. In learn mode every tip shows once a game,
 * whatever the band and the tips switch say. `show` always shows one, for a
 * hint someone asked for.
 */
export function useTips(game: string, { band = '8-10', learn = false }: { band?: Band; learn?: boolean } = {}) {
  const tipsSwitch = useTipsOn();
  const which = learn ? 'all' : tipsSwitch ? tipsFor(band) : 'none';
  const [tip, setTip] = useState<Tip | null>(null);
  const seen = useRef(new Set<string>());

  /** Shows the first of `tips` that's still worth showing; false if none was. */
  const offer = useCallback(
    (...tips: (Tip | null)[]) => {
      if (which === 'none') return false;
      for (const t of tips) {
        if (!t || seen.current.has(t.key) || (t.basic && which === 'rules')) continue;
        const store = `tips:${game}:${t.key}`;
        const shown = Number(read(store) ?? 0);
        if (shown >= SHOWS && !learn) continue;
        seen.current.add(t.key);
        write(store, String(shown + 1));
        setTip(t);
        return true;
      }
      return false;
    },
    [which, learn, game],
  );

  const show = useCallback((t: Tip) => setTip(t), []);
  const dismiss = useCallback(() => setTip(null), []);

  useEffect(() => {
    if (which === 'none') setTip((t) => (t?.key === HINT ? t : null));
  }, [which]);

  return { tip, offer, show, dismiss };
}

const LEARN = 'family:learn';

export function learnOn(game: string): boolean {
  return read(`learn:${game}`) === 'on';
}

export function setLearnOn(game: string, on: boolean) {
  write(`learn:${game}`, on ? 'on' : null);
  window.dispatchEvent(new Event(LEARN));
}

/** Whether learn mode is on for a game on this device, kept up to date. */
export function useLearn(game: string): boolean {
  const [on, setOn] = useState(() => learnOn(game));
  useEffect(() => {
    const update = () => setOn(learnOn(game));
    update();
    window.addEventListener(LEARN, update);
    return () => window.removeEventListener(LEARN, update);
  }, [game]);
  return on;
}

/** One step of a game's basics. */
export interface Lesson {
  art: string;
  title: string;
  text: string;
}

const DONE = 'learn:done';

/** Games whose basics someone has been through or skipped on this device, newest last. */
function doneWith(): number[] {
  try {
    const ids = JSON.parse(read(DONE) ?? '[]');
    return Array.isArray(ids) ? ids.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

/**
 * Learn mode's card above the board: the game's basics a step at a time,
 * then a small reminder that learn mode is on, to open the basics again or
 * switch it off.
 */
export function Basics({ game, gameId, lessons }: { game: string; gameId: number; lessons: Lesson[] }) {
  const [open, setOpen] = useState(() => !doneWith().includes(gameId));
  const [at, setAt] = useState(0);
  const lesson = lessons[Math.min(at, lessons.length - 1)];
  const last = at >= lessons.length - 1;

  function close() {
    write(DONE, JSON.stringify([...doneWith().filter((id) => id !== gameId), gameId].slice(-40)));
    setOpen(false);
    setAt(0);
  }

  if (!open || !lesson)
    return (
      <div className="learn-bar">
        <span>
          <span aria-hidden="true">🎓</span> Learn mode is on
        </span>
        <span className="row">
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            The basics
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLearnOn(game, false)}>
            Switch off
          </Button>
        </span>
      </div>
    );

  return (
    <section className="basics sheet" aria-labelledby={`basics-${gameId}`} aria-live="polite">
      <p className="basics-step muted">
        🎓 The basics · {at + 1} of {lessons.length}
      </p>
      <div className="basics-body">
        <span className="basics-art" aria-hidden="true">
          {lesson.art}
        </span>
        <div>
          <h2 id={`basics-${gameId}`}>{lesson.title}</h2>
          <p>{lesson.text}</p>
        </div>
      </div>
      <div className="row row-wrap basics-actions">
        {at > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setAt(at - 1)}>
            Back
          </Button>
        )}
        {!last && (
          <Button size="sm" variant="ghost" onClick={close}>
            Skip
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={() => (last ? close() : setAt(at + 1))}>
          {last ? 'Start playing' : 'Next'}
        </Button>
      </div>
    </section>
  );
}

/** The tip on the table: a small paper note under the game's status line. */
export function TipNote({ tip, onClose }: { tip: Tip | null; onClose: () => void }) {
  if (!tip) return null;
  return (
    <div className="tip-note sheet" role="status" key={tip.key}>
      <span className="tip-note-art" aria-hidden="true">
        {tip.key === HINT ? '✨' : '💡'}
      </span>
      <p>{tip.text}</p>
      <Button size="sm" variant="ghost" onClick={onClose}>
        Got it
      </Button>
    </div>
  );
}

/** The game's rules, from the "How to play" button, with the tips and learn mode switches. */
export function HowToPlay({
  game,
  name,
  emoji,
  guide,
  learns,
  open,
  onClose,
}: {
  game: string;
  name: string;
  emoji: string;
  guide: GuideSection[];
  /** Whether the game has a learn mode. */
  learns: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const on = useTipsOn();
  const learning = useLearn(game);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <>
          {emoji} How to play {name}
        </>
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          Back to the game
        </Button>
      }
    >
      <div className="guide">
        {guide.map((s) => (
          <section key={s.title} className="guide-section">
            <h3>{s.title}</h3>
            {typeof s.body === 'string' ? (
              <p>{s.body}</p>
            ) : (
              <ul>
                {s.body.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <hr className="rule" />
        {learns && <LearnToggle game={game} checked={learning} />}
        <Toggle
          label="Tips while playing"
          hint="Short notes that explain what's happening on the board as you play. Each one shows a few times, then stops. Older age groups get fewer."
          checked={on || learning}
          disabled={learning}
          onChange={setTipsOn}
        />
      </div>
    </Dialog>
  );
}

export function LearnToggle({ game, checked }: { game: string; checked: boolean }) {
  return (
    <Toggle
      label="Learn mode"
      hint="Teaches the basics first, then explains as you play. Just on this device."
      checked={checked}
      onChange={(on) => setLearnOn(game, on)}
    />
  );
}
