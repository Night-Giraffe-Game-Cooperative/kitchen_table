import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { toBlob, upload } from '../../lib/image';
import { lastUndoable, renderPicture, visibleItems, type Item } from '../../lib/doodle';
import { useStore } from '../../lib/store';
import { DoodleBoard, defaultTool, type Tool } from '../../components/DoodleBoard';
import { DoodleTools } from '../../components/DoodleTools';
import { Avatar, Button } from '../../components/ui';
import type { GameDef, GameProps, OptionsProps } from '../common';
import { doodlePrompts, listNames, nameOf, pick } from '../common';
import { PromptField } from './PromptOptions';

interface State {
  turn: 'anyone';
  prompt: string;
  strokes: Item[];
  page: number;
  picture?: string;
}

const PAGE = 700;

function Board({ game, play, me, people }: GameProps<State>) {
  const { online, toast } = useStore();
  const s = game.state;
  const [tool, setTool] = useState<Tool>(defaultTool);
  const [finishing, setFinishing] = useState(false);
  const done = game.status === 'finished';
  const canDraw = me.permissions.play_games && me.permissions.doodle && !done;
  const strokes = s.strokes ?? [];
  const artists = useMemo(() => [...new Set(visibleItems(strokes).map((i) => i.u).filter((u): u is number => typeof u === 'number'))], [strokes]);
  const undoable = lastUndoable(strokes, me.id);

  async function finish() {
    setFinishing(true);
    try {
      const canvas = renderPicture(strokes, s.page ?? PAGE, null);
      const blob = await toBlob(canvas, 'image/png');
      const { media, media_id } = await upload(game.room_id, { blob, width: canvas.width, height: canvas.height });
      const names = listNames(artists.map((id) => nameOf(people, id)));
      await api.post(`/api/rooms/${game.room_id}/messages`, { kind: 'doodle', body: `${s.prompt}, by ${names || 'the family'}`, media_id });
      await play.move((st) => ({
        state: { ...st, picture: media.url },
        status: 'finished',
        summary: `${names || 'The family'} drew ${st.prompt} together`,
      }));
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setFinishing(false);
    }
  }

  if (done && s.picture) {
    return (
      <div className="doodle-game">
        <p className="prompt-banner">🖍️ {s.prompt}</p>
        <figure className="finished-picture sheet">
          <img src={s.picture} alt={`A picture of ${s.prompt}`} />
          <figcaption>By {listNames(artists.map((id) => nameOf(people, id, me.id)))}</figcaption>
        </figure>
      </div>
    );
  }

  return (
    <div className="doodle-game">
      <p className="prompt-banner">
        🖍️ Draw together: <strong>{s.prompt}</strong>
      </p>
      <div className="doodle-stage doodle-stage-game">
        <DoodleBoard
          items={strokes}
          pageHeight={s.page ?? PAGE}
          tool={tool}
          user={me.id}
          readOnly={!canDraw}
          onAdd={(item) => play.append?.('strokes', item as unknown as Record<string, unknown>)}
          label={`Shared drawing of ${s.prompt}`}
        />
      </div>
      <div className="artists" aria-label="Drawing now">
        {artists.map((id) => (
          <span key={id} className="artist">
            <Avatar person={people.get(id)} size="xs" online={online.has(id)} />
            <span>{nameOf(people, id, me.id)}</span>
          </span>
        ))}
        {!artists.length && <span className="muted">Nobody has drawn yet. Make the first mark!</span>}
      </div>
      {canDraw && (
        <>
          <DoodleTools
            tool={tool}
            onChange={setTool}
            canUndo={undoable >= 0}
            onUndo={() => undoable >= 0 && play.append?.('strokes', { k: 'x', i: undoable, u: me.id })}
          />
          <div className="row row-end">
            <Button variant="primary" icon="check" busy={finishing} disabled={!artists.length} onClick={finish}>
              It's finished! Share it
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Options({ value, onChange }: OptionsProps<{ prompt: string }>) {
  return <PromptField value={value.prompt} onChange={(prompt) => onChange({ prompt })} />;
}

export const doodleTogether: GameDef<State, { prompt: string }> = {
  type: 'doodle_together',
  name: 'Doodle Together',
  emoji: '🖍️',
  blurb: "One big page that everyone draws on at the same time, live. Share it in the chat when it's done.",
  modes: ['coop'],
  players: 'Any number',
  defaults: () => ({ prompt: pick(doodlePrompts) }),
  ready: (o) => o.prompt.trim().length > 0,
  Options,
  create: (o) => ({ mode: 'coop', seats: {}, state: { turn: 'anyone', prompt: o.prompt.trim(), strokes: [], page: PAGE } }),
  Board,
  guide: [
    { title: 'The aim', body: 'Draw one big picture together. Everyone draws on the same page at the same time, and sees each other drawing live.' },
    { title: 'Finishing', body: "When the picture is done, press It's finished! Share it, and it goes into the chat." },
    {
      title: 'Ideas',
      body: ['Share the page out: one person does the sky, another the ground, someone else the people.', 'Add to each other\'s drawings. A house might need a cat in the window.'],
    },
  ],
  status: (g) => (g.status === 'finished' ? g.summary || 'Finished' : `Drawing ${g.state.prompt} · join in`),
};
