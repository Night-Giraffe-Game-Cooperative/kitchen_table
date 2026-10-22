// Family Quiz: how well do we know each other? Everyone in the chat writes a
// few questions about themselves, with the right answer and some wrong ones.
// Then, each in their own time, everyone answers everyone else's, and at the
// end the family sees how many they got right and who knows everyone best.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { confirmFirst } from '../../components/confirm';
import { Avatar, Button, Field, IconButton, Input, Segmented } from '../../components/ui';
import type { Game, Me, Person, Room } from '../../lib/types';
import type { GameDef, GameProps, OptionsProps } from '../common';
import { listNames, nameOf, startGame } from '../common';
import { bandOf, type Band } from '../bands';
import { TipNote, useLearn, useTips, type Lesson, type Tip } from '../learn';
import { Standings } from '../word-garden/Players';
import {
  EACH,
  MAX_ANSWER,
  MAX_QUESTION,
  addQuestion,
  canStart,
  choicesFor,
  draftProblem,
  everyoneFinished,
  familyTotal,
  gotRight,
  hasFinished,
  isReady,
  knowsBest,
  left,
  newQuiz,
  questionsBy,
  quizSummary,
  readyPeople,
  removeQuestion,
  reply,
  replyOf,
  sameAnswer,
  sameQuestion,
  scores,
  standings,
  startQuiz,
  stillAnswering,
  toAnswer,
  totalText,
  waitingToWrite,
  writers,
  type Draft,
  type Question,
  type QuizState,
} from './rules';
import { anotherChip, chipSets, fromChip, startersFor, type ChipSet, type Starter } from './starters';

type State = QuizState;

interface Options {
  each: number;
}

const TYPE = 'family_quiz';

const TIPS = {
  write: {
    key: 'write',
    basic: true,
    text: 'Ask something about you that the others might know, or could guess. Like your favourite animal, or what you want to be.',
  },
  shuffled: {
    key: 'shuffled',
    basic: true,
    text: "Don't worry about where the right answer goes. The answers get mixed up when you save, so it could be anywhere.",
  },
  wrong: { key: 'wrong', text: "Make the wrong answers believable too, so it isn't too easy." },
  secret: { key: 'secret', text: 'Your questions stay secret. Nobody else sees them until the quiz starts.' },
  start: {
    key: 'start',
    text: "There are enough questions to start. Anyone who hasn't written theirs can still answer everyone else's.",
  },
  own: { key: 'own', basic: true, text: "You won't see your own questions here. They're for everyone else to answer." },
  guess: { key: 'guess', text: "Not sure? Have a guess. Think about what you've seen them do and heard them say." },
  waiting: { key: 'waiting', text: 'Your answers are saved. Everyone sees how they did when the last person finishes.' },
} satisfies Record<string, Tip>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Everyone in the chat who may play, me included when I may. */
function chatPlayers(room: Room | undefined, me: Me, people: Map<number, Person>): number[] {
  if (!room) return [];
  return room.member_ids.filter((id) => {
    if (id === me.id) return me.permissions.play_games;
    const p = people.get(id);
    return !!p && p.active !== false && p.permissions?.play_games !== false;
  });
}

/** Whether someone may start the answering before everyone has written: the host, or anyone once the host has left the chat. */
const mayStartEarly = (s: State, me: number, room: Room | undefined) => me === s.host || (!!room && !room.member_ids.includes(s.host));

/** "You, Mia and Dad": names in a sentence, with me first. */
function namesWithMe(ids: number[], me: number, people: Map<number, Person>): string {
  const sorted = [...ids.filter((id) => id === me), ...ids.filter((id) => id !== me)];
  return listNames(sorted.map((id) => nameOf(people, id, me)));
}

/** "Mia hasn't" or "Mia and Dad haven't": who is still going, for sentences about them. */
function stillGoing(ids: number[], me: number, people: Map<number, Person>, [one, many]: [string, string]): string {
  return `${namesWithMe(ids, me, people)} ${ids.length === 1 && ids[0] !== me ? one : many}`;
}

