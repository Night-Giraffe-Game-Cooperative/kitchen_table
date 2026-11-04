import { describe, expect, it } from 'vitest';
import { allPhrases, kanaList, languages } from './phrases';
import { hasClips, kanaClip, phraseClip } from './voices';

describe('real voices', () => {
  // If this fails, a phrase's words changed: run tools/voices/make.py to record it again.
  it('has a recording of every phrase and sign as it says now, normal and slow', () => {
    for (const lang of languages) {
      expect(hasClips(lang.id)).toBe(true);
      for (const p of [...allPhrases(lang), ...lang.signs]) {
        expect(phraseClip(lang.id, p), `${lang.id}.${p.id}`).toMatch(/\.mp3\b/);
        expect(phraseClip(lang.id, p, true), `${lang.id}.${p.id} slowly`).toMatch(/\.slow\.mp3\b/);
      }
    }
  });

  it('uses the device voice for a phrase whose words changed after it was recorded', () => {
    const hello = allPhrases(languages[0])[0];
    expect(phraseClip('ja', { ...hello, text: 'やあ' })).toBeUndefined();
  });

  it('has every kana sound, once for both scripts', () => {
    for (const k of kanaList('hira')) expect(kanaClip(k.roman), k.roman).toMatch(/\.mp3\b/);
  });
});
