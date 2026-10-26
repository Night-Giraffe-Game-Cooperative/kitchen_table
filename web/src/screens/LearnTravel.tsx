import { useState } from 'react';
import { Avatar, Button, IconButton, Segmented } from '../components/ui';
import { InfoTip } from '../components/tips';
import { shuffle } from '../games/common';
import { canSpeak, speakIn } from '../lib/speech';
import { useStore } from '../lib/store';
import { keyOf } from '../learn/phrases';
import { bingoLines, spots } from '../learn/japanFun';
import { ROAD_TEST, SignPicture, TRAIN_QUIZ, roadRules, roadSigns, signQuestion, trainQuestions, type Question } from '../learn/japanTravel';

// Getting about in Japan: things to spot and bullet train know-how for
// everyone, and for the grown-ups who'll drive, the road signs and a road test.

type Part = 'spot' | 'trains' | 'driving';

interface Props {
  grownUp: boolean;
  iKnow: (key: string) => boolean;
  onMark: (key: string, known: boolean) => void;
  knownBy: Map<string, number[]>;
}

export function Travel(props: Props) {
  const [part, setPart] = useState<Part>('spot');
  const shown = part === 'driving' && !props.grownUp ? 'spot' : part;
  return (
    <>
      <div className="learn-tabs">
        <Segmented
          label="Travel"
          value={shown}
          onChange={setPart}
          options={[
            { value: 'spot', label: '🔎 Spot it' },
            { value: 'trains', label: '🚄 Bullet trains' },
            ...(props.grownUp ? [{ value: 'driving' as Part, label: '🚗 Driving' }] : []),
          ]}
        />
      </div>
      {shown === 'spot' && <SpotIt {...props} />}
      {shown === 'trains' && <Trains {...props} />}
      {shown === 'driving' && <Driving {...props} />}
    </>
  );
}

