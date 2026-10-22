import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { KRAFT, crayons, lineWidth, papers, rng, shapeIconPath, shapes, sizes, stickers, tearWidth, type LineTool, type PaperFinish } from '../lib/doodle';
import type { Tool, ToolKind } from './DoodleBoard';
import { IconButton } from './ui';

// The craft table: pens standing in a tray, paper to tear and cut, stickers,
// a fan of paper colours, and the choices for whichever tool is in hand.

const PENS: { kind: ToolKind; label: string }[] = [
  { kind: 'felt', label: 'Felt tip' },
  { kind: 'brush', label: 'Paintbrush' },
  { kind: 'pencil', label: 'Pencil' },
  { kind: 'pen', label: 'Wax crayon' },
  { kind: 'marker', label: 'Highlighter' },
  { kind: 'erase', label: 'Rubber' },
];

const PAPER_TOOLS: { kind: ToolKind; label: string }[] = [
  { kind: 'tear', label: 'Torn paper' },
  { kind: 'shape', label: 'Cut-out shapes' },
  { kind: 'sticker', label: 'Stickers' },
];

const LABELS = Object.fromEntries([...PENS, ...PAPER_TOOLS].map((t) => [t.kind, t.label])) as Record<ToolKind, string>;

const lightness = (hex: string) => {
  const v = parseInt(hex.slice(1), 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
};

/** Little irregular cut squares, one per colour, so the swatches look snipped from paper. */
const chipCuts = crayons.map((_, i) => {
  const R = rng(4242 + i * 97);
  const j = () => (R() - 0.5) * 7;
  const pts = [
    [3 + j(), 4 + j()],
    [50 + j(), 2 + j()],
    [97 + j(), 5 + j()],
    [98 + j(), 50 + j()],
    [96 + j(), 97 + j()],
    [50 + j(), 98 + j()],
    [3 + j(), 96 + j()],
    [2 + j(), 50 + j()],
  ];
  return { clip: `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}% ${y.toFixed(1)}%`).join(',')})`, tilt: `${((R() - 0.5) * 10).toFixed(1)}deg` };
});

/** Arrow keys move along a radio group and choose as they go; Home and End jump to the ends. */
function onArrows(e: KeyboardEvent<HTMLElement>) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!step && e.key !== 'Home' && e.key !== 'End') return;
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const at = radios.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? radios.length - 1 : (at + step + radios.length) % radios.length;
  radios[next].focus();
  radios[next].click();
}

/**
 * A scrolling row that fades only at the edges with more beyond them, and
 * that opens with its chosen item in view. Used as a ref callback.
 */
function scrollRow(el: HTMLElement | null) {
  if (!el) return;
  const update = () => {
    const start = el.scrollLeft > 2;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    el.dataset.fade = start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
  };
  const chosen = el.querySelector<HTMLElement>('[aria-checked="true"]');
  if (chosen && el.scrollWidth > el.clientWidth) {
    el.scrollLeft = chosen.offsetLeft + chosen.offsetWidth / 2 - el.clientWidth / 2;
  }
  update();
  el.addEventListener('scroll', update, { passive: true });
  const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  watch?.observe(el);
  for (const child of Array.from(el.children)) watch?.observe(child);
  return () => {
    el.removeEventListener('scroll', update);
    watch?.disconnect();
  };
}

function Radios({
  label,
  className,
  row,
  children,
}: {
  label: string;
  className?: string;
  row?: boolean;
  children: ReactNode;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={className} onKeyDown={onArrows} ref={row ? scrollRow : undefined}>
      {children}
    </div>
  );
}

function Radio({
  checked,
  tabbable,
  label,
  className,
  style,
  onSelect,
  children,
}: {
  checked: boolean;
  tabbable: boolean;
  label: string;
  className: string;
  style?: CSSProperties;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      data-tip={label}
      tabIndex={checked || tabbable ? 0 : -1}
      className={className}
      style={style}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

const INK = '#2a2420';

/** The pens and paper, drawn in a 40 × 80 box, standing up with their tips at the top. */
function ToolArt({ kind, colour, sticker, ids }: { kind: ToolKind; colour: string; sticker: string; ids: string }) {
  const shade = `url(#${ids}-shade)`;
  const metal = `url(#${ids}-metal)`;
  const wood = `url(#${ids}-wood)`;
  const line = { stroke: INK, strokeWidth: 1.4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const pale = lightness(colour) > 0.85;
  const gloss = { stroke: '#fff', strokeOpacity: pale ? 0.3 : 0.6, strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' as const };
  switch (kind) {
    case 'felt':
      return (
        <svg viewBox="0 0 40 80" aria-hidden="true" focusable="false">
          <path d="M8.5 34q0-6.5 6.5-6.5h10q6.5 0 6.5 6.5v46h-23z" fill="#f5f1e8" />
          <path d="M8.5 60h23v20h-23z" fill={colour} />
          <path d="M8.5 37.5h23v4h-23z" fill={colour} />
          <path d="M8.5 34q0-6.5 6.5-6.5h10q6.5 0 6.5 6.5v46h-23z" fill={shade} {...line} />
          <path d="M12.4 27.5 16 15.6h8l3.6 11.9z" fill="#dcd5c6" {...line} />
          <path d="M16.3 16V9.8q0-5.6 3.7-5.6t3.7 5.6V16z" fill={colour} {...line} />
          <path d="M18.3 10q.4-2.6 1.9-3" {...gloss} />
          <path d="M12 47v10" {...gloss} strokeOpacity={0.7} />
        </svg>
      );
    case 'brush':
      return (
        <svg viewBox="0 0 40 80" aria-hidden="true" focusable="false">
          <path d="M15.4 41h9.2l2.2 39H13.2z" fill={wood} {...line} />
          <path d="M13 25.5h14l-1 16.5H14z" fill={metal} {...line} />
          <path d="M14 35.5h12M14.2 38.4h11.6" stroke={INK} strokeOpacity="0.4" strokeWidth="1" />
          <path d="M13.1 26.2C10.8 18 15 9.2 20 2c5 7.2 9.2 16 6.9 24.2z" fill="#dcc196" {...line} />
          <path d="M12.6 18.4C13.5 12.6 16.3 7.6 20 2c3.7 5.6 6.5 10.6 7.4 16.4-4.9 2.1-9.9 2.1-14.8 0z" fill={colour} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M18.2 8.2q-1.2 3.4-1.4 7.4M21.8 7.4q.8 4 .3 7.8" stroke={pale ? INK : '#fff'} strokeOpacity="0.4" strokeWidth="1" fill="none" strokeLinecap="round" />
          <path d="M17.5 47v26" {...gloss} strokeOpacity={0.45} />
        </svg>
      );
    case 'pencil': {
      const lead = lightness(colour) < 0.22 ? '#4b4c53' : colour;
      return (
        <svg viewBox="0 0 40 80" aria-hidden="true" focusable="false">
          <path d="M10 30 20 5l10 25z" fill="#efcf9f" {...line} />
          <path d="M10 30q2.3-3.6 5-.1 2.5-3.6 5 0 2.5-3.6 5 0 2.7-3.5 5 .1V80H10z" fill={colour} />
          <path d="M10 30h5v50h-5z" fill="#000" opacity="0.14" />
          <path d="M25 30h5v50h-5z" fill="#000" opacity="0.28" />
          <path d="M15 30h10v50H15z" fill="#fff" opacity="0.16" />
          <path d="M10 30q2.3-3.6 5-.1 2.5-3.6 5 0 2.5-3.6 5 0 2.7-3.5 5 .1V80H10z" fill="none" {...line} />
          <path d="M15 30v50M25 30v50" stroke={INK} strokeOpacity="0.25" strokeWidth="0.9" />
          <path d="M16.7 13.4 20 5l3.3 8.4q-3.3 1.3-6.6 0z" fill={lead} {...line} strokeWidth="1.1" />
        </svg>
      );
    }
    case 'pen':
      return (
        <svg viewBox="0 0 40 80" aria-hidden="true" focusable="false">
          <path d="M10.6 25 14 12.4q6-9.4 12 0l3.4 12.6z" fill={colour} {...line} />
          <path d="M8.5 25h23v55h-23z" fill={colour} />
          <path d="M8.5 33h23v43h-23z" fill="#f7f1e3" />
          <path d="M8.5 46h23v17h-23z" fill={colour} opacity="0.9" />
          <path d="M8.5 37.5l3.8-2.4 3.8 2.4 3.8-2.4 3.8 2.4 3.8-2.4 3.8 2.4M8.5 71.5l3.8-2.4 3.8 2.4 3.8-2.4 3.8 2.4 3.8-2.4 3.8 2.4" stroke={colour} strokeWidth="1.4" fill="none" />
          <path d="M8.5 25h23v55h-23z" fill={shade} {...line} />
          <path d="M15.6 15.4q1.6-4 4.2-4.8" {...gloss} />
        </svg>
      );
    case 'marker':
      return (
        <svg viewBox="0 0 40 80" aria-hidden="true" focusable="false">
          <path d="M7 37q0-6.5 6.5-6.5h13Q33 30.5 33 37v43H7z" fill={colour} />
          <path d="M7 49h26v8H7z" fill="#fff" opacity="0.5" />
          <path d="M7 37q0-6.5 6.5-6.5h13Q33 30.5 33 37v43H7z" fill={shade} {...line} />
          <path d="M11 30.5l1.9-9.4h14.2l1.9 9.4z" fill="#efe9dc" {...line} />
          <path d="M14 21.1v-9.2L26 4.6v16.5z" fill={colour} {...line} />
          <path d="M16.2 18.6v-5.4" {...gloss} />
          <path d="M11 62v12" {...gloss} strokeOpacity={0.55} />
        </svg>
      );
    case 'erase':
      return (
        <svg viewBox="0 0 40 80" aria-hidden="true" focusable="false">
          <path d="M8.5 26q0-12.4 10.6-13h1.8q10.6.6 10.6 13v54h-23z" fill="#f9efeb" {...line} />
          <path d="M13 19q2.4-3 6.4-3.4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M7.8 35h24.4v45H7.8z" fill="#3f7fc9" />
          <path d="M7.8 43h24.4v6H7.8z" fill="#fff" opacity="0.92" />
          <path d="M7.8 53.5h24.4v2.6H7.8z" fill="#1e2a44" opacity="0.55" />
          <path d="M7.8 35h24.4v45H7.8z" fill={shade} {...line} />
        </svg>
      );
    case 'tear':
      return (
        <svg viewBox="0 0 40 80" aria-hidden="true" focusable="false">
          <path d="M5 28l3.4-3.2 2.8 2.2 3.4-3.8 2.8 2.8 3.6-3.6 3 2.6 3.2-3.1 3 2.7 3.8-2.6V80H5z" fill={KRAFT} transform="rotate(-7 20 52)" {...line} strokeWidth="1.1" />
          <path d="M6 19.5l3-2.6 2.6 2.4 3.4-3.4 2.5 2.6 3.8-3.2 2.8 2.8 3.4-2.9 2.7 2.4 3.8-2.4V80H6z" fill="#fcf9f1" {...line} strokeWidth="1.2" />
          <path d="M6 23.2l3-2.3 2.6 2.1 3.4-3.1 2.5 2.3 3.8-2.9 2.8 2.5 3.4-2.6 2.7 2.1 3.8-2.1V80H6z" fill={colour} />
          <path d="M6 23.2l3-2.3 2.6 2.1 3.4-3.1 2.5 2.3 3.8-2.9 2.8 2.5 3.4-2.6 2.7 2.1 3.8-2.1V80H6z" fill={shade} />
          <path d="M9 22.6l-.6-1.6M15.5 20.6l.4-1.8M24 19.6l-.5-1.7M30.6 19.3l.6-1.7" stroke="#fff" strokeWidth="0.8" strokeLinecap="round" />
        </svg>
      );
    case 'shape':
      return (
        <svg viewBox="0 0 40 80" aria-hidden="true" focusable="false">
          <path d="M18.3 33.5 13.4 5.4q-.3-2 1.2-.2l8.6 26.3z" fill={metal} {...line} strokeWidth="1.2" />
          <path d="M21.7 33.5 26.6 5.4q.3-2-1.2-.2l-8.6 26.3z" fill={metal} {...line} strokeWidth="1.2" />
          <path d="M18.4 34 15.6 38.6M21.6 34l2.8 4.6" stroke={colour} strokeWidth="5.6" strokeLinecap="round" />
          <circle cx="13.2" cy="46" r="6.6" fill="none" stroke={colour} strokeWidth="5" />
          <circle cx="26.8" cy="46" r="6.6" fill="none" stroke={colour} strokeWidth="5" />
          <circle cx="13.2" cy="46" r="9.1" fill={shade} fillOpacity="0.55" stroke={INK} strokeWidth="1.3" />
          <circle cx="26.8" cy="46" r="9.1" fill={shade} fillOpacity="0.55" stroke={INK} strokeWidth="1.3" />
          <circle cx="13.2" cy="46" r="4.1" fill="#f4efe5" stroke={INK} strokeWidth="1.2" />
          <circle cx="26.8" cy="46" r="4.1" fill="#f4efe5" stroke={INK} strokeWidth="1.2" />
          <circle cx="20" cy="32.2" r="1.9" fill="#d6d1c6" stroke={INK} strokeWidth="1" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 40 80" aria-hidden="true" focusable="false">
          <path d="M5 13h25l5 5v62H5z" fill="#fffdf7" {...line} />
          <path d="M30 13v5h5" fill="#e9e3d6" {...line} strokeWidth="1.1" />
          <text x="19.5" y="31" textAnchor="middle" fontSize="20" dominantBaseline="middle">
            {sticker}
          </text>
          <text x="12" y="52" textAnchor="middle" fontSize="11" dominantBaseline="middle">
            ⭐
          </text>
          <text x="27.5" y="53" textAnchor="middle" fontSize="11" dominantBaseline="middle">
            ❤️
          </text>
        </svg>
      );
  }
}

/** A swatch of paper as it will look: plain, kraft, tissue, spotty or gingham. */
function paperLook(finish: PaperFinish, colour: string): CSSProperties {
  const light = lightness(colour) > 0.8;
  switch (finish) {
    case 'kraft':
      return {
        backgroundColor: KRAFT,
        backgroundImage:
          'radial-gradient(circle at 30% 40%, rgb(70 45 20 / .5) 0 1px, transparent 1.5px), radial-gradient(circle at 70% 70%, rgb(70 45 20 / .45) 0 1px, transparent 1.5px), radial-gradient(circle at 60% 20%, rgb(255 245 225 / .6) 0 1px, transparent 1.5px)',
        backgroundSize: '9px 9px, 13px 11px, 11px 13px',
      };
    case 'tissue':
      return {
        backgroundColor: 'transparent',
        backgroundImage: `linear-gradient(135deg, ${colour}99 0 62%, transparent 62%), linear-gradient(135deg, transparent 30%, ${colour}88 30%)`,
      };
    case 'dots':
      return {
        backgroundColor: colour,
        backgroundImage: `radial-gradient(circle, ${light ? 'rgb(0 0 0 / .3)' : 'rgb(255 253 246 / .95)'} 0 1.8px, transparent 2.3px)`,
        backgroundSize: '8px 8px',
        backgroundPosition: '2px 2px',
      };
    case 'gingham': {
      const band = light ? 'rgb(0 0 0 / .22)' : `${colour}80`;
      return {
        backgroundColor: '#fbfaf5',
        backgroundImage: `linear-gradient(90deg, ${band} 50%, transparent 50%), linear-gradient(${band} 50%, transparent 50%)`,
        backgroundSize: '8px 8px',
      };
    }
    default:
      return { backgroundColor: colour };
  }
}

/** Crayons, felt-tips, a paintbrush, pencils, the highlighter, the rubber, paper to tear and cut, and stickers. */
export function DoodleTools({
  tool,
  onChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  tool: Tool;
  onChange: (t: Tool) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}) {
  const ids = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const lastDrawing = useRef<ToolKind>('felt');
  if (tool.kind !== 'erase' && tool.kind !== 'sticker') lastDrawing.current = tool.kind;
  const set = (p: Partial<Tool>) => onChange({ ...tool, ...p });
  const paperTool = tool.kind === 'tear' || tool.kind === 'shape';
  const shown = tool.paper === 'kraft' && paperTool ? KRAFT : tool.colour;
  const isPen = PENS.some((p) => p.kind === tool.kind);
  const sizeName = sizes.find((s) => s.value === tool.size)?.name ?? '';
  const paperName = papers.find((p) => p.value === tool.paper)?.name ?? '';
  const detail =
    tool.kind === 'shape'
      ? `${shapes.find((s) => s.value === tool.shape)?.name ?? ''} · ${paperName}`
      : tool.kind === 'tear'
        ? `${paperName} · ${sizeName}`
        : sizeName;

  const toolRadio = (t: { kind: ToolKind; label: string }, i: number, group: { kind: ToolKind }[]) => (
    <Radio
      key={t.kind}
      checked={tool.kind === t.kind}
      tabbable={i === 0 && !group.some((g) => g.kind === tool.kind)}
      label={t.label}
      className="tray-tool"
      onSelect={() => set({ kind: t.kind })}
    >
      <ToolArt kind={t.kind} colour={t.kind === 'tear' || t.kind === 'shape' ? shown : tool.colour} sticker={tool.sticker} ids={ids} />
    </Radio>
  );

  const sizeDot = (value: number) => {
    if (tool.kind === 'sticker') return <span className="size-emoji" style={{ fontSize: 10 + value * 0.65 }}>{tool.sticker}</span>;
    if (tool.kind === 'tear') return <span className="size-strip" style={{ height: Math.round(tearWidth(value) / 4.4), ...paperLook(tool.paper, shown) }} />;
    const kind = (isPen ? tool.kind : 'felt') as LineTool;
    const d = Math.max(4, Math.min(28, lineWidth(kind, value) * 0.62 + 2));
    return <span className="size-dot" data-rubber={kind === 'erase' || undefined} style={{ width: d, height: d, background: kind === 'erase' ? undefined : tool.colour }} />;
  };

  const sizeGroup = (
    <Radios label="Size" className="tools-group tools-sizes" row>
      {sizes.map((s, i) => (
        <Radio key={s.value} checked={tool.size === s.value} tabbable={i === 0 && !sizes.some((x) => x.value === tool.size)} label={s.name} className="tool-size" onSelect={() => set({ size: s.value })}>
          {sizeDot(s.value)}
        </Radio>
      ))}
    </Radios>
  );

  const paperGroup = (
    <Radios label="Paper" className="tools-group tools-papers" row>
      {papers.map((p, i) => (
        <Radio key={p.value} checked={tool.paper === p.value} tabbable={i === 0 && !papers.some((x) => x.value === tool.paper)} label={p.name} className="tool-paper" onSelect={() => set({ paper: p.value })}>
          <span className="paper-chip" data-finish={p.value} style={paperLook(p.value, tool.colour)} />
        </Radio>
      ))}
    </Radios>
  );

  const shapeGroup = (
    <Radios label="Shape" className="tools-group tools-shapes" row>
      {shapes.map((s, i) => (
        <Radio key={s.value} checked={tool.shape === s.value} tabbable={i === 0 && !shapes.some((x) => x.value === tool.shape)} label={s.name} className="tool-shape" onSelect={() => set({ shape: s.value })}>
          <svg viewBox="-1.25 -1.25 2.5 2.5" aria-hidden="true" focusable="false">
            <path d={shapeIconPath(s.value)} fill={shown} stroke={lightness(shown) > 0.85 ? 'rgb(0 0 0 / .25)' : 'none'} strokeWidth="0.04" />
          </svg>
        </Radio>
      ))}
    </Radios>
  );

  return (
    <div className="tools" role="group" aria-label="Drawing tools" data-kind={tool.kind}>
      <svg className="tools-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${ids}-shade`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#000" stopOpacity="0.16" />
            <stop offset="0.28" stopColor="#fff" stopOpacity="0.38" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.28" />
          </linearGradient>
          <linearGradient id={`${ids}-metal`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#8e949b" />
            <stop offset="0.35" stopColor="#f2f4f6" />
            <stop offset="0.6" stopColor="#b9bec4" />
            <stop offset="1" stopColor="#7d838a" />
          </linearGradient>
          <linearGradient id={`${ids}-wood`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#b9773f" />
            <stop offset="0.35" stopColor="#e7ae6c" />
            <stop offset="1" stopColor="#a8652f" />
          </linearGradient>
        </defs>
      </svg>
      <div className="tools-inner">
        <Radios label="Pens" className="tray tray-pens">
          {PENS.map((t, i) => toolRadio(t, i, PENS))}
        </Radios>
        <Radios label="Paper and stickers" className="tray tray-paper">
          {PAPER_TOOLS.map((t, i) => toolRadio(t, i, PAPER_TOOLS))}
        </Radios>
        <p className="tools-caption" aria-hidden="true">
          <strong>{LABELS[tool.kind]}</strong>
          <span>{detail}</span>
        </p>

        {(onUndo || onRedo) && (
          <div className="tools-history">
            {onUndo && <IconButton icon="undo" label="Undo" onClick={onUndo} disabled={!canUndo} />}
            {onRedo && <IconButton icon="redo" label="Redo" onClick={onRedo} disabled={!canRedo} />}
          </div>
        )}

        <div className="tools-strip" key={tool.kind === 'sticker' ? 'stickers' : 'colours'} ref={scrollRow}>
          {tool.kind === 'sticker' ? (
            <Radios label="Sticker" className="tools-group tools-stickers">
              {stickers.map((s, i) => (
                <Radio key={s} checked={tool.sticker === s} tabbable={i === 0 && !stickers.includes(tool.sticker)} label={s} className="tool-sticker" onSelect={() => set({ sticker: s })}>
                  <span aria-hidden="true">{s}</span>
                </Radio>
              ))}
            </Radios>
          ) : (
            <Radios label="Colour" className="tools-group tools-colours">
              {crayons.map((c, i) => (
                <Radio
                  key={c.value}
                  checked={tool.colour === c.value}
                  tabbable={i === 0 && !crayons.some((x) => x.value === tool.colour)}
                  label={c.name}
                  className="colour-chip"
                  style={{ '--chip': c.value, '--cut': chipCuts[i].clip, '--tilt': chipCuts[i].tilt } as CSSProperties}
                  onSelect={() => set({ colour: c.value, ...(tool.kind === 'erase' ? { kind: lastDrawing.current } : {}) })}
                >
                  <span className="chip" data-light={lightness(c.value) > 0.8 || undefined} data-dark={lightness(c.value) < 0.2 || undefined} />
                </Radio>
              ))}
            </Radios>
          )}
        </div>

        <div className={paperTool ? 'tools-options tools-paired' : 'tools-options'} key={paperTool ? tool.kind : 'sizes'} ref={scrollRow}>
          {tool.kind === 'shape' ? (
            <>
              {shapeGroup}
              {paperGroup}
            </>
          ) : tool.kind === 'tear' ? (
            <>
              {paperGroup}
              {sizeGroup}
            </>
          ) : (
            sizeGroup
          )}
        </div>
      </div>
    </div>
  );
}
