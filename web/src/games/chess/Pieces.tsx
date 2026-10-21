import type { ReactNode } from 'react';
import type { Kind, Side } from './rules';

// Chess pieces drawn for this app: round, friendly shapes with an ink outline.
const shapes: Record<Kind, ReactNode> = {
  p: (
    <>
      <circle cx="22.5" cy="14.5" r="5.5" />
      <path d="M16.5 33c0-5 2-9 4-11.5h4c2 2.5 4 6.5 4 11.5z" />
      <rect x="12.5" y="32.5" width="20" height="6" rx="2.5" />
    </>
  ),
  r: (
    <>
      <path d="M12.5 9.5h4.5v3.5h3v-3.5h5v3.5h3v-3.5h4.5v8h-20z" />
      <path d="M15 17.5h15l-1 15h-13z" />
      <rect x="11.5" y="32.5" width="22" height="6" rx="2.5" />
    </>
  ),
  n: (
    <>
      <path d="M14.5 38.5h17c.5-4 0-8.5-1.5-12 3-4.5 3-12-3-16.5l-1.5-4-2.5 3.5c-6 .5-10 5-11.5 10l3.5 3 5-3.5.5 3c-4.5 3-6.5 9-5 16.5z" />
      <circle cx="21" cy="14.5" r="1.3" className="piece-detail-fill" />
    </>
  ),
  b: (
    <>
      <circle cx="22.5" cy="9" r="2.6" />
      <path d="M16 33c-1.5-7 1-14 6.5-20.5C28 19 30.5 26 29 33z" />
      <path d="m25 18.5-4.5 6" className="piece-detail" />
      <rect x="12" y="32.5" width="21" height="6" rx="2.5" />
    </>
  ),
  q: (
    <>
      <path d="M13 33 11 15.5l6 8 5.5-11.5 5.5 11.5 6-8-2 17.5z" />
      <circle cx="11" cy="13.5" r="2.4" />
      <circle cx="22.5" cy="10" r="2.4" />
      <circle cx="34" cy="13.5" r="2.4" />
      <rect x="11.5" y="32.5" width="22" height="6" rx="2.5" />
    </>
  ),
  k: (
    <>
      <path d="M21 5.5h3v4h3.5v3H24v5h-3v-5h-3.5v-3H21z" />
      <path d="M13 33c-1.5-8 1.5-14.5 9.5-15 8 .5 11 7 9.5 15z" />
      <path d="M15 27.5h15" className="piece-detail" />
      <rect x="11.5" y="32.5" width="22" height="6" rx="2.5" />
    </>
  ),
};

const names: Record<Kind, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function pieceName(side: Side, kind: Kind) {
  return `${side === 'w' ? 'white' : 'black'} ${names[kind]}`;
}

export function PieceIcon({ side, kind, size }: { side: Side; kind: Kind; size?: number | string }) {
  return (
    <svg viewBox="0 0 45 45" width={size} height={size} className={`piece piece-${side}`} aria-hidden="true" focusable="false">
      {shapes[kind]}
    </svg>
  );
}
