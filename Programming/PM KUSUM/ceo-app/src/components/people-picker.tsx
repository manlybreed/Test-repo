"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { haptic } from "@/components/mail/haptics";
import { findContactsAction } from "@/actions/mail";
import {
  avatarHue,
  parseRecipients,
  recipientInitials,
  serializeRecipients,
  type Recipient,
} from "@/lib/mail/recipients";

type ContactSuggestion = { address: string; displayName: string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Shared chip-based recipient input for Mail's To/Cc/Bcc and Calendar's
 * Guests/Attendees — replaces free-text fields with removable person
 * chips plus the same real contact-search dropdown Mail already had.
 *
 * Keeps the exact same external contract as the old plain-text fields:
 * `value`/`onChange` are still just the comma-joined string every
 * downstream send/save/validate path already expects — only the input
 * *widget* changes.
 */
export function PeoplePicker({
  id,
  value,
  onChange,
  placeholder,
  wrapClassName,
  accountId,
  bordered = true,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  wrapClassName?: string;
  accountId?: string;
  /** false when the parent row already supplies the "looks like a field"
   * background/border (Mail's `.mail-compose-field` grid row) — true
   * (default) renders its own bordered box, matching Calendar's existing
   * plain-input styling. */
  bordered?: boolean;
}) {
  const committed = parseRecipients(value);
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function scheduleLookup(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void findContactsAction(v.trim(), accountId)
        .then((rows) => {
          setSuggestions(rows);
          setOpen(rows.length > 0);
          setActiveIndex(0);
        })
        .catch(() => {
          setSuggestions([]);
          setOpen(false);
        });
    }, 200);
  }

  function commit(next: Recipient[]) {
    onChange(serializeRecipients(next));
  }

  function addRecipient(r: Recipient) {
    commit([...committed, r]);
    setDraft("");
    setSuggestions([]);
    setOpen(false);
    haptic("tap");
  }

  /** Parses whatever's currently typed (possibly several comma-separated
   * raw addresses pasted at once) into one or more chips. */
  function commitDraft() {
    const parsed = parseRecipients(draft);
    if (!parsed.length) return;
    commit([...committed, ...parsed]);
    setDraft("");
    setSuggestions([]);
    setOpen(false);
  }

  function removeAt(i: number) {
    commit(committed.filter((_, j) => j !== i));
    haptic("tap");
  }

  return (
    <div
      ref={wrapRef}
      className={`relative flex w-full cursor-text flex-wrap items-center gap-1.5 ${
        bordered ? "rounded-lg px-3 py-2" : ""
      } ${wrapClassName || ""}`}
      style={
        bordered
          ? {
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
            }
          : undefined
      }
      onClick={() => inputRef.current?.focus()}
    >
      <AnimatePresence initial={false}>
        {committed.map((r, i) => {
          const hue = avatarHue(r.address);
          const valid = EMAIL_RE.test(r.address);
          return (
            <motion.span
              key={`${r.address}-${i}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-2 text-[0.7rem] font-medium"
              style={{
                background: "var(--bg-elevated)",
                border: `1px solid ${valid ? "var(--border-strong)" : "rgba(248,113,113,0.5)"}`,
                color: "var(--text-muted)",
              }}
            >
              <span
                className="flex shrink-0 items-center justify-center rounded-full text-[0.6rem] font-semibold"
                style={{
                  width: 18,
                  height: 18,
                  background: `hsl(${hue} 48% 32%)`,
                  color: `hsl(${hue} 80% 90%)`,
                }}
              >
                {recipientInitials(r)}
              </span>
              <span className="max-w-40 truncate">{r.displayName || r.address}</span>
              <button
                type="button"
                title="Remove"
                className="cursor-pointer opacity-70 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(i);
                }}
              >
                <X size={11} />
              </button>
            </motion.span>
          );
        })}
      </AnimatePresence>
      <input
        ref={inputRef}
        id={id}
        placeholder={committed.length ? "" : placeholder}
        value={draft}
        autoComplete="off"
        className="min-w-[8ch] flex-1"
        style={{
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text)",
          ...(bordered ? { fontSize: "0.875rem", padding: "0.15rem 0" } : {}),
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          scheduleLookup(e.target.value);
        }}
        onKeyDown={(e) => {
          if (open && suggestions.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              e.stopPropagation();
              addRecipient(suggestions[activeIndex]!);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              return;
            }
          }
          if ((e.key === "Enter" || e.key === "Tab" || e.key === ",") && draft.trim()) {
            e.preventDefault();
            commitDraft();
            return;
          }
          if (e.key === "Backspace" && !draft && committed.length) {
            removeAt(committed.length - 1);
          }
        }}
        onBlur={() => {
          if (draft.trim()) commitDraft();
        }}
      />
      {open && suggestions.length > 0 && (
        <ul
          className="absolute left-0 top-full z-20 mt-1 max-h-48 w-72 overflow-auto rounded-xl p-1 text-xs shadow-lg"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
          }}
        >
          {suggestions.map((s, i) => (
            <li key={s.address}>
              <button
                type="button"
                className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                style={{
                  background: i === activeIndex ? "var(--accent-dim)" : "transparent",
                  color: "var(--text)",
                }}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => addRecipient(s)}
              >
                <div className="truncate font-medium">{s.displayName || s.address}</div>
                {s.displayName && (
                  <div className="truncate text-[0.65rem]" style={{ color: "var(--text-dim)" }}>
                    {s.address}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
