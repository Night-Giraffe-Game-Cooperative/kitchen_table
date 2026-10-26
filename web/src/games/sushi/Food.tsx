// Sushi Train's food, drawn simply so each dish is easy to tell apart: a
// slab of topping on rice for nigiri, a roll seen from the end for maki,
// and little bowls for the sides.

import type { Dish, Ingredient, Side, Topping } from './rules';

const rice = '#fbf7ee';
const riceEdge = '#e2d6bf';
const nori = '#2f4a3a';

export const toppingColour: Record<Topping, { fill: string; stripe: string }> = {
  salmon: { fill: '#f4885a', stripe: '#fde1cf' },
  tuna: { fill: '#d6404b', stripe: '#ee8c8f' },
  egg: { fill: '#f7d24a', stripe: '#fbe79a' },
  prawn: { fill: '#f6a184', stripe: '#fff1e8' },
  cucumber: { fill: '#7fb55a', stripe: '#d7ecc2' },
  avocado: { fill: '#a6c867', stripe: '#e3efc4' },
};

function Nigiri({ top }: { top: Topping }) {
  const c = toppingColour[top];
  return (
    <>
      <ellipse cx="24" cy="31" rx="15" ry="8.5" fill={rice} stroke={riceEdge} strokeWidth="1.2" />
      <path d="M8 27 Q10 16 24 16 Q38 16 40 27 Q32 31 24 30 Q15 31 8 27Z" fill={c.fill} />
      {top === 'salmon' || top === 'tuna' || top === 'prawn' ? (
        <path d="M14 19 l4 9 M21 17 l3 11 M28 17 l3 11 M34 19 l3 8" stroke={c.stripe} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M13 22 Q24 18 35 22" stroke={c.stripe} strokeWidth="2" strokeLinecap="round" fill="none" />
      )}
      {top === 'prawn' && <path d="M38 22 l6 -5 l-1 7z" fill="#e2704f" />}
      {top === 'egg' && <rect x="20" y="15" width="8" height="18" rx="1.5" fill={nori} />}
    </>
  );
}

function Maki({ fill }: { fill: Topping[] }) {
  return (
    <>
      <circle cx="24" cy="24" r="16" fill={nori} />
      <circle cx="24" cy="24" r="12.5" fill={rice} />
      {fill.length === 1 ? (
        <circle cx="24" cy="24" r="5.5" fill={toppingColour[fill[0]].fill} />
      ) : (
        <>
          <circle cx="21" cy="24" r="4.4" fill={toppingColour[fill[0]].fill} />
          <circle cx="27" cy="24" r="4.4" fill={toppingColour[fill[1]].fill} />
        </>
      )}
      <circle cx="17" cy="18" r="1" fill={riceEdge} />
      <circle cx="31" cy="30" r="1" fill={riceEdge} />
      <circle cx="30" cy="17" r="1" fill={riceEdge} />
    </>
  );
}

function SideDish({ what }: { what: Side }) {
  return (
    <>
      <path d="M8 22 H40 Q39 38 24 38 Q9 38 8 22Z" fill={what === 'miso' ? '#7a4b33' : '#3f6d8f'} />
      {what === 'miso' ? (
        <>
          <ellipse cx="24" cy="22" rx="16" ry="4.5" fill="#d9a066" />
          <rect x="17" y="19.5" width="4" height="4" rx="0.8" fill="#fbf3dd" />
          <rect x="25" y="20.5" width="4" height="4" rx="0.8" fill="#fbf3dd" />
          <circle cx="31" cy="21" r="1.4" fill="#6aa84f" />
          <circle cx="15" cy="22.5" r="1.2" fill="#6aa84f" />
        </>
      ) : (
        <>
          <ellipse cx="24" cy="22" rx="16" ry="4.5" fill="#2e5470" />
          {[
            [16, 19, -20],
            [24, 17, 10],
            [31, 19, 30],
            [20, 22, 60],
            [28, 22, -40],
          ].map(([x, y, r], i) => (
            <ellipse key={i} cx={x} cy={y} rx="5.5" ry="2.6" transform={`rotate(${r} ${x} ${y})`} fill="#8cc152" stroke="#5e9a34" strokeWidth="0.8" />
          ))}
        </>
      )}
    </>
  );
}

/** One dish, in a 48 by 48 box. */
export function DishArt({ dish, size = 40 }: { dish: Dish; size?: number }) {
  const [kind, what] = dish.split(':');
  return (
    <svg className="sushi-dish" viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false">
      {kind === 'nigiri' && <Nigiri top={what as Topping} />}
      {kind === 'maki' && <Maki fill={what.split('+') as Topping[]} />}
      {kind === 'side' && <SideDish what={what as Side} />}
    </svg>
  );
}

/** An ingredient, for its button at the station. */
export function IngredientArt({ what, size = 40 }: { what: Ingredient; size?: number }) {
  return (
    <svg className="sushi-ingredient-art" viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false">
      {what === 'rice' ? (
        <>
          <path d="M8 24 H40 Q39 39 24 39 Q9 39 8 24Z" fill="#c0503a" />
          <path d="M9 25 Q12 12 24 12 Q36 12 39 25Z" fill={rice} stroke={riceEdge} strokeWidth="1.2" />
          <circle cx="18" cy="19" r="1" fill={riceEdge} />
          <circle cx="27" cy="16" r="1" fill={riceEdge} />
          <circle cx="31" cy="21" r="1" fill={riceEdge} />
        </>
      ) : what === 'nori' ? (
        <>
          <rect x="9" y="10" width="30" height="28" rx="2" fill={nori} />
          <path d="M9 17 H39 M9 24 H39 M9 31 H39" stroke="#3f5f4b" strokeWidth="1" />
        </>
      ) : what === 'edamame' || what === 'miso' ? (
        <SideDish what={what} />
      ) : (
        <>
          <rect x="8" y="15" width="32" height="18" rx="6" fill={toppingColour[what].fill} />
          <path d="M15 17 l4 14 M23 16 l3 16 M31 17 l3 14" stroke={toppingColour[what].stripe} strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** What's on someone's board while they make a dish. */
export function BoardArt({ board, size = 64 }: { board: { base: 'rice' } | { base: 'nori'; rice: boolean; fill: Topping[] }; size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false">
      {board.base === 'rice' ? (
        <ellipse cx="24" cy="28" rx="15" ry="9" fill={rice} stroke={riceEdge} strokeWidth="1.2" />
      ) : (
        <>
          <rect x="6" y="8" width="36" height="32" rx="2" fill={nori} />
          {board.rice && <rect x="8" y="10" width="32" height="22" rx="2" fill={rice} />}
          {board.fill.map((f, i) => (
            <rect key={f} x="8" y={14 + i * 7} width="32" height="5" rx="2.5" fill={toppingColour[f].fill} />
          ))}
        </>
      )}
    </svg>
  );
}