/** One short line about where the quiz is at, above the board and in lists. */
function statusLine(game: Game<State>, me: number, people: Map<number, Person>, canPlay = true): string {
  const s = game.state;
  if (game.status === 'finished') {
    const total = familyTotal(s);
    if (total.answered) return totalText(total);
    return s.ended === 'idle' ? 'Put away before anyone answered' : 'Stopped before anyone answered';
  }
  if (s.phase === 'writing') {
    const ready = `${plural(readyPeople(s).length, 'person', 'people')} ready`;
    return canPlay && !isReady(s, me) ? `Your turn to write · ${ready}` : `Writing questions · ${ready}`;
  }
  const mine = left(s, me).length;
  if (canPlay && mine) return `Your turn to answer · ${mine} left`;
  const waiting = stillAnswering(s).filter((id) => id !== me);
  return waiting.length ? `Waiting for ${listNames(waiting.map((id) => nameOf(people, id)))} to finish` : 'Nearly done';
}

function Board({ game, play, me, people, room }: GameProps<State>) {
  const s = game.state;
  const done = game.status === 'finished';
  const band = bandOf(s);
  const learn = useLearn(TYPE);
  const tips = useTips(TYPE, { band, learn });
  const canPlay = me.permissions.play_games && !done;
  // The question just answered stays on the table, with its tick or cross, until Next.
  const [pinned, setPinned] = useState<string | null>(null);
  const everyone = chatPlayers(room, me, people);
  const early = mayStartEarly(s, me.id, room);
  const written = questionsBy(s, me.id).length;
  const answered = s.phase === 'answering' ? toAnswer(s, me.id).length - left(s, me.id).length : 0;
  const finishedMe = hasFinished(s, me.id);
  const startable = canStart(s, everyone, early);

  // A writing tip is no use once the answering starts.
  useEffect(() => tips.dismiss(), [s.phase]);

  useEffect(() => {
    if (!canPlay) return void tips.dismiss();
    if (s.phase === 'writing') {
      if (written === 0) tips.offer(TIPS.write);
      else tips.offer(TIPS.shuffled, startable ? TIPS.start : written >= s.each ? TIPS.secret : TIPS.wrong);
    } else if (finishedMe) tips.offer(TIPS.waiting);
    else if (answered === 0) tips.offer(written ? TIPS.own : null);
    else if (answered >= 2) tips.offer(TIPS.guess);
    // When a question is written or answered, or the quiz moves on.
  }, [s.phase, written, answered, finishedMe, startable, canPlay, tips.offer]);

  return (
    <div className="fq">
      <p className="game-status" aria-live="polite">
        {statusLine(game, me.id, people, me.permissions.play_games)}
      </p>
      {canPlay && <TipNote tip={tips.tip} onClose={tips.dismiss} />}
      {s.phase === 'writing' && !done ? (
        <Writing game={game} play={play} me={me} people={people} room={room} everyone={everyone} early={early} learn={learn} />
      ) : !done || pinned ? (
        <Answering game={game} play={play} me={me} people={people} room={room} pinned={pinned} setPinned={setPinned} learn={learn} />
      ) : (
        <Results game={game} me={me} people={people} />
      )}
    </div>
  );
}

const personOf = (id: number, me: Me, people: Map<number, Person>) => people.get(id) ?? (id === me.id ? me : undefined);

