import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { loadImage, toBlob, upload } from '../lib/image';
import { pageHeightFor, renderPicture, type Item } from '../lib/doodle';
import type { Message } from '../lib/types';
import { DoodleBoard, defaultTool, toolFrom, type Tool } from './DoodleBoard';
import { DoodleTools } from './DoodleTools';
import { Button, Dialog, Input, Spinner } from './ui';
import { confirmFirst } from './confirm';

// The tool in hand is remembered between doodles (a new key, so everyone starts with the felt-tip).
const TOOL_KEY = 'doodle-tool-2';

export interface DoodleBackground {
  url: string;
  width: number | null;
  height: number | null;
  messageId?: number;
  file?: File;
}

/** Draw on a photo from the chat, a new photo, or a blank page, then send it. */
export function DoodleEditor({
  roomId,
  background,
  onClose,
  onSent,
}: {
  roomId: number;
  background: DoodleBackground | null;
  onClose: () => void;
  onSent: (m: Message) => void;
}) {
  const { toast } = useStore();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(!background);
  const [items, setItems] = useState<Item[]>([]);
  const [undone, setUndone] = useState<Item[]>([]);
  const [tool, setTool] = useState<Tool>(() => {
    try {
      return toolFrom(JSON.parse(localStorage.getItem(TOOL_KEY) ?? '{}'));
    } catch {
      return defaultTool;
    }
  });
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(TOOL_KEY, JSON.stringify(tool));
    } catch {
      /* fine */
    }
  }, [tool]);

  useEffect(() => {
    if (!background) return;
    loadImage(background.url)
      .then((img) => {
        setImage(img);
        setReady(true);
      })
      .catch((e) => {
        toast(e.message, 'danger');
        onClose();
      });
  }, [background, toast, onClose]);

  const pageHeight = image ? pageHeightFor(image.naturalWidth, image.naturalHeight) : 750;

  async function send() {
    setBusy(true);
    try {
      const canvas = renderPicture(items, pageHeight, image);
      const blob = await toBlob(canvas, image ? 'image/jpeg' : 'image/png', 0.88);
      const { media_id } = await upload(roomId, { blob, width: canvas.width, height: canvas.height });
      const { message } = await api.post<{ message: Message }>(`/api/rooms/${roomId}/messages`, {
        kind: 'doodle',
        body: caption,
        media_id,
        data: background?.messageId ? { on_message_id: background.messageId } : undefined,
      });
      if (background?.file) URL.revokeObjectURL(background.url);
      onSent(message);
    } catch (e) {
      toast((e as Error).message, 'danger');
      setBusy(false);
    }
  }

  async function close() {
    if (items.length && !(await confirmFirst('Throw this doodle away?', 'Throw away'))) return;
    onClose();
  }

  return (
    <Dialog
      open
      onClose={close}
      size="full"
      className="doodle-dialog"
      title={background ? 'Doodle on the photo' : 'Draw a doodle'}
      footer={
        <div className="doodle-send">
          <label className="sr-only" htmlFor="doodle-caption">
            Caption
          </label>
          <Input
            id="doodle-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption…"
            maxLength={400}
          />
          <Button variant="primary" icon="send" busy={busy} disabled={!items.length && !background?.file} onClick={send}>
            Send
          </Button>
        </div>
      }
    >
      <div className="doodle-stage">
        {ready ? (
          <DoodleBoard
            items={items}
            pageHeight={pageHeight}
            background={background?.url}
            tool={tool}
            onAdd={(item) => {
              setItems((xs) => [...xs, item]);
              setUndone([]);
            }}
          />
        ) : (
          <Spinner label="Opening the picture" />
        )}
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
    </Dialog>
  );
}
