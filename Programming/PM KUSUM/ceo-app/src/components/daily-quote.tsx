"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Risk comes from not knowing what you are doing.", author: "Warren Buffett" },
  { text: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
  { text: "Vision without execution is hallucination.", author: "Thomas Edison" },
  { text: "In the middle of every difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Focus is about saying no.", author: "Steve Jobs" },
  { text: "Opportunities don't happen. You create them.", author: "Chris Grosser" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
  { text: "Don't count the days, make the days count.", author: "Muhammad Ali" },
  { text: "Quality is not an act, it is a habit.", author: "Aristotle" },
  { text: "Energy and persistence conquer all things.", author: "Benjamin Franklin" },
  { text: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupéry" },
  { text: "Work hard in silence, let success make the noise.", author: "Frank Ocean" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
  { text: "Everything you want is on the other side of fear.", author: "Jack Canfield" },
  { text: "Your time is limited, don't waste it living someone else's life.", author: "Steve Jobs" },
  { text: "Success usually comes to those who are too busy to be looking for it.", author: "Henry David Thoreau" },
  { text: "Clarity is power.", author: "Tony Robbins" },
  { text: "Great things are done by a series of small things brought together.", author: "Vincent Van Gogh" },
  { text: "The mind is everything. What you think, you become.", author: "Buddha" },
  { text: "It is not the mountain we conquer, but ourselves.", author: "Edmund Hillary" },
  { text: "Do not wait to strike till the iron is hot, but make it hot by striking.", author: "W.B. Yeats" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
];

function getDailyIndex(): number {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  return dayOfYear % QUOTES.length;
}

export function DailyQuote() {
  const [idx, setIdx] = useState(getDailyIndex);
  const [auto, setAuto] = useState(true);

  // Auto-cycle every 30 seconds
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % QUOTES.length);
    }, 30000);
    return () => clearInterval(id);
  }, [auto]);

  const quote = QUOTES[idx];

  return (
    <div
      className="relative overflow-hidden rounded-xl p-5 mb-8"
      style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
    >
      {/* Ambient glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 70% 90% at 95% 50%, rgba(240,180,41,0.06) 0%, transparent 60%)",
        }}
      />

      <div className="relative flex items-start gap-4">
        {/* Big quote mark */}
        <span
          className="text-5xl leading-none select-none shrink-0 mt-1"
          style={{ color: "rgba(240,180,41,0.35)", fontFamily: "Georgia, serif", lineHeight: 0.8 }}
        >
          &ldquo;
        </span>

        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35, ease: "easeInOut" }}
            >
              <p className="text-[0.95rem] font-medium leading-relaxed" style={{ color: "var(--text)" }}>
                {quote.text}
              </p>
              <p className="mt-2 text-[0.68rem] tracking-[0.15em] uppercase font-medium" style={{ color: "var(--text-dim)" }}>
                — {quote.author}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Next quote button */}
        <button
          type="button"
          title="Next quote"
          onClick={() => { setAuto(false); setIdx((i) => (i + 1) % QUOTES.length); }}
          className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-all self-center"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-dim)",
            cursor: "pointer",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </div>

      {/* Dot indicators */}
      <div className="flex items-center gap-1 mt-3 pl-12">
        {Array.from({ length: Math.min(8, QUOTES.length) }).map((_, i) => {
          const dotIdx = (getDailyIndex() + i) % QUOTES.length;
          return (
            <button
              key={i}
              type="button"
              onClick={() => { setAuto(false); setIdx(dotIdx); }}
              className="rounded-full transition-all"
              style={{
                width: dotIdx === idx ? 16 : 4,
                height: 4,
                background: dotIdx === idx ? "var(--gold)" : "rgba(255,255,255,0.12)",
                cursor: "pointer",
                border: "none",
                padding: 0,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
