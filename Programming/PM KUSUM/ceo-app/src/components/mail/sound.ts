/** Short synthesized sound + motion effects — no assets, no React state. */

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

/**
 * A paper-plane icon that flies away from (x, y) — deliberately a raw DOM
 * element driven by the native Web Animations API, not a React/Framer
 * Motion component. Sending a mail triggers a heavy re-render right after
 * (fullscreen compose closing, thread list reappearing), and a rAF-driven
 * Framer Motion animation started around the same moment gets starved by
 * that main-thread work — it doesn't play until the congestion clears,
 * by which point the user has stopped looking. A WAAPI animation is
 * scheduled on the compositor once .animate() is called and keeps playing
 * regardless of what the main thread does afterward.
 */
export function playSendFlyAnimation(x: number, y: number) {
  if (typeof document === "undefined") return;
  try {
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;left:0;top:0;z-index:300;pointer-events:none;" +
      "color:var(--accent-bright,#8b5cf6);";
    el.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13">' +
      '</line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
    document.body.appendChild(el);

    const anim = el.animate(
      [
        { transform: `translate(${x}px, ${y}px) rotate(-8deg) scale(1)`, opacity: 1 },
        {
          transform: `translate(${x + 160}px, ${y - 180}px) rotate(35deg) scale(0.4)`,
          opacity: 0,
        },
      ],
      { duration: 700, easing: "ease-in", fill: "forwards" },
    );
    const cleanup = () => el.remove();
    anim.addEventListener("finish", cleanup);
    anim.addEventListener("cancel", cleanup);
  } catch {
    /* unsupported — silently skip, it's decorative */
  }
}
