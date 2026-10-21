// Text contrast, worked out from the colours themselves. axe can't judge text
// on the paper texture (a background image), so this takes the paper's flat
// colour under it, blends any see-through layers and opacity, and measures
// the text against that.

export interface LowContrast {
  text: string;
  selector: string;
  ratio: number;
  needs: number;
  color: string;
  background: string;
  size: string;
}

export function scanContrast(): LowContrast[] {
  type RGBA = [number, number, number, number];
  const ctx = document.createElement('canvas').getContext('2d')!;
  const parse = (c: string): RGBA => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (top: RGBA, under: RGBA): RGBA => {
    const a = top[3] + under[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a) as RGBA;
  };
  const lum = ([r, g, b]: RGBA) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a: RGBA, b: RGBA) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // The colours the text could be sitting on: one, or each stop of a
  // gradient (the texture images are faint and left out).
  const backgrounds = (el: Element): RGBA[] => {
    const layers: RGBA[] = [];
    let base: RGBA[] = [parse(getComputedStyle(document.body).backgroundColor)];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const style = getComputedStyle(e);
      const stops = style.backgroundImage.includes('gradient') ? (style.backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/gi) ?? []) : [];
      if (stops.length) {
        base = stops.map(parse).map((stop) => over(stop, parse(style.backgroundColor)));
        if (base.every((b) => b[3] >= 1)) break;
      }
      const bg = parse(style.backgroundColor);
      if (bg[3] > 0) layers.push(bg);
      if (bg[3] >= 1) {
        base = [];
        break;
      }
    }
    if (!base.length) base = [layers.pop()!];
    return base.map((b) => layers.reduceRight((out, layer) => over(layer, out), b));
  };
  const opacity = (el: Element) => {
    let o = 1;
    for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  };
  const describe = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && parts.length < 3 && e !== document.body; e = e.parentElement)
      parts.unshift(e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''));
    return parts.join(' > ');
  };

  const found: LowContrast[] = [];
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const el = node.parentElement;
    if (!text || !el || seen.has(el)) continue;
    seen.add(el);
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const style = getComputedStyle(el);
    if (style.visibility !== 'visible' || el.closest('[aria-hidden="true"], .sr-only, [inert], canvas, svg')) continue;
    if (el.closest('button:disabled, [aria-disabled="true"], input:disabled')) continue;
    let clipped = false;
    for (let e: Element | null = el; e && !clipped; e = e.parentElement) clipped = getComputedStyle(e).clip === 'rect(0px, 0px, 0px, 0px)';
    if (clipped) continue;
    const fg = parse(style.color);
    fg[3] *= opacity(el);
    const [r, bg, shown] = backgrounds(el)
      .map((b) => [ratio(over(fg, b), b), b, over(fg, b)] as const)
      .sort((a, b) => a[0] - b[0])[0];
    const px = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const needs = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5;
    if (r < needs)
      found.push({
        text: text.slice(0, 50),
        selector: describe(el),
        ratio: Math.round(r * 100) / 100,
        needs,
        color: `rgb(${shown.slice(0, 3).map(Math.round).join(' ')})`,
        background: `rgb(${bg.slice(0, 3).map(Math.round).join(' ')})`,
        size: `${px}px${bold ? ' bold' : ''}`,
      });
  }
  return found;
}
