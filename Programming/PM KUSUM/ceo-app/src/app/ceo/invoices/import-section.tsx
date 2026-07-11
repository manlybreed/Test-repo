"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { InvoiceImporter } from "@/components/invoice-importer";

export function ImportSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function handleSaved(num: string) {
    setOpen(false);
    router.push(`/ceo/invoices?created=${num}`);
  }

  return (
    <section className="relative overflow-hidden rounded-xl mb-8"
      style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 50% 60% at 0% 0%, rgba(99,102,241,0.06) 0%, transparent 55%)" }} />
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-3 p-5 transition-colors"
          style={{ cursor: "pointer", background: "transparent", border: "none", textAlign: "left" }}
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Import Invoice from Zoho / Tally / QuickBooks</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
              Upload any PDF or image — Claude extracts all details automatically
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[0.6rem] px-2 py-0.5 rounded font-semibold"
              style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}>
              AI
            </span>
            <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}
              style={{ color: "var(--text-dim)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M19 9l-7 7-7-7"/>
              </svg>
            </motion.span>
          </div>
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              style={{ overflow: "hidden" }}
            >
              <div className="px-5 pb-5" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="pt-4">
                  <InvoiceImporter onSaved={handleSaved} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
