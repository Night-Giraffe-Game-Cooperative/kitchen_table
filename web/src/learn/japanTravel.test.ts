import { describe, expect, it } from 'vitest';
import { keyOf } from './phrases';
import { ROAD_TEST, TRAIN_QUIZ, roadRules, roadSigns, signQuestion, trainQuestions } from './japanTravel';

const serverKey = /^(ja|fr)\.[a-z0-9_.]{1,40}$/;

describe('Japan travel', () => {
  it('saves road signs and passes under keys the server keeps', () => {
    for (const s of roadSigns) expect(keyOf('ja', `road.${s.id}`)).toMatch(serverKey);
    expect(keyOf('ja', ROAD_TEST)).toMatch(serverKey);
    expect(keyOf('ja', TRAIN_QUIZ)).toMatch(serverKey);
  });

  it('never gives two signs the same answer', () => {
    expect(new Set(roadSigns.map((s) => s.en)).size).toBe(roadSigns.length);
    expect(new Set(roadSigns.map((s) => s.id)).size).toBe(roadSigns.length);
  });

  for (const [name, questions] of [
    ['road rules', roadRules],
    ['bullet trains', trainQuestions],
  ] as const) {
    it(`${name}: every question has one right answer and at least two wrong ones`, () => {
      expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
      for (const q of questions) {
        expect(q.wrong.length).toBeGreaterThanOrEqual(2);
        expect(q.wrong).not.toContain(q.right);
        expect(q.why.trim()).not.toBe('');
      }
    });
  }

  it('asks about a sign with the others as wrong answers', () => {
    const q = signQuestion(roadSigns[0], roadSigns);
    expect(q.right).toBe(roadSigns[0].en);
    expect(q.wrong).toHaveLength(roadSigns.length - 1);
    expect(q.wrong).not.toContain(q.right);
  });

  it('has enough for a ten-question road test and an eight-question train quiz', () => {
    expect(roadSigns.length).toBeGreaterThanOrEqual(4);
    expect(roadRules.length).toBeGreaterThanOrEqual(6);
    expect(trainQuestions.length).toBeGreaterThanOrEqual(8);
  });
});
