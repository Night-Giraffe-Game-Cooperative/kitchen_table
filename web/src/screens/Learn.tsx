import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import type { Person } from '../lib/types';
import { Avatar, Button, Field, IconButton, Input, Notice, Segmented } from '../components/ui';
import { InfoTip } from '../components/tips';
import { errorText, useLive } from './tasksShared';
import { BANDS, bandLabel, defaultBand, rememberBand, type Band } from '../games/bands';
import { canSpeak, hasVoice, speakIn } from '../lib/speech';
import { shuffle } from '../games/common';
import { ROAD_TEST, TRAIN_QUIZ, roadSigns } from '../learn/japanTravel';
import { factFor, sleepsUntil, spots } from '../learn/japanFun';
import { Faces, Travel } from './LearnTravel';
import {
  allPhrases,
  kanaList,
  kanaRows,
  keyOf,
  languageOf,
  languages,
  scriptName,
  type Kana,
  type Lang,
  type Language,
  type Level,
  type Phrase,
  type Script,
} from '../learn/phrases';

// Learning a language together for a holiday: phrases to say, signs to spot,
// and for Japanese the characters. Everyone marks what they know, and the
// family sees how they're all getting on.

type Tab = 'phrases' | 'practise' | 'signs' | 'kana' | 'travel';

interface Known {
  user_id: number;
  key: string;
}

const LANG_KEY = 'learn:lang';

function savedLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ja' || saved === 'fr') return saved;
  } catch {
    /* nothing remembered */
  }
  return 'ja';
}

/** How much a band takes on: 5–7 the first words, 8–10 more, older everything. */
const levelFor = (b: Band): Level => (b === '5-7' ? 1 : b === '8-10' ? 2 : 3);

const bandHint: Record<Level, string> = {
  1: 'The first words: hello, thank you, the toilet, help.',
  2: 'More for getting about, eating out and shopping.',
  3: 'Everything, with longer sentences.',
};

const say = (p: Phrase, lang: Language, slowly = false) => speakIn(p.speak ?? p.text, lang.bcp47, { slowly });

