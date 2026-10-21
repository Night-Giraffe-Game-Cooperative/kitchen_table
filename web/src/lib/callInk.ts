// Drawing over each other's pictures in a video call: moustaches, crowns,
// silly glasses, scribbles.
//
// Everything drawn on someone's picture is kept in the coordinates of their
// camera picture (0 to 1 across and down), not of the screen. Each device
// shows the picture its own size and shape, cropped to fill the photo frame,
// so turning those coordinates into screen positions per device keeps a
// moustache under the same nose on every screen.

export type Sticker =
  | 'moustache'
  | 'nose'
  | 'whiskers'
  | 'glasses'
  | 'crown'
  | 'hat'
  | 'bow'
  | 'flower'
  | 'star'
  | 'heart';

export type InkTool = 'pen' | Sticker;

export interface InkStroke {
  /** Starts with the drawing device's peer id, so ids never clash. */
  id: string;
  /** The peer whose picture it's drawn on. */
  on: string;
  /** Who drew it. */
  by: number;
  kind: 'pen' | 'sticker';
  colour: string;
  /** Pen width, or sticker height, as a share of the picture's height. */
  size: number;
  sticker?: Sticker;
  /** Flat list of points: x, y, x, y… Stickers have one point, their middle. */
  points: number[];
  /** Still being drawn (by someone else), so their name shows by the pen. */
  live?: boolean;
  /** When this device last heard about it. */
  at?: number;
}

/** Felt tips: bright, bold colours that show up over a video. */
export const inkColours = [
  { name: 'Black', value: '#24201d' },
  { name: 'White', value: '#ffffff' },
  { name: 'Red', value: '#e5383b' },
  { name: 'Orange', value: '#f58a1f' },
  { name: 'Yellow', value: '#ffd43b' },
  { name: 'Green', value: '#2fae5b' },
  { name: 'Blue', value: '#2f7fe0' },
  { name: 'Purple', value: '#8b4fd8' },
  { name: 'Pink', value: '#ff6fb0' },
] as const;

/** Three nibs: thin, medium and chunky. */
export const penSizes = [0.012, 0.025, 0.05] as const;
/** Sticker heights for the same three sizes. */
export const stickerSizes = [0.13, 0.22, 0.36] as const;

export const stickers: { id: Sticker; name: string; emoji?: string }[] = [
  { id: 'moustache', name: 'Moustache' },
  { id: 'nose', name: 'Clown nose' },
  { id: 'whiskers', name: 'Cat whiskers' },
  { id: 'glasses', name: 'Sunglasses', emoji: '🕶️' },
  { id: 'crown', name: 'Crown', emoji: '👑' },
  { id: 'hat', name: 'Top hat', emoji: '🎩' },
  { id: 'bow', name: 'Bow', emoji: '🎀' },
  { id: 'flower', name: 'Flower', emoji: '🌸' },
  { id: 'star', name: 'Star', emoji: '⭐' },
  { id: 'heart', name: 'Heart', emoji: '💖' },
];

/** How a camera picture sits in a frame on screen. */
export interface Fit {
  /** The frame, in CSS pixels. */
  w: number;
  h: number;
  /** The camera picture's own size. */
  vw: number;
  vh: number;
  /** Shown mirrored, as your own picture is. */
  mirrored: boolean;
}

/** The picture fills the frame and is cropped (like CSS object-fit: cover). */
function cover({ w, h, vw, vh }: Fit) {
  const vwOk = vw || 640;
  const vhOk = vh || 480;
  const scale = Math.max(w / vwOk, h / vhOk);
  const pw = vwOk * scale;
  const ph = vhOk * scale;
  return { pw, ph, dx: (w - pw) / 2, dy: (h - ph) / 2 };
}

/** A point on the picture (0–1) to a point in the frame. */
export function toScreen(fit: Fit, u: number, v: number): [number, number] {
  const { pw, ph, dx, dy } = cover(fit);
  return [dx + (fit.mirrored ? 1 - u : u) * pw, dy + v * ph];
}

