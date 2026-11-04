// Optional parts of the app, which an admin switches on or off for everyone
// on the Family page. Each keeps to its own folder here, with its screen,
// styles and data, and a matching part on the server (Family.Modules). One
// that's switched off isn't in the menu, and its code isn't downloaded.

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { IconName } from '../components/icons';

export type ModuleId = 'learn';

export interface ModuleDef {
  /** Also its address, like #/learn. */
  id: ModuleId;
  /** Its name in the menu. */
  label: string;
  icon: IconName;
  /** What it is, beside its switch on the Family page. */
  blurb: string;
  Screen: LazyExoticComponent<ComponentType>;
}

export const moduleDefs: ModuleDef[] = [
  {
    id: 'learn',
    label: 'Learn',
    icon: 'globe',
    blurb: 'Japanese and French for a family holiday: phrases, signs and characters to learn together, travel games, and a countdown to the trip.',
    Screen: lazy(() => import('./learn/Learn').then((m) => ({ default: m.Learn }))),
  },
];
