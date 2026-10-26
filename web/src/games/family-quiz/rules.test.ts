import { describe, expect, it } from 'vitest';
import { BANDS } from '../bands';
import {
  addQuestion,
  begun,
  canStart,
  choicesFor,
  draftProblem,
  everyoneFinished,
  familyTotal,
  gotRight,
  hasFinished,
  interleave,
  isReady,
  knowsBest,
  left,
  makeQuestion,
  newQuiz,
  quizSummary,
  readyPeople,
  removeQuestion,
  reply,
  standings,
  startQuiz,
  stillAnswering,
  waitingToWrite,
  type Draft,
  type QuizState,
} from './rules';
import { anotherChip, chipSets, fromChip, startersFor } from './starters';

/** A repeatable stand-in for Math.random (mulberry32). */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MUM = 1;
const DAD = 2;
const MIA = 3;
const GRAN = 4;
const names: Record<number, string> = { [MUM]: 'Mum', [DAD]: 'Dad', [MIA]: 'Mia', [GRAN]: 'Gran' };

const draft = (text: string, right: string, ...wrong: string[]): Draft => ({ text, right, wrong });

/** A quiz where each person writes `each` three-choice questions, then the answering starts. */
function quizWith(people: number[], each = 1): QuizState {
  let s = newQuiz(people[0], each);
  for (const id of people) {
    for (let n = 1; n <= each; n++) s = addQuestion(s, id, draft(`Question ${n} about ${names[id]}?`, 'Right', 'Wrong one', 'Wrong two'), 3)!;
  }
  return startQuiz(s, people, true)!;
}

/** Answers every question someone has left: right for the first `rightCount`, wrong after. */
function answerAll(s: QuizState, id: number, rightCount = Infinity): QuizState {
  let n = 0;
  for (const q of left(s, id)) {
    const choice = n++ < rightCount ? q.right : (q.right + 1) % q.answers.length;
    s = reply(s, id, q.id, choice)!;
  }
  return s;
}

