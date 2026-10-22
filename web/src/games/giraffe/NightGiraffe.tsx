// The Night Giraffe peeking out: a round friendly head and a bit of neck. His
// head is centred at (50, 50) in a 100 by 120 box, so the board can put the
// middle of his face exactly on his hiding spot.

/** Where his face is, as a fraction of the drawing's width and height. */
export const FACE = { x: 0.5, y: 50 / 120 };

/** How much wider the drawing is than his head, to size him from the band's radius. */
export const HEAD_SHARE = 54 / 100;

const coat = '#f7c95f';
const patch = '#c97f35';
const horn = '#7a4a22';

export function NightGiraffe({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 120" aria-hidden="true" focusable="false">
      {/* Neck, running off the bottom */}
      <path d="M37 66 C36 86 35 104 33 122 H67 C65 104 64 86 63 66 Z" fill={coat} stroke="#a86a2c" strokeWidth="1.2" />
      <path d="M38 84 q6 -5 10 0 q2 6 -4 8 q-6 0 -6 -8z" fill={patch} />
      <path d="M53 94 q7 -3 9 3 q0 6 -6 6 q-5 -1 -3 -9z" fill={patch} />
      <path d="M37 106 q5 -3 7 2 q-1 6 -6 5 q-3 -2 -1 -7z" fill={patch} />
      <path d="M50 110 q5 -2 7 2 q-1 5 -5 5 q-3 -2 -2 -7z" fill={patch} />

      {/* Ossicones */}
      <path d="M41 30 L37.5 15" stroke="#e2a948" strokeWidth="5" strokeLinecap="round" />
      <path d="M59 30 L62.5 15" stroke="#e2a948" strokeWidth="5" strokeLinecap="round" />
      <circle cx="37" cy="13" r="5" fill={horn} />
      <circle cx="63" cy="13" r="5" fill={horn} />

      {/* Ears */}
      <ellipse cx="19" cy="38" rx="12" ry="5.5" transform="rotate(-24 19 38)" fill={coat} stroke="#a86a2c" strokeWidth="1.2" />
      <ellipse cx="20.5" cy="38" rx="7" ry="2.6" transform="rotate(-24 20.5 38)" fill="#f2a7a0" />
      <ellipse cx="81" cy="38" rx="12" ry="5.5" transform="rotate(24 81 38)" fill={coat} stroke="#a86a2c" strokeWidth="1.2" />
      <ellipse cx="79.5" cy="38" rx="7" ry="2.6" transform="rotate(24 79.5 38)" fill="#f2a7a0" />

      {/* Head */}
      <ellipse cx="50" cy="50" rx="27" ry="24" fill={coat} stroke="#a86a2c" strokeWidth="1.2" />
      <path d="M45 30 q5 -4 10 0 q1 4 -5 5 q-5 0 -5 -5z" fill={patch} />
      <path d="M69 42 q5 -1 6 4 q-1 5 -5 4 q-3 -3 -1 -8z" fill={patch} />
      <path d="M26 44 q4 -2 5 2 q0 5 -4 5 q-3 -2 -1 -7z" fill={patch} />

      {/* Muzzle and a small smile */}
      <ellipse cx="50" cy="62" rx="18" ry="12" fill="#fbe2b0" />
      <ellipse cx="44" cy="58.5" rx="2" ry="1.4" fill="#8a5a33" />
      <ellipse cx="56" cy="58.5" rx="2" ry="1.4" fill="#8a5a33" />
      <path d="M43.5 65.5 q6.5 5 13 0" stroke={horn} strokeWidth="2" fill="none" strokeLinecap="round" />

      {/* Rosy cheeks */}
      <circle cx="29" cy="57" r="4.5" fill="#f29a8f" opacity="0.6" />
      <circle cx="71" cy="57" r="4.5" fill="#f29a8f" opacity="0.6" />

      {/* Big kind eyes */}
      <circle cx="40" cy="45" r="7" fill="#fff" />
      <circle cx="60" cy="45" r="7" fill="#fff" />
      <circle cx="40.8" cy="46" r="4.6" fill="#2b1d14" />
      <circle cx="59.2" cy="46" r="4.6" fill="#2b1d14" />
      <circle cx="42.4" cy="44.2" r="1.7" fill="#fff" />
      <circle cx="60.8" cy="44.2" r="1.7" fill="#fff" />
      <path d="M34.5 35.5 q5.5 -2.2 11 0" stroke={horn} strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M54.5 35.5 q5.5 -2.2 11 0" stroke={horn} strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
