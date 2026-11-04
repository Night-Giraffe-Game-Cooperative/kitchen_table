// Real voices for the Learn page: every phrase, sign and kana sound is a
// recording made with an open voice model (tools/voices), so it sounds the
// same everywhere and tablets don't need a Japanese or French voice of their
// own. said.json is what each recording says: a phrase whose words have
// changed since uses the device's voice until it's made again.

import type { Lang, Phrase } from './phrases';
import said from './voices/said.json';

const files = import.meta.glob<string>('./voices/**/*.mp3', { eager: true, import: 'default', query: '?no-inline' });
const saidBy: Record<string, string> = said;

const file = (name: string) => files[`./voices/${name}.mp3`];

/** The recording of a phrase or sign, normal or slow, if there's one for its words now. */
export function phraseClip(lang: Lang, p: Phrase, slowly = false): string | undefined {
  if (saidBy[`${lang}.${p.id}`] !== (p.speak ?? p.text)) return undefined;
  return file(`${lang}/${p.id}${slowly ? '.slow' : ''}`);
}

/** The recording of a kana sound, like ka, the same for hiragana and katakana. */
export const kanaClip = (roman: string): string | undefined => file(`ja/kana.${roman}`);

/** Whether a language has recordings, so it can be heard without a voice on the device. */
export const hasClips = (lang: Lang) => Object.keys(saidBy).some((k) => k.startsWith(`${lang}.`));
