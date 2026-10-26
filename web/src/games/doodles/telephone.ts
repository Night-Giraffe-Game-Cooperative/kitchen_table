// Doodle Telephone's rules: one chain of steps, words then a drawing then
// words, each by someone other than the one before. One person takes the
// next step at a time, so two people never draw the same words and lose a
// drawing when the other sends theirs first.

export interface Step {
  kind: 'words' | 'picture';
  u: number;
  text?: string;
  url?: string;
}

/** Who has taken the next step, when, and which step it is. */
export interface Doing {
  u: number;
  at: number;
  step: number;
}

export interface State {
  turn: 'anyone';
  steps: Step[];
  length: number;
  doing?: Doing;
}

/** How long a step stays someone's before anyone else can take it over. */
export const HOLD = 20 * 60_000;

/** Who is doing the next step right now, if anyone. */
export function holder(s: State, now = Date.now()): Doing | undefined {
  const d = s.doing;
  return d && d.step === s.steps.length && now - d.at < HOLD ? d : undefined;
}

/** What the next step is: a drawing of words, or words for a drawing. */
export function nextKind(s: State): Step['kind'] {
  return s.steps[s.steps.length - 1]?.kind === 'words' ? 'picture' : 'words';
}

/** Whether this person may take the next step: not straight after themselves, and nobody else on it. */
export function canTake(s: State, me: number, now = Date.now()): boolean {
  const last = s.steps[s.steps.length - 1];
  if (!last || last.u === me || s.steps.length >= s.length) return false;
  const h = holder(s, now);
  return !h || h.u === me;
}

/** Someone takes the next step. */
export function take(s: State, me: number, now = Date.now()): State | null {
  if (!canTake(s, me, now)) return null;
  return { ...s, doing: { u: me, at: now, step: s.steps.length } };
}

/** They give it back for someone else. */
export function release(s: State, me: number): State | null {
  if (s.doing?.u !== me) return null;
  const { doing: _, ...rest } = s;
  return rest;
}

/** Adds their step, if it's still theirs to add. */
export function addStep(s: State, step: Step, now = Date.now()): State | null {
  if (step.kind !== nextKind(s) || !canTake(s, step.u, now)) return null;
  const { doing: _, ...rest } = s;
  return { ...rest, steps: [...s.steps, step] };
}