/** A point in the frame to a point on the picture (0–1). */
export function toPicture(fit: Fit, x: number, y: number): [number, number] {
  const { pw, ph, dx, dy } = cover(fit);
  const u = (x - dx) / pw;
  return [round(fit.mirrored ? 1 - u : u), round((y - dy) / ph)];
}

/** How many screen pixels one picture-height is. */
export function pictureHeight(fit: Fit): number {
  return cover(fit).ph;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Adds a point to a pen stroke unless it's too close to the last one to matter. */
export function addPoint(points: number[], u: number, v: number, minStep = 0.003): boolean {
  const n = points.length;
  if (n >= 2 && Math.hypot(points[n - 2] - u, points[n - 1] - v) < minStep) return false;
  points.push(u, v);
  return true;
}

// Drawing ---------------------------------------------------------------------

const emojiFont = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** Draws strokes onto a canvas context set up in CSS pixels for the frame. */
export function drawInk(ctx: CanvasRenderingContext2D, fit: Fit, strokes: InkStroke[], nameOf?: (stroke: InkStroke) => string | null) {
  const unit = pictureHeight(fit);
  for (const s of strokes) {
    if (s.kind === 'pen') drawPen(ctx, fit, s, unit);
    else if (s.sticker && s.points.length >= 2) {
      const [x, y] = toScreen(fit, s.points[0], s.points[1]);
      drawSticker(ctx, s.sticker, x, y, s.size * unit);
    }
  }
  if (!nameOf) return;
  // Name tags beside the pens of people drawing right now.
  for (const s of strokes) {
    const name = s.live ? nameOf(s) : null;
    if (!name || s.points.length < 2) continue;
    const n = s.points.length;
    const [x, y] = toScreen(fit, s.points[n - 2], s.points[n - 1]);
    nameTag(ctx, name, x, y, s.colour);
  }
}

function drawPen(ctx: CanvasRenderingContext2D, fit: Fit, s: InkStroke, unit: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) pts.push(toScreen(fit, s.points[i], s.points[i + 1]));
  if (!pts.length) return;
  const width = Math.max(1.5, s.size * unit);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.colour;
  ctx.fillStyle = s.colour;
  ctx.lineWidth = width;
  // A soft shadow so ink reads over any picture, light or dark.
  ctx.shadowColor = s.colour.toLowerCase() === '#ffffff' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = Math.max(2, width * 0.35);
  ctx.globalAlpha = 0.94;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    // Smooth curves through the middles of each pair of points.
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
    // Felt tips leave a little more ink where they start and stop.
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 0.35;
    for (const [x, y] of [pts[0], last]) {
      ctx.beginPath();
      ctx.arc(x, y, width * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Draws a sticker centred on (x, y), `height` pixels tall. */
export function drawSticker(ctx: CanvasRenderingContext2D, sticker: Sticker, x: number, y: number, height: number) {
  ctx.save();
  ctx.translate(x, y);
  const def = stickers.find((s) => s.id === sticker);
  if (def?.emoji) {
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = height * 0.06;
    ctx.shadowOffsetY = height * 0.03;
    ctx.font = `${Math.round(height)}px ${emojiFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.emoji, 0, height * 0.04);
  } else if (sticker === 'moustache') {
    moustache(ctx, height);
  } else if (sticker === 'nose') {
    clownNose(ctx, height);
  } else if (sticker === 'whiskers') {
    whiskers(ctx, height);
  }
  ctx.restore();
}

/** A curly handlebar moustache, about twice as wide as it is tall. */
function moustache(ctx: CanvasRenderingContext2D, height: number) {
  const k = height / 50;
  ctx.scale(k, k);
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1.5;
  ctx.fillStyle = '#3a271b';
  for (const side of [1, -1]) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.bezierCurveTo(8, -16, 30, -18, 42, -6);
    ctx.bezierCurveTo(50, 2, 60, 2, 66, -8);
    ctx.bezierCurveTo(70, -15, 66, -22, 60, -20);
    ctx.bezierCurveTo(68, -26, 80, -16, 74, -2);
    ctx.bezierCurveTo(66, 16, 40, 20, 22, 10);
    ctx.bezierCurveTo(12, 5, 5, 6, 0, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // A little shine so it looks waxed.
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (const side of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(side * 10, -8);
    ctx.quadraticCurveTo(side * 24, -13, side * 36, -7);
    ctx.stroke();
  }
}

function clownNose(ctx: CanvasRenderingContext2D, height: number) {
  const r = height / 2;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = r * 0.3;
  ctx.shadowOffsetY = r * 0.12;
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#ff8a80');
  g.addColorStop(0.45, '#e5262b');
  g.addColorStop(1, '#a3131a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.38, -r * 0.42, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

/** A pink cat nose with three whiskers each side. */
function whiskers(ctx: CanvasRenderingContext2D, height: number) {
  const k = height / 50;
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255,255,255,0.5)';
  ctx.shadowBlur = 2;
  ctx.strokeStyle = '#24201d';
  ctx.lineWidth = 2.6;
  for (const side of [1, -1]) {
    for (const [y0, y1] of [
      [-3, -12],
      [2, 2],
      [7, 16],
    ]) {
      ctx.beginPath();
      ctx.moveTo(side * 12, y0);
      ctx.quadraticCurveTo(side * 34, (y0 + y1) / 2 - 2, side * 58, y1);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#ff8fb5';
  ctx.strokeStyle = '#24201d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-9, -6);
  ctx.quadraticCurveTo(0, -10, 9, -6);
  ctx.quadraticCurveTo(4, 4, 0, 5);
  ctx.quadraticCurveTo(-4, 4, -9, -6);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 5);
  ctx.lineTo(0, 10);
  ctx.quadraticCurveTo(-5, 15, -10, 11);
  ctx.moveTo(0, 10);
  ctx.quadraticCurveTo(5, 15, 10, 11);
  ctx.stroke();
}

function nameTag(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, colour: string) {
  ctx.save();
  const font = getComputedStyle(document.body).fontFamily;
  ctx.font = `700 12px ${font}`;
  const w = ctx.measureText(name).width + 14;
  const tx = x + 10;
  const ty = y - 26;
  ctx.fillStyle = colour.toLowerCase() === '#ffffff' || colour.toLowerCase() === '#ffd43b' ? '#24201d' : colour;
  ctx.beginPath();
  ctx.roundRect(tx, ty, w, 20, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, tx + 7, ty + 10.5);
  ctx.restore();
}

// Ideas -------------------------------------------------------------------------

const ideas = [
  'Give {name} a big curly moustache',
  'Turn {name} into a cat',
  'Make {name} a king or a queen',
  'Give {name} some silly glasses',
  'Draw {name} a party hat',
  'Turn {name} into a pirate',
  'Give {name} rosy cheeks and freckles',
  'Turn {name} into a clown',
  'Give {name} bunny ears',
  'Draw a crown of flowers on {name}',
  'Turn {name} into a superhero',
  'Give {name} a beard down to their toes',
  'Turn {name} into a dog',
  'Give {name} a rainbow wig',
  'Make {name} a wizard',
  'Draw {name} some sparkly earrings',
  'Turn {name} into a robot',
  'Give {name} a monobrow',
  'Make {name} a fairy',
  'Turn {name} into a dinosaur',
  'Give everyone a moustache',
  'Turn everyone into animals',
  'Put everyone in a hat',
  'Make everyone look sleepy',
];

/** A suggestion for what to draw, naming someone in the call. */
export function inkIdea(names: string[], random: () => number = Math.random): string {
  const template = ideas[Math.floor(random() * ideas.length)];
  const name = names.length ? names[Math.floor(random() * names.length)] : 'someone';
  return template.replace('{name}', name);
}
