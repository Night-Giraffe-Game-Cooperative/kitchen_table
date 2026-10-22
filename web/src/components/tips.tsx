// What a button does, in a little paper label, for anything marked with
// data-tip (every icon-only button is). It shows on hover with a mouse, on
// keyboard focus, and on a tablet or phone when the button is pressed and
// held, since there's no hover there. A hold shows the label instead of
// pressing the button. Escape hides it.
//
// InfoTip is the other half: a small (i) beside an idea that needs a sentence
// of explaining, which opens a note when tapped.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const HOVER_MS = 350;
const HOLD_MS = 450;
const GAP = 8;

/** Places a bubble above `anchor` (below if there's no room), kept inside the window. */
function place(bubble: HTMLElement, anchor: DOMRect) {
  const b = bubble.getBoundingClientRect();
  const left = Math.min(Math.max(GAP, anchor.left + anchor.width / 2 - b.width / 2), window.innerWidth - b.width - GAP);
  const above = anchor.top - b.height - GAP;
  const top = above >= GAP ? above : anchor.bottom + GAP;
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;
  bubble.dataset.side = above >= GAP ? 'above' : 'below';
}

/**
 * Where a bubble goes: inside an open dialog when its button is in one, since
 * a dialog sits above everything else on the page, and otherwise the page.
 */
const layerOf = (anchor: Element | null): Element => anchor?.closest('dialog[open]') ?? document.body;

const tipOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null);

/** Mounted once: the label bubble for everything with data-tip. */
export function TipLayer() {
  const [tip, setTip] = useState<{ text: string; anchor: HTMLElement } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: number | undefined;
    // Hides a label a little while after a hold ends; kept apart so it can't cancel the next hold.
    let later: number | undefined;
    let shown: HTMLElement | null = null;
    // A button whose label came up from a hold: the tap that ends the hold doesn't press it.
    let held: HTMLElement | null = null;
    let start: { x: number; y: number } | null = null;
    // Whether the last press was a finger, not a mouse: only then is a long press a request for the label.
    let touch = false;

    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text || !el.isConnected) return;
      window.clearTimeout(later);
      shown = el;
      setTip({ text, anchor: el });
    };
    const hide = () => {
      window.clearTimeout(timer);
      shown = null;
      setTip(null);
    };

    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = tipOf(e.target);
      if (!el || el === shown) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => show(el), shown ? 0 : HOVER_MS);
    };
    const out = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const to = e.relatedTarget as Node | null;
      // Moving onto the label itself keeps it up, so it can be read.
      if (to && (bubble.current?.contains(to) || (shown && shown.contains(to)))) return;
      if (tipOf(e.target)) hide();
    };
    const down = (e: PointerEvent) => {
      window.clearTimeout(later);
      held = null;
      touch = e.pointerType !== 'mouse';
      if (!touch) return hide();
      const el = tipOf(e.target);
      if (!el) return hide();
      start = { x: e.clientX, y: e.clientY };
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        held = el;
        show(el);
      }, HOLD_MS);
    };
    const move = (e: PointerEvent) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
        window.clearTimeout(timer);
        start = null;
      }
    };
    const up = () => {
      start = null;
      if (!held) window.clearTimeout(timer);
      else later = window.setTimeout(hide, 1800);
    };
    const click = (e: MouseEvent) => {
      if (held && e.target instanceof Node && held.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
      held = null;
    };
    const menu = (e: Event) => {
      if (touch && (held || tipOf(e.target))) e.preventDefault();
    };
    const focus = (e: FocusEvent) => {
      const el = tipOf(e.target);
      if (el && el === e.target && el.matches(':focus-visible')) show(el);
    };
    const blur = (e: FocusEvent) => {
      if (shown && e.target === shown) hide();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && shown) hide();
    };

    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('click', click, true);
    document.addEventListener('contextmenu', menu, true);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(later);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('contextmenu', menu, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  useEffect(() => {
    if (tip && bubble.current) place(bubble.current, tip.anchor.getBoundingClientRect());
  }, [tip]);

  if (!tip) return null;
  // The button already says this to screen readers, so the bubble is only for the eyes.
  return createPortal(
    <div ref={bubble} className="tip-bubble" aria-hidden="true" onPointerLeave={() => setTip(null)}>
      {tip.text}
    </div>,
    layerOf(tip.anchor),
  );
}

/**
 * A small (i) beside an idea that needs explaining, like "Waiting for your
 * yes". Tapping it opens a note; tapping again, tapping elsewhere or Escape
 * closes it.
 */
export function InfoTip({ about, children }: { about: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const note = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (note.current && button.current) place(note.current, button.current.getBoundingClientRect());
    const away = (e: PointerEvent) => {
      if (!button.current?.contains(e.target as Node) && !note.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="info-tip"
        aria-label={`About ${about}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {/* Read out when it opens; the note on screen is the same words. */}
      <span className="sr-only" role="status">
        {open ? children : ''}
      </span>
      {open &&
        createPortal(
          <div ref={note} className="tip-bubble info-note" aria-hidden="true">
            {children}
          </div>,
          layerOf(button.current),
        )}
    </>
  );
}
