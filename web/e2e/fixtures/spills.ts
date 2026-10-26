import type { Page } from '@playwright/test';

/** A piece of text that runs outside the box it's in. */
export interface Spill {
  box: string;
  text: string;
  /** How far it runs out, in pixels, and which way. */
  by: string;
}

/**
 * Finds text that runs out of its box: a button, a card, a bubble, anything
 * with a background, a border or hidden overflow. Text a box scrolls, cuts
 * short with an ellipsis on purpose, or hides for screen readers is fine.
 */
export function spills(page: Page): Promise<Spill[]> {
  return page.evaluate(async () => {
    // A celebration may hop out of its card for a moment; look once it's landed.
    const moving = document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.race([Promise.allSettled(moving.map((a) => a.finished)), new Promise((done) => setTimeout(done, 2000))]);
    const out: Spill[] = [];
    const seen = new Set<Element>();
    const clear = (c: string) => c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
    const boxOf = new Map<Element, boolean>();
    const isBox = (e: Element) => {
      let yes = boxOf.get(e);
      if (yes !== undefined) return yes;
      const s = getComputedStyle(e);
      const border = (['Top', 'Right', 'Bottom', 'Left'] as const).some(
        (side) => parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none' && !clear(s[`border${side}Color`]),
      );
      yes =
        s.display !== 'inline' &&
        s.display !== 'contents' &&
        (!clear(s.backgroundColor) || s.backgroundImage !== 'none' || border || s.overflowX !== 'visible' || s.overflowY !== 'visible');
      boxOf.set(e, yes);
      return yes;
    };
    const name = (e: Element) => {
      const label = e.getAttribute('aria-label') ?? (e.textContent ?? '').trim();
      const cls = typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).join('.')}` : '';
      return `${e.tagName.toLowerCase()}${cls} "${label.replace(/\s+/g, ' ').slice(0, 40)}"`;
    };

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      const el = node.parentElement;
      if (!text || !el || el.closest('svg, script, style, select, textarea, .sr-only, [hidden]')) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!lines.length) continue;

      let box: Element | null = el;
      while (box && box !== document.body && !isBox(box)) box = box.parentElement;
      if (!box || box === document.body || seen.has(box)) continue;
      const s = getComputedStyle(box);
      // Cut short with "…" on purpose.
      if (getComputedStyle(el).textOverflow === 'ellipsis' || s.textOverflow === 'ellipsis') continue;
      const r = box.getBoundingClientRect();
      // Squeezed to a pixel to hide it from sight but not from screen readers.
      if (r.width <= 2 || r.height <= 2) continue;
      const scrollsX = s.overflowX === 'auto' || s.overflowX === 'scroll';
      const scrollsY = s.overflowY === 'auto' || s.overflowY === 'scroll';
      const left = r.left + parseFloat(s.borderLeftWidth);
      const right = r.right - parseFloat(s.borderRightWidth);
      const top = r.top + parseFloat(s.borderTopWidth);
      const bottom = r.bottom - parseFloat(s.borderBottomWidth);
      const ways: string[] = [];
      const x = Math.max(...lines.map((l) => l.right)) - right;
      const x0 = left - Math.min(...lines.map((l) => l.left));
      // A line's box is a little taller than its letters, so allow a few pixels up and down.
      const y = Math.max(...lines.map((l) => l.bottom)) - bottom;
      const y0 = top - Math.min(...lines.map((l) => l.top));
      if (!scrollsX && x > 1) ways.push(`${Math.round(x)}px right`);
      if (!scrollsX && x0 > 1) ways.push(`${Math.round(x0)}px left`);
      if (!scrollsY && y > 4) ways.push(`${Math.round(y)}px below`);
      if (!scrollsY && y0 > 4) ways.push(`${Math.round(y0)}px above`);
      if (ways.length) {
        seen.add(box);
        out.push({ box: name(box), text: text.slice(0, 40), by: ways.join(', ') });
      }
    }
    return out;
  });
}
