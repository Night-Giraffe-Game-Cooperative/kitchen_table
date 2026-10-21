import { useState } from 'react';
import { toBlob, upload } from '../../lib/image';
import { renderPicture, type Item } from '../../lib/doodle';
import { useStore } from '../../lib/store';
import type { Media } from '../../lib/types';
import { DoodleBoard, defaultTool, type Tool } from '../../components/DoodleBoard';
import { DoodleTools } from '../../components/DoodleTools';
import { Button } from '../../components/ui';

const PAGE = 700;

/** A private page: draw, then send the finished picture as a photo in the room. */
export function DrawPad({ roomId, label, sendLabel, onSent }: { roomId: number; label: string; sendLabel: string; onSent: (m: Media) => Promise<unknown> }) {
  const { toast } = useStore();
  const [items, setItems] = useState<Item[]>([]);
  const [undone, setUndone] = useState<Item[]>([]);
  const [tool, setTool] = useState<Tool>(defaultTool);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const canvas = renderPicture(items, PAGE, null, 1200);
      const blob = await toBlob(canvas, 'image/png');
      const { media } = await upload(roomId, { blob, width: canvas.width, height: canvas.height });
      await onSent(media);
      setItems([]);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawpad">
      <div className="doodle-stage doodle-stage-game">
        <DoodleBoard
          items={items}
          pageHeight={PAGE}
          tool={tool}
          label={label}
          onAdd={(i) => {
            setItems((xs) => [...xs, i]);
            setUndone([]);
          }}
        />
      </div>
      <DoodleTools
        tool={tool}
        onChange={setTool}
        canUndo={items.length > 0}
        canRedo={undone.length > 0}
        onUndo={() => {
          setUndone((u) => [...u, items[items.length - 1]]);
          setItems((xs) => xs.slice(0, -1));
        }}
        onRedo={() => {
          setItems((xs) => [...xs, undone[undone.length - 1]]);
          setUndone((u) => u.slice(0, -1));
        }}
      />
      <div className="row row-end">
        <Button variant="primary" icon="send" busy={busy} disabled={!items.length} onClick={send}>
          {sendLabel}
        </Button>
      </div>
    </div>
  );
}
