// Reads messages and stories aloud with the device's own voice, for children
// who are still learning to read, and plays the Learn page's recordings.
// The Android app's web view has no voice of its own, so the app lends its one.

interface AppVoice {
  speak(text: string, lang: string, rate: number): void;
  stop(): void;
}

const appVoice: AppVoice | undefined = typeof window !== 'undefined' ? (window as unknown as { KitchenTableVoice?: AppVoice }).KitchenTableVoice : undefined;

export const canSpeak = !!appVoice || (typeof window !== 'undefined' && 'speechSynthesis' in window);

const chosen = new Map<string, SpeechSynthesisVoice | null>();

/** The best voice for a language, like en-GB or ja-JP: a natural-sounding one if there is one. */
function voice(lang: string): SpeechSynthesisVoice | null {
  const known = chosen.get(lang);
  if (known !== undefined) return known;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const base = lang.split('-')[0];
  const same = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-') === lang;
  const found =
    voices.find((v) => same(v) && /natural|neural|google/i.test(v.name)) ??
    voices.find(same) ??
    voices.find((v) => v.lang.startsWith(base)) ??
    null;
  chosen.set(lang, found);
  return found;
}

const clean = (text: string) => text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');

/** Says something in a language, like 'ja-JP'; slowly makes it easier to follow. */
export function speakIn(text: string, lang: string, { slowly = false, onEnd }: { slowly?: boolean; onEnd?: () => void } = {}) {
  if (!canSpeak || !text.trim()) return;
  const rate = slowly ? 0.6 : lang.startsWith('en') ? 0.92 : 0.85;
  player?.pause();
  if (appVoice) {
    appVoice.speak(clean(text), lang, rate);
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean(text));
  const v = voice(lang);
  if (v) u.voice = v;
  u.lang = v?.lang ?? lang;
  u.rate = rate;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}

/** Whether this device seems to have a voice for a language. Browsers load voices late, so unsure counts as yes. */
export function hasVoice(lang: string): boolean {
  if (appVoice) return true;
  if (!canSpeak) return false;
  const voices = window.speechSynthesis.getVoices();
  return !voices.length || voices.some((v) => v.lang.startsWith(lang.split('-')[0]));
}

export function speak(text: string, onEnd?: () => void) {
  speakIn(text, 'en-GB', { onEnd });
}

let player: HTMLAudioElement | null = null;

/** Plays a recording, like a phrase on the Learn page, instead of the device's voice. */
export function playClip(url: string, onEnd?: () => void) {
  stopSpeaking();
  const audio = new Audio(url);
  player = audio;
  audio.onended = audio.onerror = () => onEnd?.();
  audio.play().catch(() => onEnd?.());
}

export function stopSpeaking() {
  player?.pause();
  player = null;
  if (appVoice) appVoice.stop();
  else if (canSpeak) window.speechSynthesis.cancel();
}
