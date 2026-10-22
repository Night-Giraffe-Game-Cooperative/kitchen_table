// Family Quiz rules. Two phases, both played in people's own time. While
// writing, everyone in the chat adds questions about themselves: the right
// answer and some wrong ones, shuffled once when saved. While answering,
// everyone answers everyone else's questions. The quiz ends when everyone who
// wrote questions has answered all the others'.
import { listNames, placings, shuffle } from '../common';
import type { Band } from '../bands';

export interface Question {
  id: string;
  /** Who wrote it, and so who it's about. */
  by: number;
  text: string;
  /** Shuffled once, when the question was saved. */
  answers: string[];
  /** Which of the answers is right. */
  right: number;
}

export interface QuizState {
  turn: 'anyone';
  /** Who started the quiz: they can start the answering before everyone has written. */
  host: number;
  /** Questions each person writes. */
  each: number;
  phase: 'writing' | 'answering';
  questions: Question[];
  /** replies[question id][person id] = the answer they tapped. */
  replies: Record<string, Record<string, number>>;
  band?: Band;
  /** Set by the server when a quiz is stopped or put away. */
  ended?: string;
}

/** What someone is writing, before it's saved. */
export interface Draft {
  text: string;
  right: string;
  wrong: string[];
}

export const MAX_QUESTION = 120;
export const MAX_ANSWER = 40;
export const EACH = [1, 2, 3];

/** Answers to choose from: two for the youngest, four from 11 up. */
export const choicesFor: Record<Band, number> = { '5-7': 2, '8-10': 3, '11-13': 4, '14+': 4 };

export function newQuiz(host: number, each: number): QuizState {
  return { turn: 'anyone', host, each: EACH.includes(each) ? each : 2, phase: 'writing', questions: [], replies: {} };
}

/** Trimmed, with runs of spaces made one, and no longer than `max`. */
export const clean = (text: string, max: number) => text.trim().replace(/\s+/g, ' ').slice(0, max).trim();

const key = (text: string, max: number) => clean(text, max).toLocaleLowerCase('en-GB');

/** The same answer, whatever the capitals and spaces. */
export const sameAnswer = (a: string, b: string) => key(a, MAX_ANSWER) === key(b, MAX_ANSWER);

export const sameQuestion = (a: string, b: string) => key(a, MAX_QUESTION) === key(b, MAX_QUESTION);

/** What a question still needs before it can be saved, in words a child can follow; null when it's ready. */
export function draftProblem(d: Draft, choices: number): string | null {
  if (!clean(d.text, MAX_QUESTION)) return 'Write a question, or tap an idea.';
  if (!clean(d.right, MAX_ANSWER)) return 'Add the right answer.';
  const wrong = d.wrong.slice(0, choices - 1);
  if (wrong.length < choices - 1 || wrong.some((w) => !clean(w, MAX_ANSWER))) return choices === 2 ? 'Add a wrong answer.' : 'Add a wrong answer in every box.';
  const all = [d.right, ...wrong].map((a) => key(a, MAX_ANSWER));
  if (new Set(all).size < all.length) return 'Two answers are the same. Make each one different.';
  return null;
}

/** A question ready to save, its answers shuffled once so the right one could be anywhere. */
export function makeQuestion(id: string, by: number, d: Draft, choices: number, random = Math.random): Question | null {
  if (draftProblem(d, choices)) return null;
  const given = [d.right, ...d.wrong.slice(0, choices - 1)].map((a) => clean(a, MAX_ANSWER));
  const order = shuffle(
    given.map((_, i) => i),
    random,
  );
  return { id, by, text: clean(d.text, MAX_QUESTION), answers: order.map((i) => given[i]), right: order.indexOf(0) };
}

export const questionsBy = (s: QuizState, id: number) => s.questions.filter((q) => q.by === id);

/** People who have written questions, in the order they first did. */
export const writers = (s: QuizState): number[] => [...new Set(s.questions.map((q) => q.by))];

/** Whether someone has written all their questions. */
export const isReady = (s: QuizState, id: number) => questionsBy(s, id).length >= s.each;

export const readyPeople = (s: QuizState) => writers(s).filter((id) => isReady(s, id));

export const askedBefore = (s: QuizState, by: number, text: string) => questionsBy(s, by).some((q) => sameQuestion(q.text, text));

/** Adds someone's question; null once the answering has started, they've written theirs, or they've asked it already. */
export function addQuestion(s: QuizState, by: number, d: Draft, choices: number, random = Math.random): QuizState | null {
  if (s.phase !== 'writing' || isReady(s, by) || askedBefore(s, by, d.text)) return null;
  const n = Math.max(0, ...questionsBy(s, by).map((q) => Number(q.id.split('-')[1]) || 0)) + 1;
  const q = makeQuestion(`${by}-${n}`, by, d, choices, random);
  return q ? { ...s, questions: [...s.questions, q] } : null;
}

/** Takes back one of your own questions while there's still time to write another. */
export function removeQuestion(s: QuizState, by: number, id: string): QuizState | null {
  if (s.phase !== 'writing' || !s.questions.some((q) => q.id === id && q.by === by)) return null;
  return { ...s, questions: s.questions.filter((q) => q.id !== id) };
}