/** People in a row of paper tags: who has written their questions, or how far each has got with answering. */
function PeopleList({
  ids,
  label,
  me,
  people,
  detail,
  done,
}: {
  ids: number[];
  label: string;
  me: Me;
  people: Map<number, Person>;
  detail: (id: number) => ReactNode;
  done: (id: number) => boolean;
}) {
  if (!ids.length) return null;
  return (
    <ul className="fq-people" aria-label={label}>
      {ids.map((id) => {
        const p = personOf(id, me, people);
        return (
          <li key={id} className={`fq-person tint-${p?.colour ?? 'slate'}`} data-done={done(id) || undefined}>
            <Avatar person={p} size="sm" />
            <span className="fq-person-text">
              <span className="fq-person-name">{nameOf(people, id, me.id)}</span>
              <span className="fq-person-detail">{detail(id)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Writing ---------- */

function Writing({
  game,
  play,
  me,
  people,
  room,
  everyone,
  early,
  learn,
}: GameProps<State> & { everyone: number[]; early: boolean; learn: boolean }) {
  const s = game.state;
  const band = bandOf(s);
  const canPlay = me.permissions.play_games;
  const mine = questionsBy(s, me.id);
  const notYet = waitingToWrite(s, everyone);
  const startable = canPlay && canStart(s, everyone, early);
  const who = [...new Set([...everyone, ...writers(s)])];

  function save(d: Draft) {
    return play.move((st, g) => {
      const next = g.status === 'active' ? addQuestion(st, me.id, d, choicesFor[bandOf(st)]) : null;
      return next ? { state: next } : null;
    });
  }

  async function remove(q: Question) {
    if (!(await confirmFirst('Take this question back?', 'Take it back', q.text))) return;
    play.move((st, g) => {
      const next = g.status === 'active' ? removeQuestion(st, me.id, q.id) : null;
      return next ? { state: next } : null;
    });
  }

  async function start() {
    if (notYet.length) {
      const body = `${stillGoing(notYet, me.id, people, ["hasn't", "haven't"])} finished writing yet, but can still answer everyone else's questions.`;
      if (!(await confirmFirst('Start the quiz now?', 'Start the quiz', body))) return;
    }
    play.move((st, g) => {
      const next = g.status === 'active' ? startQuiz(st, chatPlayers(room, me, people), mayStartEarly(st, me.id, room)) : null;
      return next ? { state: next } : null;
    });
  }

  return (
    <>
      <PeopleList
        ids={who}
        label="Who has written their questions"
        me={me}
        people={people}
        done={(id) => isReady(s, id)}
        detail={(id) => {
          const n = questionsBy(s, id).length;
          return n >= s.each ? '✓ Ready' : n ? `${n} of ${s.each} written` : 'Not yet';
        }}
      />

      {canPlay && mine.length > 0 && <MyQuestions questions={mine} busy={play.busy} onRemove={remove} />}

      {canPlay && mine.length < s.each && (
        <QuestionWriter
          band={band}
          guided={learn || band === '5-7' || band === '8-10'}
          asked={mine.map((q) => q.text)}
          heading={s.each > 1 ? `Question ${mine.length + 1} of ${s.each} about you` : 'A question about you'}
          colour={me.colour}
          busy={play.busy}
          onSave={save}
        />
      )}

      {canPlay && mine.length >= s.each && (
        <p className="notice notice-success">✓ Your questions are ready. Nobody else can see them until the quiz starts.</p>
      )}
      {!canPlay && <p className="notice notice-info">You're watching this one. Everyone is writing questions about themselves.</p>}

      <div className="fq-start">
        {startable ? (
          <>
            <Button variant="primary" size="lg" icon="sparkle" busy={play.busy} onClick={start}>
              Start the quiz
            </Button>
            <p className="muted">
              {notYet.length ? `${stillGoing(notYet, me.id, people, ["hasn't", "haven't"])} finished writing yet.` : 'Everyone is ready!'}
            </p>
          </>
        ) : (
          <p className="muted">
            {writers(s).length < 2
              ? 'The quiz can start once at least two people have written questions.'
              : `${nameOf(people, s.host)} can start the quiz now, or anyone can once everyone is ready.`}
          </p>
        )}
      </div>
    </>
  );
}

/** My own questions, which only I can see until the end, with a way to take one back. */
function MyQuestions({ questions, busy, onRemove }: { questions: Question[]; busy: boolean; onRemove: (q: Question) => void }) {
  const id = useId();
  return (
    <section className="fq-mine" aria-labelledby={id}>
      <h2 id={id} className="fq-section-title">
        Your questions <span className="muted fq-quiet">· only you can see these</span>
      </h2>
      <ul className="fq-mine-list">
        {questions.map((q) => (
          <li key={q.id} className="fq-mine-item sheet">
            <div className="fq-mine-body">
              <p className="fq-mine-q">{q.text}</p>
              <ul className="fq-mine-answers" aria-label="Answers">
                {q.answers.map((a, i) => (
                  <li key={i} data-right={i === q.right || undefined}>
                    {i === q.right && <span className="sr-only">Right answer: </span>}
                    {a}
                  </li>
                ))}
              </ul>
            </div>
            <IconButton icon="trash" label={`Take back "${q.text}"`} disabled={busy} onClick={() => onRemove(q)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface WriterDraft extends Draft {
  /** The answers to tap, from the question idea last tapped. */
  set: ChipSet | null;
}

const blank = (choices: number): WriterDraft => ({ text: '', set: null, right: '', wrong: Array(choices - 1).fill('') });

/**
 * Writing one question: tap an idea or type one, tap or type the right
 * answer, and the wrong ones. With an idea's answer list, tapping the right
 * answer fills in the wrong ones too, so it can all be done with taps.
 */
function QuestionWriter({
  band,
  guided,
  asked,
  heading,
  colour,
  busy,
  onSave,
}: {
  band: Band;
  /** Hints at every step: for the younger bands and learn mode. */
  guided: boolean;
  asked: string[];
  heading: string;
  colour: string;
  busy: boolean;
  onSave: (d: Draft) => Promise<boolean>;
}) {
  const choices = choicesFor[band];
  const [d, setD] = useState<WriterDraft>(() => blank(choices));
  const [tried, setTried] = useState(false);
  const id = useId();
  const ideas = startersFor[band].filter((st) => !asked.some((a) => sameQuestion(a, st.text)));
  const chips = d.set ? chipSets[d.set] : null;
  const used = [d.right, ...d.wrong];
  const spare = !!chips && chips.some((c) => !used.some((u) => sameAnswer(u, c)));
  const problem = asked.some((a) => sameQuestion(a, d.text)) ? "You've asked that one already. Try another." : draftProblem(d, choices);
  const wrongHint = !chips
    ? "Make them believable, so it isn't too easy."
    : d.wrong.some((w) => w.trim())
      ? `Picked for you from the list. Tap the arrows to swap ${choices === 2 ? 'it' : 'one'}, or type your own.`
      : 'These fill in by themselves when you tap the right answer. Or type your own.';

  function idea(st: Starter) {
    const set = st.chips ?? null;
    setD((cur) => (set === cur.set ? { ...cur, text: st.text } : { text: st.text, set, right: '', wrong: Array(choices - 1).fill('') }));
    setTried(false);
  }

  function tapRight(chip: string) {
    if (!d.set) return;
    const { right, wrong } = fromChip(d.set, chip, choices);
    setD({ ...d, right, wrong });
  }

  function swap(i: number) {
    const next = d.set ? anotherChip(d.set, used) : null;
    if (next) setD({ ...d, wrong: d.wrong.map((w, j) => (j === i ? next : w)) });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problem || busy) return;
    if (await onSave(d)) {
      setD(blank(choices));
      setTried(false);
    }
  }

  return (
    <form className={`fq-card fq-writer sheet tint-${colour}`} onSubmit={submit} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="fq-writer-title">
        ✏️ {heading}
      </h2>

      <Field label="1. Your question" hint={guided ? 'Tap an idea, or type your own.' : undefined}>
        {(p) => (
          <Input
            {...p}
            value={d.text}
            maxLength={MAX_QUESTION}
            autoComplete="off"
            placeholder="What's my favourite…?"
            onChange={(e) => setD({ ...d, text: e.target.value })}
          />
        )}
      </Field>
      {ideas.length > 0 && (
        <div className="fq-chips" role="group" aria-label="Question ideas">
          {ideas.map((st) => (
            <button key={st.text} type="button" className="fq-chip fq-idea" aria-pressed={sameQuestion(st.text, d.text)} onClick={() => idea(st)}>
              {st.text}
            </button>
          ))}
        </div>
      )}

      <Field label="2. The right answer" hint={guided ? (chips ? 'Tap the true answer below, or type it.' : 'Type the true answer.') : undefined}>
        {(p) => <Input {...p} value={d.right} maxLength={MAX_ANSWER} autoComplete="off" onChange={(e) => setD({ ...d, right: e.target.value })} />}
      </Field>
      {chips && (
        <div className="fq-chips" role="group" aria-label="Tap the right answer">
          {chips.map((c) => (
            <button key={c} type="button" className="fq-chip" aria-pressed={sameAnswer(c, d.right)} onClick={() => tapRight(c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      <fieldset className="fieldset fq-wrong" aria-describedby={`${id}-wrong`}>
        <legend className="field-label">{choices === 2 ? '3. A wrong answer' : '3. Wrong answers'}</legend>
        <p className="field-hint" id={`${id}-wrong`}>
          {wrongHint}
        </p>
        {d.wrong.map((w, i) => (
          <div key={i} className="fq-wrong-row">
            <Input
              value={w}
              aria-label={choices === 2 ? 'Wrong answer' : `Wrong answer ${i + 1}`}
              maxLength={MAX_ANSWER}
              autoComplete="off"
              onChange={(e) => setD({ ...d, wrong: d.wrong.map((x, j) => (j === i ? e.target.value : x)) })}
            />
            {chips && (
              <IconButton
                icon="refresh"
                label={choices === 2 ? 'Swap the wrong answer' : `Swap wrong answer ${i + 1}`}
                disabled={!spare}
                onClick={() => swap(i)}
              />
            )}
          </div>
        ))}
      </fieldset>

      <div className="fq-writer-foot">
        <Button type="submit" variant="primary" icon="check" busy={busy}>
          Save my question
        </Button>
        <p className="fq-problem" aria-live="polite">
          {tried && problem ? problem : ''}
        </p>
      </div>
    </form>
  );
}

/* ---------- Answering ---------- */

function Answering({
  game,
  play,
  me,
  people,
  pinned,
  setPinned,
  learn,
}: GameProps<State> & { pinned: string | null; setPinned: (id: string | null) => void; learn: boolean }) {
  const s = game.state;
  const done = game.status === 'finished';
  const canPlay = me.permissions.play_games && !done;
  const all = toAnswer(s, me.id);
  const todo = left(s, me.id);
  const q = (pinned ? s.questions.find((x) => x.id === pinned) : undefined) ?? (canPlay ? todo[0] : undefined);
  // Focus follows the quiz along once someone presses Next, but not when the page first opens.
  const [moved, setMoved] = useState(false);
  const waiting = stillAnswering(s).filter((id) => id !== me.id);
  const who = [...new Set([...writers(s), ...scores(s).map((sc) => sc.id)])];
  const myScore = scores(s).find((sc) => sc.id === me.id);

  function answer(qid: string, choice: number) {
    setPinned(qid);
    play
      .move((st, g) => {
        const next = g.status === 'active' ? reply(st, me.id, qid, choice) : null;
        if (!next) return null;
        return everyoneFinished(next) ? { state: next, status: 'finished', summary: quizSummary(next, (id) => nameOf(people, id)) } : { state: next };
      })
      .then((ok) => !ok && setPinned(null));
  }

  function next() {
    setPinned(null);
    setMoved(true);
  }

  async function showNow() {
    const body = `${stillGoing(waiting, me.id, people, ["hasn't", "haven't"])} finished yet. Once the answers show, nobody can answer any more.`;
    if (!(await confirmFirst('Show the answers now?', 'Show the answers', body))) return;
    play.move((st, g) => {
      if (g.status !== 'active' || st.phase !== 'answering' || !hasFinished(st, me.id)) return null;
      return { state: st, status: 'finished', summary: quizSummary(st, (id) => nameOf(people, id)) };
    });
  }

  return (
    <>
      {q ? (
        <AnswerCard
          key={q.id}
          q={q}
          s={s}
          me={me}
          people={people}
          at={all.findIndex((x) => x.id === q.id) + 1}
          of={all.length}
          busy={play.busy}
          ended={done}
          last={!todo.some((x) => x.id !== q.id)}
          focus={moved}
          learn={learn}
          onAnswer={(choice) => answer(q.id, choice)}
          onNext={next}
        />
      ) : canPlay ? (
        <AllAnswered focus={moved} score={myScore} waiting={waiting} me={me} people={people} busy={play.busy} onShowNow={showNow} />
      ) : (
        !done && <p className="notice notice-info">You're watching this one. The answers show when everyone has finished.</p>
      )}

      {!done && (
        <PeopleList
          ids={who}
          label="How everyone is getting on"
          me={me}
          people={people}
          done={(id) => hasFinished(s, id)}
          detail={(id) => {
            const total = toAnswer(s, id).length;
            return hasFinished(s, id) ? '✓ Finished' : `${total - left(s, id).length} of ${total} answered`;
          }}
        />
      )}
    </>
  );
}

/** One question on its paper card, in the asker's colour, with a big button for each answer. */
function AnswerCard({
  q,
  s,
  me,
  people,
  at,
  of,
  busy,
  ended,
  last,
  focus,
  learn,
  onAnswer,
  onNext,
}: {
  q: Question;
  s: State;
  me: Me;
  people: Map<number, Person>;
  at: number;
  of: number;
  busy: boolean;
  /** The quiz finished with this answer. */
  ended: boolean;
  last: boolean;
  focus: boolean;
  learn: boolean;
  onAnswer: (choice: number) => void;
  onNext: () => void;
}) {
  const asker = personOf(q.by, me, people);
  const name = nameOf(people, q.by);
  const chose = replyOf(s, q, me.id);
  const answered = chose !== undefined;
  const right = chose === q.right;
  const headId = useId();
  const head = useRef<HTMLHeadingElement>(null);
  const foot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus) head.current?.focus();
  }, []);

  // The answer buttons switch off once answered, so Next takes the focus.
  useEffect(() => {
    if (answered) foot.current?.querySelector('button')?.focus();
  }, [answered]);

  return (
    <article className={`fq-card fq-ask sheet tint-${asker?.colour ?? 'slate'}`} aria-labelledby={headId}>
      <header className="fq-card-head">
        <Avatar person={asker} size="md" />
        <span className="fq-asker">{name} asks</span>
        <span className="fq-progress">
          Question {at} of {of}
        </span>
      </header>
      <h2 id={headId} ref={head} tabIndex={-1} className="fq-question">
        {q.text}
      </h2>
      {learn && !answered && <p className="muted">Tap the answer you think is true for {name}. Not sure? Have a guess.</p>}
      <div className="fq-answers" role="group" aria-labelledby={headId} data-answered={answered || undefined}>
        {q.answers.map((a, i) => {
          const mine = chose === i;
          const isRight = answered && i === q.right;
          return (
            <button
              key={i}
              type="button"
              className="fq-answer"
              data-right={isRight || undefined}
              data-wrong={(mine && !right) || undefined}
              disabled={answered || busy || ended}
              onClick={() => onAnswer(i)}
            >
              <span className="fq-answer-text">{a}</span>
              {(isRight || mine) && (
                <>
                  <span className="fq-mark" aria-hidden="true">
                    {isRight ? '✓' : '✗'}
                  </span>
                  <span className="sr-only">{mine && isRight ? ', your answer, right' : mine ? ', your answer' : ', the right answer'}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <p className="fq-feedback" role="status" data-right={answered ? right : undefined}>
        {answered ? (right ? 'You got it! 🎉' : `Not quite. It was ${q.answers[q.right]}.`) : ''}
      </p>
      {answered && (
        <div className="fq-card-foot" ref={foot}>
          <Button variant="primary" size="lg" icon={ended ? 'star' : 'forward'} onClick={onNext}>
            {ended ? 'See all the answers' : last ? 'See how I did' : 'Next question'}
          </Button>
        </div>
      )}
    </article>
  );
}

/** When I've answered everything: my score, and who we're waiting for. */
function AllAnswered({
  focus,
  score,
  waiting,
  me,
  people,
  busy,
  onShowNow,
}: {
  focus: boolean;
  score: { right: number; answered: number } | undefined;
  waiting: number[];
  me: Me;
  people: Map<number, Person>;
  busy: boolean;
  onShowNow: () => void;
}) {
  const head = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focus) head.current?.focus();
  }, []);
  return (
    <div className="result sheet fq-done">
      <p className="fq-results-art" aria-hidden="true">
        🙌
      </p>
      <p className="result-big" ref={head} tabIndex={-1}>
        You've answered them all!
      </p>
      {score && (
        <p>
          You got {score.right} of {score.answered} right.
        </p>
      )}
      {waiting.length > 0 && (
        <>
          <p className="muted">
            🦒 The Night Giraffe is keeping the answers safe until {stillGoing(waiting, me.id, people, ['has', 'have'])} finished.
          </p>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onShowNow}>
            Show the answers now
          </Button>
        </>
      )}
    </div>
  );
}

/* ---------- The end ---------- */

function cheer(share: number): string {
  if (share === 1) return 'Every single one! Even the Night Giraffe is impressed. 🦒';
  if (share >= 0.75) return 'What a team! You know each other really well.';
  if (share >= 0.5) return 'Not bad at all! You know each other quite well.';
  return 'Lots of new things to find out about each other!';
}

function Results({ game, me, people }: { game: Game<State>; me: Me; people: Map<number, Person> }) {
  const s = game.state;
  const [again, setAgain] = useState(false);
  const total = familyTotal(s);
  const rows = standings(s);
  const best = knowsBest(s);
  const reviewId = useId();
  // Standings finds people by seat, so everyone gets a seat of their own here.
  const ranked = { ...game, seats: Object.fromEntries(rows.map((r) => [`p${r.id}`, r.id])) };
  const share = total.answered ? total.right / total.answered : 0;

  async function playAgain() {
    setAgain(true);
    try {
      await startGame(game.room_id, TYPE, { mode: 'coop', seats: {}, state: { ...newQuiz(me.id, s.each), band: s.band } });
    } finally {
      setAgain(false);
    }
  }

  const againButton = me.permissions.start_games && (
    <Button variant="primary" icon="refresh" busy={again} onClick={playAgain}>
      Play again
    </Button>
  );

  if (!total.answered)
    return (
      <div className="result sheet fq-results">
        <p className="result-big">No answers this time</p>
        <p className="muted">The quiz was put away before anyone answered.</p>
        {againButton}
      </div>
    );

  return (
    <>
      <div className="result sheet fq-results">
        <p className="fq-results-art" aria-hidden="true">
          {share === 1 ? '🏆' : share >= 0.5 ? '🎉' : '🌱'}
        </p>
        <p className="result-big">{totalText(total)}</p>
        <p className="muted">{cheer(share)}</p>
        {best.length > 0 && (
          <p className="fq-best">
            <span aria-hidden="true">👑 </span>
            {stillGoing(best, me.id, people, ['knows', 'know'])} everyone best
          </p>
        )}
        <h2 className="fq-section-title">Who knows the family best</h2>
        <Standings
          game={ranked}
          me={me}
          people={people}
          label="Who knows the family best"
          rows={rows.map((r) => ({ seat: `p${r.id}`, place: r.place, main: r.answered ? `${r.right} of ${r.answered}` : 'No answers' }))}
        />
        {againButton}
      </div>

      <section className="fq-review" aria-labelledby={reviewId}>
        <h2 id={reviewId} className="fq-section-title">
          All the answers
        </h2>
        <ol className="fq-review-list">
          {s.questions.map((q) => {
            const asker = personOf(q.by, me, people);
            const got = gotRight(s, q);
            const tried = Object.keys(s.replies[q.id] ?? {}).length;
            const names = namesWithMe(got, me.id, people);
            return (
              <li key={q.id} className={`fq-review-item sheet tint-${asker?.colour ?? 'slate'}`}>
                <p className="fq-review-who">
                  <Avatar person={asker} size="xs" />
                  {nameOf(people, q.by, me.id)} asked
                </p>
                <p className="fq-review-q">{q.text}</p>
                <p className="fq-review-a">
                  <span className="sr-only">The answer: </span>
                  <span aria-hidden="true">✓ </span>
                  {q.answers[q.right]}
                </p>
                <p className="fq-review-got">
                  {!tried
                    ? 'Nobody answered this one.'
                    : !got.length
                      ? 'Nobody got this one!'
                      : got.length === tried && tried > 1
                        ? `Everyone got it: ${names}`
                        : `Got it right: ${names}`}
                </p>
                {got.length > 0 && (
                  <span className="fq-faces" aria-hidden="true">
                    {got.map((id) => (
                      <Avatar key={id} person={personOf(id, me, people)} size="xs" />
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

/* ---------- Starting ---------- */

function Options({ value, onChange }: OptionsProps<Options>) {
  return (
    <>
      <p className="vs-rules">
        Everyone in the chat writes questions about themselves, like "What's my favourite animal?". Then everyone answers everyone else's, whenever
        they like. You can write yours as soon as it starts.
      </p>
      <div className="field">
        <span className="field-label">Questions each</span>
        <Segmented
          label="Questions each"
          value={String(value.each)}
          onChange={(v) => onChange({ ...value, each: Number(v) })}
          options={EACH.map((n) => ({ value: String(n), label: String(n) }))}
        />
      </div>
    </>
  );
}

export const familyQuiz: GameDef<State, Options> = {
  type: TYPE,
  name: 'Family Quiz',
  emoji: '🙋',
  blurb: "How well do we know each other? Everyone writes questions about themselves, then answers everyone else's in their own time.",
  modes: ['coop'],
  modeLabels: { coop: 'Everyone' },
  players: 'Everyone in the chat, 2 or more',
  defaults: () => ({ each: 2 }),
  ready: (o) => EACH.includes(o.each),
  Options,
  create: (o, { me }) => ({ mode: 'coop', seats: {}, state: newQuiz(me.id, o.each) }),
  bands: {
    '5-7': 'Simple questions like your favourite colour or animal, with 2 answers to choose from. A whole question can be made with taps.',
    '8-10': 'Questions about favourite things, seasons and places, with 3 answers to choose from.',
    '11-13': "Questions like which superpower you'd pick or where you'd love to go, with 4 answers to choose from.",
    '14+': 'Questions like your first concert or a funny thing that happened to you, with 4 answers to choose from.',
  },
  basics: [
    { art: '🙋', title: 'Questions about you', text: 'Everyone writes questions about themselves, like "What\'s my favourite animal?", with the right answer and some wrong ones.' },
    { art: '🔀', title: 'Mixed up', text: "The answers get mixed up when you save, so nobody can tell which one is right by where it is." },
    { art: '🤫', title: 'Kept secret', text: 'Nobody sees your questions until the quiz starts. It can start once two people have written theirs.' },
    { art: '👆', title: 'Answering', text: "Answer everyone else's questions, one at a time, whenever you like. You find out straight away if you got it right." },
    { art: '🏆', title: 'The end', text: 'When everyone has answered, see how many the family got right, and who knows everyone best.' },
  ] satisfies Lesson[],
  Board,
  guide: [
    { title: 'The aim', body: 'Find out how well the family knows each other.' },
    {
      title: 'Writing questions',
      body: "Everyone in the chat writes questions about themselves, with the right answer and some wrong ones. Nobody else sees them until the quiz starts. Whoever started the quiz can start the answering once two people have written theirs, and anyone can once everyone is ready.",
    },
    {
      title: 'Answering',
      body: "Answer everyone else's questions, one at a time, in your own time. You can't answer your own. Each answer shows straight away whether you got it right.",
    },
    {
      title: 'Writing a good question',
      body: [
        'Ask about something the others might know, or could guess.',
        "Make the wrong answers believable too, so it isn't too easy.",
        "Don't worry about the order. The answers get mixed up when you save.",
        'Younger ones can make a question with taps alone, or ask a grown-up to help type.',
      ],
    },
    {
      title: 'The end',
      body: "When everyone who wrote questions has answered all the others', everyone sees the answers, how many the family got right, and who knows everyone best. Someone who has finished can also show the answers early.",
    },
  ],
  status: (g, me, people) => (g.status === 'finished' && g.summary ? g.summary : statusLine(g, me, people)),
  // Everyone in the chat is asked for questions; once answering, only those who wrote are waited for.
  waitingOn: (g, me) =>
    g.status === 'active' && (g.state.phase === 'writing' ? !isReady(g.state, me) : writers(g.state).includes(me) && left(g.state, me).length > 0),
};
