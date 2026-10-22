// Family photos for games: the latest pictures shared in a chat, a picker to
// choose one of them or take a new one, and the upload when the game starts.
// Picture Puzzle, Pairs and Where's the Giraffe? use these.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { preparePhoto, upload } from '../lib/image';
import type { Media, Message } from '../lib/types';
import { Spinner } from '../components/ui';
import { Icon } from '../components/icons';

/** A picture as a game keeps it in its state. */
export interface Picture {
  url: string;
  width: number;
  height: number;
}

export const pictureOf = (m: Media): Picture => ({ url: m.url, width: m.width ?? 1000, height: m.height ?? 1000 });

/** The latest photos in a chat, newest first and each once; null while loading. */
export function useChatPhotos(roomId: number, limit = 12): Media[] | null {
  const [photos, setPhotos] = useState<Media[] | null>(null);
  useEffect(() => {
    let live = true;
    setPhotos(null);
    api
      .get<{ messages: Message[] }>(`/api/rooms/${roomId}/messages`)
      .then((res) => {
        const seen = new Set<string>();
        const list = res.messages
          .filter((m) => m.media && !m.deleted && (m.media.type ?? 'image').startsWith('image'))
          .map((m) => m.media!)
          .reverse()
          .filter((m) => (seen.has(m.key) ? false : (seen.add(m.key), true)))
          .slice(0, limit);
        if (live) setPhotos(list);
      })
      .catch(() => live && setPhotos([]));
    return () => {
      live = false;
    };
  }, [roomId, limit]);
  return photos;
}

/** The chosen photo: one already in the chat, or a new one to upload when the game starts. */
export interface PhotoChoice {
  media: Media | null;
  file: File | null;
}

/** Uploads a new photo if one was taken, and gives the picture to keep in the game. */
export async function chosenPicture(choice: PhotoChoice, roomId: number): Promise<Picture> {
  let media = choice.media;
  if (choice.file) media = (await upload(roomId, await preparePhoto(choice.file))).media;
  if (!media) throw new Error('Choose a picture first.');
  return pictureOf(media);
}

/** Photos from the chat to choose from, and a button for a new one. Picks the latest until someone chooses. */
export function PhotoPicker({
  roomId,
  value,
  onChange,
  legend = 'Picture',
}: {
  roomId: number;
  value: PhotoChoice;
  onChange: (c: PhotoChoice) => void;
  legend?: string;
}) {
  const photos = useChatPhotos(roomId);
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // The latest photo, until one is chosen. Again after the options are reset,
  // as they are when switching between modes.
  useEffect(() => {
    if (photos?.[0] && !value.media && !value.file) onChange({ media: photos[0], file: null });
  }, [photos, value.media, value.file]);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  return (
    <fieldset className="fieldset">
      <legend>{legend}</legend>
      {!photos ? (
        <Spinner label="Finding photos" />
      ) : (
        <div className="photo-pick">
          {preview && (
            <button type="button" className="photo-option" aria-pressed={!!value.file}>
              <img src={preview} alt="Your new photo" />
            </button>
          )}
          {photos.map((m, i) => (
            <button
              key={m.key}
              type="button"
              className="photo-option"
              aria-pressed={!value.file && value.media?.key === m.key}
              aria-label={i === 0 ? 'The latest photo' : `Photo ${i + 1}`}
              onClick={() => onChange({ media: m, file: null })}
            >
              <img src={m.url} alt="" />
            </button>
          ))}
          <button type="button" className="photo-option photo-add" onClick={() => input.current?.click()}>
            <Icon name="camera" size={26} />
            <span>New photo</span>
          </button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setPreview(URL.createObjectURL(file));
              onChange({ file, media: null });
            }}
          />
        </div>
      )}
      {photos && photos.length === 0 && !preview && <p className="muted">No photos in this chat yet. Add a new one.</p>}
    </fieldset>
  );
}