describe('Family Quiz writing', () => {
  it('makes a whole question from a starter with taps alone', () => {
    for (const band of BANDS) {
      const choices = choicesFor[band];
      const starter = startersFor[band].find((st) => st.chips)!;
      const chips = chipSets[starter.chips!];
      const { right, wrong } = fromChip(starter.chips!, chips[0], choices, seeded(7));
      expect(right).toBe(chips[0]);
      expect(wrong).toHaveLength(choices - 1);
      expect(new Set(wrong).size).toBe(wrong.length);
      expect(wrong.every((w) => chips.includes(w) && w !== right)).toBe(true);
      expect(draftProblem({ text: starter.text, right, wrong }, choices)).toBeNull();
    }
  });

  it('gives the youngest two answers to choose from and the oldest four', () => {
    expect(BANDS.map((b) => choicesFor[b])).toEqual([2, 3, 4, 4]);
  });

  it('swaps a wrong answer for another from the same list, until the list runs out', () => {
    const used = ['🌷 Spring', '☀️ Summer', '🍂 Autumn'];
    expect(anotherChip('seasons', used, seeded(1))).toBe('⛄ Winter');
    expect(anotherChip('seasons', [...used, '⛄ winter'])).toBeNull();
    for (let i = 0; i < 20; i++) expect(['🔴 Red', '🔵 Blue']).not.toContain(anotherChip('colours', ['🔴 Red', '🔵 Blue'], seeded(i)));
  });

  it('has an answer list big enough for every question idea it comes with', () => {
    for (const band of BANDS) {
      for (const st of startersFor[band]) if (st.chips) expect(chipSets[st.chips].length).toBeGreaterThanOrEqual(choicesFor[band]);
    }
  });

  it('says what a question still needs, with no empty or matching answers', () => {
    expect(draftProblem(draft('  ', 'Pizza', 'Pasta'), 2)).toMatch(/Write a question/);
    expect(draftProblem(draft('Food?', ' ', 'Pasta'), 2)).toMatch(/right answer/);
    expect(draftProblem(draft('Food?', 'Pizza', 'Pasta', ''), 3)).toMatch(/every box/);
    expect(draftProblem(draft('Food?', 'Pizza', 'pizza '), 2)).toMatch(/the same/);
    expect(draftProblem(draft('Food?', 'Pizza', 'Pasta', 'Chips', 'Soup'), 3)).toBeNull();
  });

  it('knows when a question has been started, so the writer can be told if the quiz starts without it', () => {
    expect(begun(draft('', '', '', ''))).toBe(false);
    expect(begun(draft('  ', ' ', ''))).toBe(false);
    expect(begun(draft('Food?', '', ''))).toBe(true);
    expect(begun(draft('', '', '', 'Soup'))).toBe(true);
  });

  it('trims and shortens what was typed', () => {
    const q = makeQuestion('1-1', MUM, draft('  What   do I like?  ', '  Very   long answer '.repeat(5), 'No'), 2)!;
    expect(q.text).toBe('What do I like?');
    expect(q.answers.every((a) => a.length <= 40 && a === a.trim())).toBe(true);
  });

  it('shuffles the answers once and keeps the right answer right', () => {
    const where = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const q = makeQuestion('1-1', MUM, draft('Favourite food?', 'Pizza', 'Pasta', 'Chips', 'Soup'), 4, seeded(i))!;
      expect(q.answers[q.right]).toBe('Pizza');
      expect([...q.answers].sort()).toEqual(['Chips', 'Pasta', 'Pizza', 'Soup']);
      where.add(q.right);
    }
    expect(where.size).toBe(4);
  });

  it('takes each person’s questions until they have written theirs', () => {
    let s = newQuiz(MUM, 2);
    s = addQuestion(s, MUM, draft('Colour?', 'Red', 'Blue', 'Green'), 3)!;
    expect(addQuestion(s, MUM, draft('colour? ', 'Red', 'Blue', 'Green'), 3)).toBeNull(); // asked already
    expect(isReady(s, MUM)).toBe(false);
    s = addQuestion(s, MUM, draft('Animal?', 'Cat', 'Dog', 'Fox'), 3)!;
    expect(isReady(s, MUM)).toBe(true);
    expect(addQuestion(s, MUM, draft('Food?', 'Pizza', 'Pasta', 'Chips'), 3)).toBeNull();
    expect(s.questions.map((q) => q.id)).toEqual(['1-1', '1-2']);

    s = removeQuestion(s, MUM, '1-1')!;
    expect(removeQuestion(s, DAD, '1-2')).toBeNull(); // not his
    s = addQuestion(s, MUM, draft('Food?', 'Pizza', 'Pasta', 'Chips'), 3)!;
    expect(new Set(s.questions.map((q) => q.id)).size).toBe(2);
  });

  it('lets the host start with two people ready, and anyone once everyone in the chat is', () => {
    const everyone = [MUM, DAD, MIA];
    let s = newQuiz(MUM, 1);
    s = addQuestion(s, MUM, draft('Colour?', 'Red', 'Blue'), 2)!;
    expect(canStart(s, everyone, true)).toBe(false); // only one person's questions
    s = addQuestion(s, DAD, draft('Colour?', 'Green', 'Blue'), 2)!;
    expect(readyPeople(s)).toEqual([MUM, DAD]);
    expect(waitingToWrite(s, everyone)).toEqual([MIA]);
    expect(canStart(s, everyone, true)).toBe(true);
    expect(canStart(s, everyone, false)).toBe(false);
    expect(startQuiz(s, everyone, false)).toBeNull();
    s = addQuestion(s, MIA, draft('Animal?', 'Cat', 'Dog'), 2)!;
    expect(canStart(s, everyone, false)).toBe(true);
    const started = startQuiz(s, everyone, false)!;
    expect(started.phase).toBe('answering');
    expect(addQuestion(started, GRAN, draft('Animal?', 'Cat', 'Dog'), 2)).toBeNull();
    expect(startQuiz(started, everyone, true)).toBeNull();
  });

  it('mixes up whose question comes next', () => {
    const q = (id: string, by: number) => ({ id, by, text: id, answers: ['a', 'b'], right: 0 });
    const order = interleave([q('1-1', MUM), q('1-2', MUM), q('2-1', DAD), q('3-1', MIA), q('2-2', DAD), q('3-2', MIA)]);
    expect(order.map((x) => x.id)).toEqual(['1-1', '2-1', '3-1', '1-2', '2-2', '3-2']);
  });
});

