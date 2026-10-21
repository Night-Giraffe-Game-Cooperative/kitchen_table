// A gentle ring for an incoming call: three soft bell notes, then a pause.
// Made with Web Audio, so there's no sound file. Browsers only allow sound
// after someone has tapped the page, so before that the ring is silent and
// the screen does the work.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

function bell(ac: AudioContext, freq: number, at: number) {
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.16, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0008, at + 1.4);
  gain.connect(ac.destination);
  // A sine with a quieter overtone sounds like a small bell.
  for (const [mult, level] of [
    [1, 1],
    [2.76, 0.18],
  ]) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    g.gain.value = level;
    osc.connect(g).connect(gain);
    osc.start(at);
    osc.stop(at + 1.5);
  }
}

/** Starts ringing; returns a function that stops it. */
export function startRinging(): () => void {
  let stopped = false;
  const ring = () => {
    if (stopped) return;
    const ac = audio();
    if (ac && ac.state === 'running') {
      const t = ac.currentTime + 0.05;
      bell(ac, 784, t);
      bell(ac, 988, t + 0.22);
      bell(ac, 1175, t + 0.44);
    }
    navigator.vibrate?.([180, 120, 180]);
  };
  ring();
  const timer = window.setInterval(ring, 2600);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    navigator.vibrate?.(0);
  };
}
