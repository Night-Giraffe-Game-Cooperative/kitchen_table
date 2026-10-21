import { useState, type FormEvent } from 'react';
import { Avatar, Button, Field, Input, Segmented } from '../../components/ui';
import type { GameDef, GameProps, OptionsProps } from '../common';
import { listNames, nameOf, pick } from '../common';
import { DrawPad } from './DrawPad';
import { PromptField } from './PromptOptions';
import { doodleBands, isPrompt, promptsFor, telephoneBasics } from './prompts';

interface Step {
  kind: 'words' | 'picture';
  u: number;
  text?: string;
  url?: string;
}

interface State {
  turn: 'anyone';
  steps: Step[];
  length: number;
}

interface Options {
  prompt: string;
  length: number;
}

function summary(s: State, people: GameProps<State>['people']) {
  const first = s.steps[0]?.text ?? '';
  const lastWords = [...s.steps].reverse().find((x) => x.kind === 'words')?.text ?? '';
  const who = listNames([...new Set(s.steps.map((x) => x.u))].map((id) => nameOf(people, id)));
  return `Doodle Telephone by ${who} went from "${first}" to "${lastWords}"`;
}

function Board({ game, play, me, people }: GameProps<State>) {
  const s = game.state;
  const [guess, setGuess] = useState('');
  const done = game.status === 'finished';
  const last = s.steps[s.steps.length - 1];
  const myLast = last?.u === me.id;
  const canPlay = me.permissions.play_games && !done;
  const left = s.length - s.steps.length;

  function add(step: Step) {
    return play.move((st) => {
      const tip = st.steps[st.steps.length - 1];
      if (tip?.u === me.id || tip?.kind === step.kind) return null;
      const next = { ...st, steps: [...st.steps, step] };
      return next.steps.length >= next.length ? { state: next, status: 'finished', summary: summary(next, people) } : { state: next };
    });
  }

  function sendGuess(e: FormEvent) {
    e.preventDefault();
    const text = guess.trim();
    if (!text) return;
    add({ kind: 'words', u: me.id, text }).then((ok) => ok && setGuess(''));
  }

  if (done) {
    return (
      <div className="doodle-game">
        <p className="prompt-banner">📞 Here's how it went!</p>
        <ol className="chain">
          {s.steps.map((st, i) => (
            <li key={i} className="chain-step sheet">
              <div className="chain-who">
                <Avatar person={people.get(st.u)} size="xs" />
                <span>
                  {nameOf(people, st.u, me.id)} {st.kind === 'words' ? (i === 0 ? 'started with' : 'guessed') : 'drew'}
                </span>
              </div>
              {st.kind === 'words' ? <p className="chain-words">"{st.text}"</p> : <img src={st.url} alt={`Drawing by ${nameOf(people, st.u)}`} />}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="doodle-game">
      <p className="muted center">
        {left} {left === 1 ? 'step' : 'steps'} left. Each person only sees the step before theirs.
      </p>
      {myLast || !canPlay ? (
        <div className="notice notice-info">
          <p>
            {myLast
              ? `You did the last step. Someone else goes next, then you can go again.`
              : `${nameOf(people, last?.u)} did the last step.`}
          </p>
        </div>
      ) : last?.kind === 'words' ? (
        <>
          <p className="prompt-banner">
            ✏️ Draw this: <strong>{last.text}</strong>
          </p>
          <DrawPad roomId={game.room_id} label={`Your drawing of ${last.text}`} sendLabel="Pass it on" onSent={(media) => add({ kind: 'picture', u: me.id, url: media.url })} />
        </>
      ) : (
        <form className="stack" onSubmit={sendGuess}>
          <p className="prompt-banner">🤔 What is this a picture of?</p>
          <figure className="finished-picture sheet">
            <img src={last?.url} alt="The drawing to guess" />
          </figure>
          <Field label="Your guess">{(p) => <Input {...p} value={guess} maxLength={80} onChange={(e) => setGuess(e.target.value)} />}</Field>
          <div className="row row-end">
            <Button type="submit" variant="primary" icon="send" busy={play.busy} disabled={!guess.trim()}>
              Pass it on
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Options({ value, onChange, band }: OptionsProps<Options>) {
  return (
    <>
      <PromptField label="The first words" value={value.prompt} band={band} onChange={(prompt) => onChange({ ...value, prompt })} />
      <div className="field">
        <span className="field-label">Steps</span>
        <Segmented
          label="Steps"
          value={String(value.length)}
          onChange={(v) => onChange({ ...value, length: Number(v) })}
          options={[
            { value: '5', label: '5' },
            { value: '7', label: '7' },
            { value: '9', label: '9' },
          ]}
        />
      </div>
    </>
  );
}

export const doodleTelephone: GameDef<State, Options> = {
  type: 'doodle_telephone',
  name: 'Doodle Telephone',
  emoji: '📞',
  blurb: 'Words become a drawing, the drawing becomes a guess, and on it goes. See how far it travels.',
  modes: ['coop'],
  players: '2 or more, taking turns',
  defaults: ({ band }) => ({ prompt: pick(promptsFor[band]), length: 7 }),
  rebanded: (o, band) => (isPrompt(o.prompt) ? { ...o, prompt: pick(promptsFor[band]) } : o),
  bands: doodleBands,
  basics: telephoneBasics,
  ready: (o) => o.prompt.trim().length > 0,
  Options,
  create: (o, { me }) => ({
    mode: 'coop',
    seats: {},
    state: { turn: 'anyone', steps: [{ kind: 'words', u: me.id, text: o.prompt.trim() }], length: o.length },
  }),
  Board,
  guide: [
    {
      title: 'The aim',
      body: 'It starts with some words. The next person draws them, the next guesses what the drawing shows, the next draws that guess, and so on. At the end, see how far it travelled.',
    },
    {
      title: 'Taking turns',
      body: 'Each person only sees the step just before theirs, and nobody does two steps in a row.',
    },
    {
      title: 'Ideas',
      body: ['Draw the main thing big and simple; nobody needs a masterpiece.', 'When guessing, say what you really see. The muddles are the fun part.'],
    },
  ],
  status: (g, me, people) => {
    if (g.status === 'finished') return g.summary || 'Finished';
    const last = g.state.steps[g.state.steps.length - 1];
    if (last?.u === me) return 'Waiting for someone else';
    return last?.kind === 'words' ? `${nameOf(people, last.u)} needs a drawing` : `${nameOf(people, last?.u)} needs a guess`;
  },
};
