/** Short synthesized sound effects — no audio assets needed. */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/** A quick downward "whoosh" chime for a successful mail send. */
export function playSendSound() {
  const audioCtx = getCtx();
  if (!audioCtx) return;
  try {
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const now = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1100, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.28);

    const chime = audioCtx.createOscillator();
    const chimeGain = audioCtx.createGain();
    chime.type = "sine";
    chime.frequency.setValueAtTime(1760, now + 0.16);
    chimeGain.gain.setValueAtTime(0.0001, now + 0.16);
    chimeGain.gain.exponentialRampToValueAtTime(0.1, now + 0.19);
    chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    chime.connect(chimeGain);
    chimeGain.connect(audioCtx.destination);
    chime.start(now + 0.16);
    chime.stop(now + 0.42);
  } catch {
    /* autoplay policy or unsupported — silently skip */
  }
}