describe('Family Quiz answering', () => {
  it("answers everyone's questions but your own, once each", () => {
    const s = quizWith([MUM, DAD, MIA], 2);
    expect(left(s, MUM).map((q) => q.by)).toEqual([DAD, MIA, DAD, MIA]);
    const mine = s.questions.find((q) => q.by === MUM)!;
    const dads = s.questions.find((q) => q.by === DAD)!;
    expect(reply(s, MUM, mine.id, 0)).toBeNull();
    const next = reply(s, MUM, dads.id, dads.right)!;
    expect(reply(next, MUM, dads.id, 0)).toBeNull();
    expect(reply(next, MUM, 'nope', 0)).toBeNull();
    expect(reply(next, DAD, mine.id, 9)).toBeNull();
    expect(gotRight(next, dads)).toEqual([MUM]);
    expect(left(next, MUM)).toHaveLength(3);
  });

  it('knows who has finished and who is still answering', () => {
    let s = quizWith([MUM, DAD, MIA]);
    expect(stillAnswering(s)).toEqual([MUM, DAD, MIA]);
    s = answerAll(s, MUM);
    expect(hasFinished(s, MUM)).toBe(true);
    expect(hasFinished(s, DAD)).toBe(false);
    expect(stillAnswering(s)).toEqual([DAD, MIA]);
    expect(everyoneFinished(s)).toBe(false);
  });

  it('ends when everyone who wrote has answered, without waiting for anyone else', () => {
    let s = quizWith([MUM, DAD]);
    s = answerAll(s, MUM);
    expect(everyoneFinished(s)).toBe(false);
    s = answerAll(s, GRAN, 1); // Gran wrote nothing, but can still answer
    expect(everyoneFinished(s)).toBe(false);
    s = answerAll(s, DAD);
    expect(everyoneFinished(s)).toBe(true);
    expect(everyoneFinished(newQuiz(MUM, 1))).toBe(false);
  });

  it('adds up the family total and who knows everyone best', () => {
    let s = quizWith([MUM, DAD, MIA], 3); // 9 questions, each person answers 6
    s = answerAll(s, MIA, 6);
    s = answerAll(s, MUM, 4);
    s = answerAll(s, DAD, 4);
    expect(familyTotal(s)).toEqual({ right: 14, answered: 18 });
    expect(standings(s).map((r) => [r.id, r.place, r.right])).toEqual([
      [MIA, 1, 6],
      [MUM, 2, 4],
      [DAD, 2, 4],
    ]);
    expect(knowsBest(s)).toEqual([MIA]);
    expect(quizSummary(s, (id) => names[id])).toBe('Family Quiz: the family got 14 of 18 right. Mia knows everyone best');
  });

  it('puts fewer answers ahead on the same number right, and nobody first with none right', () => {
    let s = quizWith([MUM, DAD, MIA], 2);
    s = answerAll(s, MUM, 2);
    s = reply(s, DAD, left(s, DAD)[0].id, left(s, DAD)[0].right)!;
    s = reply(s, DAD, left(s, DAD)[0].id, left(s, DAD)[0].right)!;
    const r = standings(s);
    expect(r.map((x) => [x.id, x.place, x.answered])).toEqual([
      [DAD, 1, 2],
      [MUM, 2, 4],
      [MIA, null, 0],
    ]);

    let none = quizWith([MUM, DAD]);
    none = answerAll(none, MUM, 0);
    none = answerAll(none, DAD, 0);
    expect(knowsBest(none)).toEqual([]);
    expect(quizSummary(none, (id) => names[id])).toBe('Family Quiz: the family got 0 of 2 right');
  });

  it('shares the top place on a tie', () => {
    let s = quizWith([MUM, DAD]);
    s = answerAll(s, MUM);
    s = answerAll(s, DAD);
    expect(knowsBest(s)).toEqual([MUM, DAD]);
    expect(quizSummary(s, (id) => names[id])).toBe('Family Quiz: the family got 2 of 2 right. Mum and Dad know everyone best');
    expect(quizSummary(quizWith([MUM, DAD]), (id) => names[id])).toBe('Family Quiz: nobody answered any questions');
  });
});
