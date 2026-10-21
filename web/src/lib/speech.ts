// Reads messages and stories aloud with the device's own voice, for children
// who are still learning to read.

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

let chosen: SpeechSynthesisVoice | null | undefined;

function voice(): SpeechSynthesisVoice | null {
  if (chosen !== undefined) return chosen;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  chosen =
    voices.find((v) => v.lang === 'en-GB' && /natural|neural|google/i.test(v.name)) ??
    voices.find((v) => v.lang === 'en-GB') ??
    voices.find((v) => v.lang.startsWith('en')) ??
    null;
  return chosen;
}

export function speak(text: string, onEnd?: () => void) {
  if (!canSpeak || !text.trim()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ''));
  const v = voice();
  if (v) u.voice = v;
  u.lang = v?.lang ?? 'en-GB';
  u.rate = 0.92;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (canSpeak) window.speechSynthesis.cancel();
}
