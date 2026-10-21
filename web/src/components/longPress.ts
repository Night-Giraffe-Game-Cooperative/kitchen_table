import { useRef, type MouseEvent, type PointerEvent } from 'react';

const HOLD_MS = 500;
const SLOP = 10;

/**
 * Press and hold, or right-click (or the keyboard's menu key), on something
 * tappable. A hold doesn't also count as a tap, and a finger that moves to
 * scroll doesn't count as a hold.
 */
export function useLongPress(onHold: () => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const down = useRef(false);
  const held = useRef(false);

  const cancel = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  const hold = () => {
    cancel();
    held.current = true;
    navigator.vibrate?.(15);
    onHold();
  };

  // The tap that ends a hold is swallowed, then taps work again.
  const lift = () => {
    down.current = false;
    cancel();
    if (held.current) window.setTimeout(() => (held.current = false), 300);
  };

  return {
    onPointerDown: (e: PointerEvent) => {
      down.current = true;
      held.current = false;
      // A mouse has its right button for this.
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(hold, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > SLOP) cancel();
    },
    onPointerUp: lift,
    onPointerCancel: lift,
    onPointerLeave: lift,
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      // Android sends this on a hold too, after the timer may have fired.
      if (!held.current) hold();
      // From the keyboard's menu key, nothing follows to swallow.
      if (!down.current) held.current = false;
    },
    onClick: (e: MouseEvent) => {
      if (held.current) e.preventDefault();
    },
  };
}
