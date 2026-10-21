// Learning the games as you play: a "How to play" card for every game, and
// short tips that explain what's on the board at the moment it matters (how
// the piece you picked up moves, what check means) without telling anyone
// what to do. Each tip shows a few times on a device and then stops, so the
// tips fade as the game is learned. Everything here is per device.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog, Toggle } from '../components/ui';

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
}

/**
 * Tips for one game. `offer` shows a tip unless tips are off, it has already
 * shown in this game, or it has been seen enough times on this device. `show`
 * always shows one, for a hint someone asked for.
 */
export function useTips(game: string) {
  const on = useTipsOn();
  const [tip, setTip] = useState<Tip | null>(null);
  const seen = useRef(new Set<string>());

  /** Shows the first of `tips` that's still worth showing; false if none was. */
  const offer = useCallback(
    (...tips: (Tip | null)[]) => {
      if (!on) return false;
      for (const t of tips) {
        if (!t || seen.current.has(t.key)) continue;
        const store = `tips:${game}:${t.key}`;
        const shown = Number(read(store) ?? 0);
        if (shown >= SHOWS) continue;
        seen.current.add(t.key);
        write(store, String(shown + 1));
        setTip(t);
        return true;
      }
      return false;
    },
    [on, game],
  );

  const show = useCallback((t: Tip) => setTip(t), []);
  const dismiss = useCallback(() => setTip(null), []);

  useEffect(() => {
    if (!on) setTip((t) => (t?.key === HINT ? t : null));
  }, [on]);

  return { tip, offer, show, dismiss };
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

/** The game's rules, from the "How to play" button, with the tips switch. */
export function HowToPlay({ name, emoji, guide, open, onClose }: { name: string; emoji: string; guide: GuideSection[]; open: boolean; onClose: () => void }) {
  const on = useTipsOn();
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
        <Toggle
          label="Tips while playing"
          hint="Short notes that explain what's happening on the board as you play. Each one shows a few times, then stops."
          checked={on}
          onChange={setTipsOn}
        />
      </div>
    </Dialog>
  );
}