export function Learn() {
  const { me, people, toast } = useStore();
  const [lang, setLang] = useState<Lang>(savedLang);
  const [tab, setTab] = useState<Tab>('phrases');
  const [band, setBand] = useState<Band>(() => defaultBand(me));
  const [, voicesLoaded] = useState(0);
  const live = useLive<{ known: Known[]; trips?: Partial<Record<Lang, string>> }>('/api/phrases', 'phrases_changed');
  const language = languageOf(lang);
  const level = levelFor(band);
  const shownTab = (tab === 'kana' || tab === 'travel') && lang !== 'ja' ? 'phrases' : tab;

  // Browsers list their voices a moment after the page loads.
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const loaded = () => voicesLoaded((n) => n + 1);
    window.speechSynthesis.addEventListener('voiceschanged', loaded);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loaded);
  }, []);

  const knownBy = useMemo(() => {
    const by = new Map<string, number[]>();
    for (const k of live.data?.known ?? []) by.set(k.key, [...(by.get(k.key) ?? []), k.user_id]);
    return by;
  }, [live.data]);
  const iKnow = (key: string) => knownBy.get(key)?.includes(me.id) ?? false;

  async function mark(key: string, known: boolean) {
    live.setData((d) => {
      const rest = (d?.known ?? []).filter((k) => !(k.key === key && k.user_id === me.id));
      return { ...d, known: known ? [...rest, { user_id: me.id, key }] : rest };
    });
    try {
      await api.put('/api/phrases/known', { key, known });
    } catch (e) {
      toast(errorText(e), 'danger');
      live.reload();
    }
  }

  async function setTrip(date: string | null) {
    try {
      await api.put('/api/phrases/trip', { lang, date });
      live.reload();
    } catch (e) {
      toast(errorText(e), 'danger');
    }
  }

  function chooseLang(l: Lang) {
    setLang(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* private browsing: it just isn't remembered */
    }
  }

  function chooseBand(b: Band) {
    setBand(b);
    rememberBand(b);
  }

  // Me and the rest of my own household, who share their progress.
  const family = [...people.values()]
    .filter((p) => p.active !== false && (p.id === me.id || (me.bubble_id != null && p.bubble_id === me.bubble_id)))
    .sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id) || a.name.localeCompare(b.name));

  const tabs: { value: Tab; label: string }[] = [
    { value: 'phrases', label: 'Phrases' },
    { value: 'practise', label: 'Practise' },
    { value: 'signs', label: 'Signs' },
    ...(lang === 'ja'
      ? [
          { value: 'kana' as Tab, label: 'Characters' },
          { value: 'travel' as Tab, label: 'Travel' },
        ]
      : []),
  ];

  return (
    <div className="page learn">
      <header className="page-head">
        <h1>Learn</h1>
      </header>

      <div className="learn-langs">
        <Segmented label="Language" value={lang} onChange={chooseLang} options={languages.map((l) => ({ value: l.id, label: `${l.flag} ${l.name}` }))} />
      </div>

      {canSpeak && !hasVoice(language.bcp47) && (
        <Notice tone="info">
          This device has no {language.name} voice, so it can't read the phrases aloud. The how-to-say-it spelling under each one still helps.
        </Notice>
      )}
      {live.error && !live.data && <Notice tone="danger">{live.error}</Notice>}

      <Countdown key={lang} language={language} trip={live.data?.trips?.[lang]} grownUp={me.role !== 'kid'} onSet={setTrip} />

      <TodayPhrase language={language} />

      <FamilyProgress language={language} family={family} known={live.data?.known ?? []} me={me.id} />

      <div className="learn-tabs">
        <Segmented label="Show" value={shownTab} onChange={setTab} options={tabs} />
      </div>

      {shownTab !== 'travel' && (
        <div className="field learn-ages">
          <span className="field-label">Ages</span>
          <Segmented label="Ages" value={band} onChange={chooseBand} options={BANDS.map((b) => ({ value: b, label: bandLabel[b] }))} />
          <p className="field-hint">{bandHint[level]}</p>
        </div>
      )}

      {shownTab === 'phrases' && (
        <>
          <p className="muted with-info">
            Press the speaker to hear one, then say it back.
            <InfoTip about="learning phrases">
              Each phrase is spelled out the way it sounds under the words. Once you can say one without looking, press I know it, and the family sees it
              next to your picture. Practise mixes them into cards.
            </InfoTip>
          </p>
          {language.topics.map((t) => {
            const shown = t.phrases.filter((p) => p.level <= level);
            if (!shown.length) return null;
            return (
              <section key={t.id} className="learn-topic" aria-labelledby={`topic-${t.id}`}>
                <h2 className="learn-topic-title" id={`topic-${t.id}`}>
                  <span aria-hidden="true">{t.emoji}</span> {t.title}
                </h2>
                <ul className="phrases">
                  {shown.map((p) => {
                    const key = keyOf(lang, p.id);
                    return (
                      <PhraseRow
                        key={key}
                        phrase={p}
                        language={language}
                        who={knownBy.get(key) ?? []}
                        mine={iKnow(key)}
                        onMark={(k) => mark(key, k)}
                      />
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      )}

      {shownTab === 'signs' && (
        <>
          <p className="muted">Words you'll see on signs and doors. Spot them on holiday!</p>
          {signGroups(language.signs.filter((s) => s.level <= level)).map((g) => (
            <section key={g.title} className="learn-topic" aria-label={g.title}>
              {g.title && <h2 className="learn-topic-title">{g.title}</h2>}
              <ul className="phrases signs">
                {g.signs.map((s) => {
                  const key = keyOf(lang, s.id);
                  return (
                    <PhraseRow key={key} phrase={s} language={language} who={knownBy.get(key) ?? []} mine={iKnow(key)} onMark={(k) => mark(key, k)} sign />
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}

      {shownTab === 'practise' && <Practise key={`${lang}-${level}`} language={language} level={level} iKnow={iKnow} onKnow={(key) => mark(key, true)} />}

      {shownTab === 'kana' && <Characters level={level} iKnow={iKnow} onKnow={(key) => mark(key, true)} />}

      {shownTab === 'travel' && <Travel grownUp={me.role !== 'kid'} iKnow={iKnow} onMark={mark} knownBy={knownBy} />}
    </div>
  );
}

/** Signs around town, then at the station, with headings only when there are both. */
function signGroups(signs: Phrase[]): { title: string; signs: Phrase[] }[] {
  const town = signs.filter((s) => !s.where);
  const station = signs.filter((s) => s.where === 'station');
  if (!station.length) return [{ title: '', signs: town }];
  return [
    { title: 'Around town', signs: town },
    { title: 'At the station', signs: station },
  ].filter((g) => g.signs.length);
}

/** Sleeps until the holiday, with a fact a day to build up to it. A grown-up sets the date. */
function Countdown({
  language,
  trip,
  grownUp,
  onSet,
}: {
  language: Language;
  trip: string | undefined;
  grownUp: boolean;
  onSet: (date: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(trip ?? '');
  const today = new Date();
  const sleeps = trip ? sleepsUntil(trip, today) : null;
  // A month after the holiday starts, it's time for the next one.
  const current = sleeps !== null && sleeps >= -30;
  const place = language.id === 'ja' ? 'Japan' : 'France';

  if (editing || (!current && grownUp)) {
    return (
      <form
        className="countdown-set sheet"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!date) return;
          await onSet(date);
          setEditing(false);
        }}
      >
        <Field label={`When do you go to ${place}?`} hint="Everyone at home gets a countdown, with a new fact every day.">
          {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <div className="learn-today-actions">
          <Button type="submit" variant="primary" disabled={!date}>
            Start the countdown
          </Button>
          {editing && trip && (
            <Button
              onClick={async () => {
                await onSet(null);
                setDate('');
                setEditing(false);
              }}
            >
              No date yet
            </Button>
          )}
          {editing && (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    );
  }
  if (!current || sleeps === null) return null;

  const headline =
    sleeps > 1
      ? `${sleeps} sleeps until ${place}!`
      : sleeps === 1
        ? `Just one more sleep until ${place}!`
        : sleeps === 0
          ? `It's ${place} day!`
          : `Have a wonderful time in ${place}!`;
  return (
    <section className="countdown sheet" aria-labelledby="countdown">
      <p className="countdown-flag" aria-hidden="true">
        {language.flag}
      </p>
      <div className="countdown-text">
        <h2 className="countdown-headline" id="countdown">
          {headline}
        </h2>
        {sleeps >= 14 && <p className="countdown-weeks">{weeksAndDays(sleeps)}</p>}
        {language.id === 'ja' && sleeps >= 0 && (
          <p className="countdown-fact">
            <strong>Did you know?</strong> {factFor(today)}
          </p>
        )}
        {grownUp && (
          <Button variant="ghost" size="sm" icon="calendar" onClick={() => setEditing(true)}>
            Change the date
          </Button>
        )}
      </div>
    </section>
  );
}

/** "That's 21 weeks and 3 days", for a countdown too long to picture in sleeps. */
function weeksAndDays(sleeps: number): string {
  const weeks = Math.floor(sleeps / 7);
  const days = sleeps % 7;
  return `That's ${weeks} weeks${days ? ` and ${days} ${days === 1 ? 'day' : 'days'}` : ''}.`;
}

/** One phrase a day, the same for everyone in the family. */
function TodayPhrase({ language }: { language: Language }) {
  const pool = allPhrases(language).filter((p) => p.level <= 2);
  const now = new Date();
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
  const phrase = pool[day % pool.length];
  return (
    <section className="learn-today sheet" aria-labelledby="today-phrase">
      <h2 className="section-label" id="today-phrase">
        Today's phrase, for everyone
      </h2>
      <p className="learn-today-en">{phrase.en}</p>
      <p className="learn-today-native" lang={language.bcp47}>
        {phrase.text}
      </p>
      <p className="phrase-say">
        {phrase.say}
        {phrase.roman && <span className="muted"> · {phrase.roman}</span>}
      </p>
      {canSpeak && (
        <div className="learn-today-actions">
          <Button icon="speaker" variant="primary" onClick={() => say(phrase, language)}>
            Hear it
          </Button>
          <Button onClick={() => say(phrase, language, true)}>Slowly</Button>
        </div>
      )}
    </section>
  );
}

function FamilyProgress({ language, family, known, me }: { language: Language; family: Person[]; known: Known[]; me: number }) {
  const phraseKeys = new Set([...allPhrases(language), ...language.signs].map((p) => keyOf(language.id, p.id)));
  const kanaKeys = new Set(language.id === 'ja' ? [...kanaList('hira'), ...kanaList('kata')].map((k) => keyOf('ja', k.id)) : []);
  const roadKeys = new Set(language.id === 'ja' ? roadSigns.map((s) => keyOf('ja', `road.${s.id}`)) : []);
  const spotKeys = new Set(language.id === 'ja' ? spots.map((s) => keyOf('ja', `spot.${s.id}`)) : []);
  const passes = language.id === 'ja' ? [keyOf('ja', TRAIN_QUIZ), keyOf('ja', ROAD_TEST)] : [];
  const count = (id: number, keys: Set<string>) => known.filter((k) => k.user_id === id && keys.has(k.key)).length;
  const has = (id: number, key: string) => known.some((k) => k.user_id === id && k.key === key);
  const any = (id: number) =>
    count(id, phraseKeys) + count(id, kanaKeys) + count(id, roadKeys) + count(id, spotKeys) > 0 || passes.some((key) => has(id, key));
  const learning = family.filter((p) => p.id === me || any(p.id));
  const anyone = learning.some((p) => any(p.id));

  return (
    <section className="learn-family" aria-labelledby="learn-family">
      <h2 className="section-label" id="learn-family">
        How the family's getting on
      </h2>
      {!anyone ? (
        <p className="muted">Nobody has marked a {language.name} phrase yet. Press I know it on one you can say.</p>
      ) : (
        <ul className="learn-people">
          {learning.map((p) => {
            const phrases = count(p.id, phraseKeys);
            const chars = count(p.id, kanaKeys);
            const road = count(p.id, roadKeys);
            const spotted = count(p.id, spotKeys);
            return (
              <li key={p.id} className="learn-person">
                <Avatar person={p} size="sm" />
                <span className="learn-person-text">
                  <strong>{p.id === me ? 'You' : p.name}</strong>
                  <span className="muted">
                    {phrases} {phrases === 1 ? 'phrase' : 'phrases'}
                    {language.id === 'ja' && ` · ${chars} ${chars === 1 ? 'character' : 'characters'}`}
                    {road > 0 && ` · ${road} road ${road === 1 ? 'sign' : 'signs'}`}
                    {spotted > 0 && ` · ${spotted} spotted`}
                  </span>
                  {(has(p.id, keyOf('ja', TRAIN_QUIZ)) || has(p.id, keyOf('ja', ROAD_TEST))) && language.id === 'ja' && (
                    <span className="learn-passes">
                      {has(p.id, keyOf('ja', TRAIN_QUIZ)) && <span>🚄 Bullet train expert</span>}
                      {has(p.id, keyOf('ja', ROAD_TEST)) && <span>🚗 Passed the road test</span>}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PhraseRow({
  phrase,
  language,
  who,
  mine,
  onMark,
  sign,
}: {
  phrase: Phrase;
  language: Language;
  who: number[];
  mine: boolean;
  onMark: (known: boolean) => void;
  sign?: boolean;
}) {
  return (
    <li className={`phrase sheet${sign ? ' phrase-sign' : ''}`} data-known={mine || undefined}>
      {canSpeak && <IconButton icon="speaker" label={`Hear "${phrase.en}"`} className="phrase-hear" onClick={() => say(phrase, language)} />}
      <div className="phrase-text">
        <span className="phrase-en">{phrase.en}</span>
        <span className="phrase-native" lang={language.bcp47}>
          {phrase.text}
        </span>
        <span className="phrase-say">
          {phrase.say}
          {phrase.roman && <span className="muted"> · {phrase.roman}</span>}
        </span>
        {phrase.note && <span className="phrase-note muted">{phrase.note}</span>}
      </div>
      <div className="phrase-side">
        <Faces ids={who} />
        <button type="button" className="know" aria-pressed={mine} aria-label={`I know "${phrase.en}"`} onClick={() => onMark(!mine)}>
          I know it
        </button>
      </div>
    </li>
  );
}


/** Cards: the English first, then think of it, then see and hear it. The ones you don't know come first. */
function Practise({ language, level, iKnow, onKnow }: { language: Language; level: Level; iKnow: (key: string) => boolean; onKnow: (key: string) => void }) {
  const deal = () => {
    const pool = [...allPhrases(language), ...language.signs].filter((p) => p.level <= level);
    const fresh = shuffle(pool.filter((p) => !iKnow(keyOf(language.id, p.id))));
    const known = shuffle(pool.filter((p) => iKnow(keyOf(language.id, p.id))));
    return [...fresh, ...known].slice(0, 10);
  };
  const [deck, setDeck] = useState<Phrase[]>(deal);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  const [knew, setKnew] = useState(0);
  const card = deck[at];

  function again() {
    setDeck(deal());
    setAt(0);
    setOpen(false);
    setKnew(0);
  }

  function show() {
    setOpen(true);
    say(card, language);
  }

  function next(gotIt: boolean) {
    if (gotIt) {
      setKnew((n) => n + 1);
      const key = keyOf(language.id, card.id);
      if (!iKnow(key)) onKnow(key);
    }
    setOpen(false);
    setAt((n) => n + 1);
  }

  if (!card) {
    return (
      <div className="flashcard sheet" role="status">
        <p className="flash-done" aria-hidden="true">
          {knew === deck.length ? '🌟' : '👏'}
        </p>
        <p className="flash-en">
          You knew {knew} of {deck.length}.
        </p>
        <p className="muted">The ones you knew are marked as known, for the family to see.</p>
        <Button variant="primary" icon="refresh" onClick={again}>
          Again
        </Button>
      </div>
    );
  }

  return (
    <div className="flashcard sheet" aria-live="polite">
      <span className="flash-count muted">
        {at + 1} of {deck.length}
      </span>
      <p className="flash-q">How do you say</p>
      <p className="flash-en">{card.en}</p>
      {!open ? (
        <Button variant="primary" size="lg" onClick={show}>
          Show me
        </Button>
      ) : (
        <>
          <p className="flash-native" lang={language.bcp47}>
            {card.text}
          </p>
          <p className="phrase-say">
            {card.say}
            {card.roman && <span className="muted"> · {card.roman}</span>}
          </p>
          {canSpeak && (
            <div className="learn-today-actions">
              <Button icon="speaker" onClick={() => say(card, language)}>
                Hear it again
              </Button>
              <Button onClick={() => say(card, language, true)}>Slowly</Button>
            </div>
          )}
          <div className="flash-answer">
            <Button onClick={() => next(false)}>Not yet</Button>
            <Button variant="primary" icon="check" onClick={() => next(true)}>
              I knew it
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Hiragana and katakana: a chart to tap and hear, and a quiz. */
function Characters({ level, iKnow, onKnow }: { level: Level; iKnow: (key: string) => boolean; onKnow: (key: string) => void }) {
  const [script, setScript] = useState<Script>('hira');
  const [quiz, setQuiz] = useState(false);
  const rows = kanaRows(script);
  const known = kanaList(script).filter((k) => iKnow(keyOf('ja', k.id))).length;

  return (
    <>
      <div className="learn-kana-head">
        <Segmented
          label="Which characters"
          value={script}
          onChange={(s) => {
            setScript(s);
            setQuiz(false);
          }}
          options={[
            { value: 'hira', label: 'Hiragana' },
            { value: 'kata', label: 'Katakana' },
          ]}
        />
        <p className="muted with-info">
          {script === 'hira' ? 'Hiragana is for Japanese words.' : 'Katakana is for words from other languages, like トイレ (toilet).'} You know {known} of 46.
          <InfoTip about="Japanese characters">
            Each character is a sound, read in rows: a, i, u, e, o, then ka, ki, ku, ke, ko, and so on. Tap one to hear it. The quiz marks the ones you get right
            as known.
          </InfoTip>
        </p>
      </div>
      {quiz ? (
        <KanaQuiz key={script} script={script} level={level} onKnow={onKnow} iKnow={iKnow} onDone={() => setQuiz(false)} />
      ) : (
        <>
          <Button variant="primary" icon="sparkle" onClick={() => setQuiz(true)}>
            Quiz me on {scriptName[script]}
          </Button>
          <div className="kana-grid" role="group" aria-label={`${scriptName[script]} chart`}>
            {rows.flat().map((k, i) =>
              k ? (
                <button
                  key={k.id}
                  type="button"
                  className="kana"
                  data-known={iKnow(keyOf('ja', k.id)) || undefined}
                  aria-label={`${k.char}, ${k.roman}${iKnow(keyOf('ja', k.id)) ? ', you know it' : ''}`}
                  onClick={() => speakIn(k.char, 'ja-JP')}
                >
                  <span className="kana-char" lang="ja-JP">
                    {k.char}
                  </span>
                  <span className="kana-roman">{k.roman}</span>
                </button>
              ) : (
                <span key={`gap-${i}`} className="kana-gap" aria-hidden="true" />
              ),
            )}
          </div>
        </>
      )}
    </>
  );
}

function KanaQuiz({
  script,
  level,
  iKnow,
  onKnow,
  onDone,
}: {
  script: Script;
  level: Level;
  iKnow: (key: string) => boolean;
  onKnow: (key: string) => void;
  onDone: () => void;
}) {
  // The youngest start with the first five rows, and choose from three.
  const pool = kanaList(script).filter((k) => level > 1 || k.row <= 4);
  const choices = level === 1 ? 3 : 4;
  const deal = () => [...shuffle(pool.filter((k) => !iKnow(keyOf('ja', k.id)))), ...shuffle(pool.filter((k) => iKnow(keyOf('ja', k.id))))].slice(0, 10);
  // The right sound and a few others, in any order.
  const answersFor = (k: Kana | undefined) =>
    k ? shuffle([k.roman, ...shuffle(pool.filter((o) => o.roman !== k.roman)).slice(0, choices - 1).map((o) => o.roman)]) : [];
  const [deck, setDeck] = useState<Kana[]>(deal);
  const [at, setAt] = useState(0);
  const [options, setOptions] = useState<string[]>(() => answersFor(deck[0]));
  const [picked, setPicked] = useState<string | null>(null);
  const [right, setRight] = useState(0);
  const kana = deck[at];

  function choose(roman: string) {
    if (picked) return;
    setPicked(roman);
    speakIn(kana.char, 'ja-JP');
    if (roman === kana.roman) {
      setRight((n) => n + 1);
      const key = keyOf('ja', kana.id);
      if (!iKnow(key)) onKnow(key);
    }
  }

  function next() {
    setPicked(null);
    setOptions(answersFor(deck[at + 1]));
    setAt(at + 1);
  }

  if (!kana) {
    return (
      <div className="flashcard sheet" role="status">
        <p className="flash-done" aria-hidden="true">
          {right === deck.length ? '🌟' : '👏'}
        </p>
        <p className="flash-en">
          {right} of {deck.length} right.
        </p>
        <div className="flash-answer">
          <Button onClick={onDone}>Back to the chart</Button>
          <Button
            variant="primary"
            icon="refresh"
            onClick={() => {
              const fresh = deal();
              setDeck(fresh);
              setOptions(answersFor(fresh[0]));
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

  const correct = picked === kana.roman;
  return (
    <div className="flashcard sheet">
      <span className="flash-count muted">
        {at + 1} of {deck.length}
      </span>
      <p className="flash-q">Which sound is this?</p>
      <p className="flash-kana" lang="ja-JP">
        {kana.char}
      </p>
      <div className="kana-choices" role="group" aria-label="Sounds">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className="kana-choice"
            data-right={picked && o === kana.roman ? true : undefined}
            data-wrong={picked === o && !correct ? true : undefined}
            disabled={!!picked}
            onClick={() => choose(o)}
          >
            {o}
          </button>
        ))}
      </div>
      <p className="flash-feedback" aria-live="polite">
        {picked ? (correct ? `Yes! That's ${kana.roman}.` : `Not quite: it's ${kana.roman}.`) : ''}
      </p>
      {picked && (
        <Button variant="primary" icon="forward" onClick={next}>
          Next
        </Button>
      )}
    </div>
  );
}