/** People in the chat, and anyone who has written, who haven't written all their questions yet. */
export function waitingToWrite(s: QuizState, everyone: number[]): number[] {
  return [...new Set([...everyone, ...writers(s)])].filter((id) => !isReady(s, id));
}

/**
 * Whether the answering can start: at least two people's questions, and
 * everyone in the chat ready, unless this person may start early (the host).
 */
export function canStart(s: QuizState, everyone: number[], early: boolean): boolean {
  if (s.phase !== 'writing' || writers(s).length < 2) return false;
  return early || waitingToWrite(s, everyone).length === 0;
}

/** Everyone's first question, then everyone's second, so nobody's questions come all in a row. */
export function interleave(questions: Question[]): Question[] {
  const by = new Map<number, Question[]>();
  for (const q of questions) by.set(q.by, [...(by.get(q.by) ?? []), q]);
  const lists = [...by.values()];
  const out: Question[] = [];
  for (let i = 0; out.length < questions.length; i++) lists.forEach((l) => l[i] && out.push(l[i]));
  return out;
}

export function startQuiz(s: QuizState, everyone: number[], early: boolean): QuizState | null {
  if (!canStart(s, everyone, early)) return null;
  return { ...s, phase: 'answering', questions: interleave(s.questions), replies: {} };
}

/** The questions someone answers: everyone's but their own. */
export const toAnswer = (s: QuizState, id: number) => s.questions.filter((q) => q.by !== id);

export const replyOf = (s: QuizState, q: Question, id: number): number | undefined => s.replies[q.id]?.[id];

/** Questions someone still has to answer, in order. */
export function left(s: QuizState, id: number): Question[] {
  if (s.phase !== 'answering') return [];
  return toAnswer(s, id).filter((q) => replyOf(s, q, id) === undefined);
}

/** Saves someone's answer; null if it's their own question, they've answered it already, or it isn't time. */
export function reply(s: QuizState, id: number, qid: string, choice: number): QuizState | null {
  const q = s.questions.find((x) => x.id === qid);
  if (s.phase !== 'answering' || !q || q.by === id || replyOf(s, q, id) !== undefined) return null;
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.answers.length) return null;
  return { ...s, replies: { ...s.replies, [qid]: { ...s.replies[qid], [id]: choice } } };
}

/** Whether someone has answered every question they can. */
export const hasFinished = (s: QuizState, id: number) => s.phase === 'answering' && left(s, id).length === 0;

/** Writers who still have questions to answer. */
export const stillAnswering = (s: QuizState) => writers(s).filter((id) => !hasFinished(s, id));

/** The end: everyone who wrote questions has answered all the others'. */
export const everyoneFinished = (s: QuizState) => s.phase === 'answering' && writers(s).length > 0 && stillAnswering(s).length === 0;

/** Who got a question right. */
export function gotRight(s: QuizState, q: Question): number[] {
  return Object.entries(s.replies[q.id] ?? {})
    .filter(([, c]) => c === q.right)
    .map(([id]) => Number(id));
}

export interface Score {
  id: number;
  right: number;
  answered: number;
}

/** Each writer's score, and anyone else's who answered. */
export function scores(s: QuizState): Score[] {
  const out = new Map<number, Score>(writers(s).map((id) => [id, { id, right: 0, answered: 0 }]));
  for (const q of s.questions) {
    for (const [who, choice] of Object.entries(s.replies[q.id] ?? {})) {
      const id = Number(who);
      const sc = out.get(id) ?? { id, right: 0, answered: 0 };
      out.set(id, { id, answered: sc.answered + 1, right: sc.right + (choice === q.right ? 1 : 0) });
    }
  }
  return [...out.values()];
}

/** How many the family got right, of all the answers given. */
export function familyTotal(s: QuizState): { right: number; answered: number } {
  return scores(s).reduce((t, sc) => ({ right: t.right + sc.right, answered: t.answered + sc.answered }), { right: 0, answered: 0 });
}

/**
 * Who knows the family best: most right first, and on the same number right,
 * whoever needed fewer answers to get there. Anyone who answered nothing comes
 * last with no place.
 */
export function standings(s: QuizState): (Score & { place: number | null })[] {
  const all = scores(s);
  const placed = placings(
    all.filter((sc) => sc.answered > 0),
    (a, b) => b.right - a.right || a.answered - b.answered,
  );
  return [...placed.map(({ item, place }) => ({ ...item, place })), ...all.filter((sc) => !sc.answered).map((sc) => ({ ...sc, place: null }))];
}

/** The people in first place, if anyone got anything right. */
export const knowsBest = (s: QuizState) => standings(s).filter((r) => r.place === 1 && r.right > 0).map((r) => r.id);

export const totalText = (t: { right: number; answered: number }) => `The family got ${t.right} of ${t.answered} right`;

/** For the chat: "Family Quiz: the family got 14 of 18 right. Mia knows everyone best". */
export function quizSummary(s: QuizState, name: (id: number) => string): string {
  const t = familyTotal(s);
  if (!t.answered) return 'Family Quiz: nobody answered any questions';
  const head = `Family Quiz: the family got ${t.right} of ${t.answered} right`;
  const best = knowsBest(s);
  if (!best.length) return head;
  return `${head}. ${listNames(best.map(name))} ${best.length === 1 ? 'knows' : 'know'} everyone best`;
}