/** A bingo card of things to spot on the trip, shared with the family. */
function SpotIt({ iKnow, onMark, knownBy }: Props) {
  const mine = spots.map((s) => iKnow(keyOf('ja', `spot.${s.id}`)));
  const count = mine.filter(Boolean).length;
  const lines = bingoLines.filter((l) => l.every((i) => mine[i])).length;
  const score =
    count === spots.length
      ? '🏆 Full house! You spotted everything.'
      : lines
        ? `🎉 Bingo! ${lines === 1 ? 'One line' : `${lines} lines`} done, ${count} of ${spots.length} spotted.`
        : `${count} of ${spots.length} spotted.`;
  return (
    <>
      <p className="muted with-info">
        Tick them off when you spot them in Japan. Four in a row is bingo!
        <InfoTip about="spotting">Everyone has the same card, and the faces show who has spotted what. Tap again to untick.</InfoTip>
      </p>
      <p className="spot-score" role="status">
        {score}
      </p>
      <div className="spot-card" role="group" aria-label="Spot it in Japan">
        {spots.map((s, i) => {
          const key = keyOf('ja', `spot.${s.id}`);
          return (
            <button
              key={s.id}
              type="button"
              className="spot"
              aria-pressed={mine[i]}
              aria-label={s.label}
              data-line={bingoLines.some((l) => l.includes(i) && l.every((j) => mine[j])) || undefined}
              onClick={() => onMark(key, !mine[i])}
            >
              <span className="spot-emoji" aria-hidden="true">
                {s.emoji}
              </span>
              <span className="spot-label" lang="en">
                {s.label}
              </span>
              <Faces ids={knownBy.get(key) ?? []} />
            </button>
          );
        })}
      </div>
      <section aria-labelledby="spot-hints">
        <h2 className="learn-topic-title" id="spot-hints">
          Where to look
        </h2>
        <ul className="know-how">
          {spots.map((s) => (
            <li key={s.id} className="know-how-item sheet">
              <span className="know-how-emoji" aria-hidden="true">
                {s.emoji}
              </span>
              <span>
                <strong>{s.label}</strong>
                <span className="know-how-why">{s.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Trains({ iKnow, onMark }: Props) {
  const [quiz, setQuiz] = useState(false);
  const passed = iKnow(keyOf('ja', TRAIN_QUIZ));
  return (
    <>
      <p className="muted with-info">
        Bullet trains are fast, quiet and on time. Here's how to ride one like a local.
        <InfoTip about="bullet trains">The words you'll need are in Phrases, under Bullet trains, and the station signs are in Signs.</InfoTip>
      </p>
      {quiz ? (
        <Quiz
          title="Bullet train quiz"
          deal={() => shuffle(trainQuestions).slice(0, 8)}
          passAt={7}
          passed="You're a bullet train expert!"
          onPass={() => onMark(keyOf('ja', TRAIN_QUIZ), true)}
          onDone={() => setQuiz(false)}
        />
      ) : (
        <div className="travel-start">
          <Button variant="primary" icon="sparkle" onClick={() => setQuiz(true)}>
            Bullet train quiz
          </Button>
          {passed && <span className="travel-badge">🚄 You're a bullet train expert</span>}
        </div>
      )}
      <KnowHow heading="Good to know" items={trainQuestions} />
    </>
  );
}

function Driving({ iKnow, onMark, knownBy }: Props) {
  const [quiz, setQuiz] = useState(false);
  const passed = iKnow(keyOf('ja', ROAD_TEST));
  return (
    <>
      <p className="muted with-info">
        For grown-ups who'll drive. Japan drives on the left like home, but some signs and rules are different.
        <InfoTip about="driving in Japan">
          A start, not the whole rulebook: read your hire company's guide too. The road test's pass mark is 9 out of 10, like the 90% the real Japanese test
          asks for.
        </InfoTip>
      </p>
      {quiz ? (
        <Quiz
          title="Road test"
          deal={() => {
            const signs = shuffle(roadSigns)
              .slice(0, 4)
              .map((s) => signQuestion(s, roadSigns));
            return shuffle([...signs, ...shuffle(roadRules).slice(0, 6)]);
          }}
          passAt={9}
          passed="You passed the road test!"
          onPass={() => onMark(keyOf('ja', ROAD_TEST), true)}
          onDone={() => setQuiz(false)}
        />
      ) : (
        <div className="travel-start">
          <Button variant="primary" icon="sparkle" onClick={() => setQuiz(true)}>
            Take the road test
          </Button>
          {passed && <span className="travel-badge">🚗 You passed the road test</span>}
        </div>
      )}

      <h2 className="learn-topic-title">Road signs</h2>
      <ul className="road-signs">
        {roadSigns.map((s) => {
          const key = keyOf('ja', `road.${s.id}`);
          const mine = iKnow(key);
          return (
            <li key={s.id} className="road-sign sheet" data-known={mine || undefined}>
              <SignPicture sign={s} size={84} />
              <div className="road-sign-text">
                <span className="phrase-en">{s.en}</span>
                <span className="road-sign-means">{s.means}</span>
                <span className="phrase-say">
                  <span lang="ja-JP">{s.jp}</span> · {s.say}
                </span>
              </div>
              <div className="phrase-side">
                {canSpeak && <IconButton icon="speaker" label={`Hear "${s.en}" in Japanese`} onClick={() => speakIn(s.speak, 'ja-JP')} />}
                <Faces ids={knownBy.get(key) ?? []} />
                <button type="button" className="know" aria-pressed={mine} aria-label={`I know "${s.en}"`} onClick={() => onMark(key, !mine)}>
                  I know it
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <KnowHow heading="Rules of the road" items={roadRules} />
    </>
  );
}

/** The little faces of everyone who knows something. */
export function Faces({ ids }: { ids: number[] }) {
  const { me, people } = useStore();
  if (!ids.length) return null;
  const names = ids.map((id) => (id === me.id ? 'you' : (people.get(id)?.name ?? 'someone')));
  return (
    <span className="faces">
      {ids.slice(0, 4).map((id) => (
        <Avatar key={id} person={people.get(id)} size="xs" />
      ))}
      {ids.length > 4 && <span className="faces-more">+{ids.length - 4}</span>}
      <span className="sr-only">Known by {names.join(', ')}</span>
    </span>
  );
}

/** The answers to a quiz, as a list to read before you go. */
function KnowHow({ heading, items }: { heading: string; items: Question[] }) {
  const id = `know-${heading.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id}>
      <h2 className="learn-topic-title" id={id}>
        {heading}
      </h2>
      <ul className="know-how">
        {items.map((q) => (
          <li key={q.id} className="know-how-item sheet">
            <span className="know-how-emoji" aria-hidden="true">
              {q.emoji}
            </span>
            <span>
              <strong>{q.title}</strong>
              <span className="know-how-why">{q.why}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Dealt extends Question {
  choices: string[];
}

/** Questions one at a time, each answer explained, and a pass mark at the end. */
function Quiz({
  title,
  deal,
  passAt,
  passed,
  onPass,
  onDone,
}: {
  title: string;
  deal: () => Question[];
  passAt: number;
  passed: string;
  onPass: () => void;
  onDone: () => void;
}) {
  const dealt = () => deal().map((q) => ({ ...q, choices: shuffle([q.right, ...shuffle(q.wrong).slice(0, 3)]) }));
  const [deck, setDeck] = useState<Dealt[]>(dealt);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [right, setRight] = useState(0);
  const q = deck[at];

  function choose(choice: string) {
    if (picked) return;
    setPicked(choice);
    if (choice === q.right) setRight((n) => n + 1);
  }

  function next() {
    const score = right;
    setPicked(null);
    setAt(at + 1);
    if (at + 1 === deck.length && score >= passAt) onPass();
  }

  if (!q) {
    const pass = right >= passAt;
    return (
      <div className="flashcard sheet" role="status">
        <p className="flash-done" aria-hidden="true">
          {pass ? '🏅' : '👏'}
        </p>
        <p className="flash-en">
          {right} of {deck.length} right.
        </p>
        <p className="muted">{pass ? passed : `${passAt} of ${deck.length} passes. Read the answers below and try again.`}</p>
        <div className="flash-answer">
          <Button onClick={onDone}>Done</Button>
          <Button
            variant="primary"
            icon="refresh"
            onClick={() => {
              setDeck(dealt());
              setAt(0);
              setRight(0);
            }}
          >
            Again
          </Button>
        </div>
      </div>
    );
  }

  const correct = picked === q.right;
  return (
    <div className="flashcard sheet quiz" aria-label={title} role="group">
      <span className="flash-count muted">
        {at + 1} of {deck.length}
      </span>
      {q.picture}
      <p className="quiz-q">{q.q}</p>
      <div className="quiz-choices" role="group" aria-label="Answers">
        {q.choices.map((c) => (
          <button
            key={c}
            type="button"
            className="quiz-choice"
            data-right={picked && c === q.right ? true : undefined}
            data-wrong={picked === c && !correct ? true : undefined}
            disabled={!!picked}
            onClick={() => choose(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {picked && (
          <>
            <p className="flash-feedback">{correct ? 'Yes!' : `Not quite: ${q.right}.`}</p>
            <p className="quiz-why">{q.why}</p>
          </>
        )}
      </div>
      {picked && (
        <Button variant="primary" icon="forward" onClick={next}>
          {at + 1 === deck.length ? 'See how you did' : 'Next'}
        </Button>
      )}
    </div>
  );
}
