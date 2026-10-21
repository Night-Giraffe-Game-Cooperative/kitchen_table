// Age bands: every game can be set up for 5–7, 8–10, 11–13 or 14 and over.
// Younger bands get easier words, more clues and gentler computer players;
// older ones get harder ones and fewer tips. A game keeps its band in its
// state, so everyone playing sees the same game.
import type { Me } from '../lib/types';

export type Band = '5-7' | '8-10' | '11-13' | '14+';

export const BANDS: Band[] = ['5-7', '8-10', '11-13', '14+'];

export const bandLabel: Record<Band, string> = { '5-7': '5–7', '8-10': '8–10', '11-13': '11–13', '14+': '14+' };

/** Spoken and written in full, for screen readers and hints: "ages 5 to 7". */
export const bandWords: Record<Band, string> = { '5-7': 'ages 5 to 7', '8-10': 'ages 8 to 10', '11-13': 'ages 11 to 13', '14+': 'ages 14 and up' };

export const isBand = (b: unknown): b is Band => BANDS.includes(b as Band);

/** The band a game was set up for. Games from before bands play as 8–10. */
export function bandOf(state: unknown): Band {
  const b = (state as { band?: unknown } | null)?.band;
  return isBand(b) ? b : '8-10';
}

/** 0 for 5–7 up to 3 for 14+, for picking from lists that get harder. */
export const step = (b: Band) => BANDS.indexOf(b);

/** Which tips a band gets: all of them, the rules but not the basics, or none (a hint still shows when asked for). */
export function tipsFor(b: Band): 'all' | 'rules' | 'none' {
  return b === '14+' ? 'none' : b === '11-13' ? 'rules' : 'all';
}

const KEY = 'games:band';

/** The band last chosen on this device, or a starting guess from who is playing. */
export function defaultBand(me: Pick<Me, 'role'>): Band {
  try {
    const saved = localStorage.getItem(KEY);
    if (isBand(saved)) return saved;
  } catch {
    /* nothing remembered */
  }
  return me.role === 'kid' ? '5-7' : '8-10';
}

export function rememberBand(b: Band) {
  try {
    localStorage.setItem(KEY, b);
  } catch {
    /* private browsing: it just isn't remembered */
  }
}
