"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { haptic } from "@/components/mail/haptics";

export type MailMessageView = {
  id: string;
  fromAddress: string;
  fromName?: string | null;
  toAddresses?: string;
  ccAddresses?: string;
  subject: string;
  date: string | Date;
  bodyHtml: string | null;
  bodyText: string | null;
  hasAttachments?: boolean;
  attachments?: {
    id: string;
    filename: string;
    size?: number | null;
    extractStatus?: string | null;
  }[];
  listUnsubscribe?: string | null;
};

function parseAddrs(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
  } catch {
    /* plain CSV fallback */
  }
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function initials(name: string | null | undefined, email: string) {
  const src = (name || email.split("@")[0] || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/** Strip inline colors/backgrounds so dark UI stays readable. */
function stripMailThemeStyles(html: string) {
  return html
    .replace(/\sbgcolor\s*=\s*(["'])[^"']*\1/gi, "")
    .replace(/\sbackground\s*=\s*(["'])[^"']*\1/gi, "")
    .replace(/\scolor\s*=\s*(["'])[^"']*\1/gi, "")
    .replace(/\sstyle\s*=\s*(["'])(.*?)\1/gi, (_m, q: string, styles: string) => {
      const cleaned = styles
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((decl) => {
          const prop = decl.split(":")[0]?.trim().toLowerCase() || "";
          return !(
            prop === "color" ||
            prop === "background" ||
            prop === "background-color" ||
            prop === "background-image" ||
            prop.startsWith("background-")
          );
        })
        .join("; ");
      return cleaned ? ` style=${q}${cleaned}${q}` : "";
    });
}

/**
 * Light HTML hygiene for untrusted mail bodies.
 * Critical: strip <style>/<link>/<base> — marketing mail (e.g. Claude)
 * ships global CSS that otherwise breaks the whole app shell.
 */
export function prepareMailHtml(
  html: string | null,
  text: string | null,
  mode: "dark" | "original" = "dark",
) {
  if (!html?.trim()) {
    const escaped = (text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<pre class="mail-plain">${escaped || "<em>Empty message</em>"}</pre>`;
  }
  let out = html
    // Document chrome — keep inner content only
    .replace(/<\/?(html|head|body|meta|title|xml)(\s[^>]*)?>/gi, "")
    // Global CSS / external styles break the CEO shell
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/<form[\s\S]*?>[\s\S]*?<\/form>/gi, "")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "")
    // Kill layout-breaking positioning from email CSS-in-attrs
    .replace(
      /\sstyle\s*=\s*(["'])(.*?)\1/gi,
      (_m, q: string, styles: string) => {
        const cleaned = styles
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((decl) => {
            const prop = decl.split(":")[0]?.trim().toLowerCase() || "";
            if (
              prop === "position" ||
              prop === "z-index" ||
              prop === "top" ||
              prop === "left" ||
              prop === "right" ||
              prop === "bottom" ||
              prop === "fixed" ||
              prop.startsWith("animation") ||
              prop === "transform"
            ) {
              return false;
            }
            // Cap absurd fixed widths that blow the pane
            if ((prop === "width" || prop === "min-width") && /\d{4,}px/i.test(decl)) {
              return false;
            }
            return true;
          })
          .join("; ");
        return cleaned ? ` style=${q}${cleaned}${q}` : "";
      },
    )
    .replace(/\swidth\s*=\s*["']?\d{4,}["']?/gi, ' width="100%"')
    .replace(/\sheight\s*=\s*["']?\d{4,}["']?/gi, "");

  if (mode === "dark") out = stripMailThemeStyles(out);
  return out;
}

export function looksLikeBrandedHtml(html: string | null) {
  if (!html) return false;
  return /bgcolor\s*=|background(-color)?\s*:|style\s*=\s*["'][^"']*background/i.test(
    html,
  );
}

function splitQuoted(html: string): { main: string; quote: string | null } {
  const markers = [
    /(<div[^>]*class=["'][^"']*gmail_quote[^"']*["'][^>]*>[\s\S]*)/i,
    /(<blockquote[\s\S]*)/i,
    /(-----Original Message-----[\s\S]*)/i,
    /(<div[^>]*>\s*On .+wrote:[\s\S]*)/i,
  ];
  for (const re of markers) {
    const m = html.match(re);
    if (m?.index != null && m.index > 40) {
      return {
        main: html.slice(0, m.index).trim(),
        quote: m[0],
      };
    }
  }
  return { main: html, quote: null };
}

const spring = { type: "spring" as const, stiffness: 420, damping: 32 };

export function MessageReader({
  message,
  index = 0,
  defaultExpanded = true,
  onSummarizeAttachment,
  onUnsubscribe,
}: {
  message: MailMessageView;
  index?: number;
  defaultExpanded?: boolean;
  onSummarizeAttachment?: (attachmentId: string, filename: string) => void;
  onUnsubscribe?: (messageId: string) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showQuote, setShowQuote] = useState(false);
  const branded = looksLikeBrandedHtml(message.bodyHtml);
  const [viewMode, setViewMode] = useState<"dark" | "original">("dark");
  const to = useMemo(() => parseAddrs(message.toAddresses), [message.toAddresses]);
  const cc = useMemo(() => parseAddrs(message.ccAddresses), [message.ccAddresses]);
  const prepared = useMemo(
    () => prepareMailHtml(message.bodyHtml, message.bodyText, viewMode),
    [message.bodyHtml, message.bodyText, viewMode],
  );
  const { main, quote } = useMemo(() => splitQuoted(prepared), [prepared]);
  const displayName = message.fromName || message.fromAddress;
  const hue =
    [...(message.fromAddress || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: index * 0.04 }}
      className="overflow-hidden rounded-2xl"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        boxShadow: "0 10px 32px rgba(0,0,0,0.28)",
      }}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left"
        onClick={() => {
          setExpanded((v) => !v);
          haptic("tap");
        }}
        style={{ borderBottom: expanded ? "1px solid var(--border)" : undefined }}
      >
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style={{
            background: `hsl(${hue} 42% 28%)`,
            color: `hsl(${hue} 70% 88%)`,
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {initials(message.fromName, message.fromAddress)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="truncate text-[15px] font-semibold" style={{ color: "var(--text)" }}>
              {displayName}
            </p>
            <time
              className="shrink-0 text-xs tabular-nums"
              style={{ color: "var(--text-dim)" }}
              suppressHydrationWarning
            >
              {new Date(message.date).toLocaleString("en-GB", {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </time>
          </div>
          <p className="mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>
            {message.fromAddress}
          </p>
          {!expanded && (
            <p className="mt-1.5 line-clamp-2 text-sm" style={{ color: "var(--text-dim)" }}>
              {(message.bodyText || "").replace(/\s+/g, " ").slice(0, 160) || "Open to read"}
            </p>
          )}
        </div>
        <span
          className="mt-1 text-xs"
          style={{ color: "var(--text-dim)", transform: expanded ? "rotate(180deg)" : undefined }}
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3">
          <dl className="mb-4 space-y-2 rounded-xl px-3.5 py-3 text-sm" style={{
            background: "rgba(0,0,0,0.22)",
            border: "1px solid var(--border)",
          }}>
            <div className="grid grid-cols-[4.5rem_1fr] gap-2">
              <dt className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>
                From
              </dt>
              <dd style={{ color: "var(--text)" }}>
                {displayName}
                <span className="ml-1.5" style={{ color: "var(--text-muted)" }}>
                  &lt;{message.fromAddress}&gt;
                </span>
              </dd>
            </div>
            {to.length > 0 && (
              <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                <dt className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>
                  To
                </dt>
                <dd className="flex flex-wrap gap-1.5">
                  {to.map((a) => (
                    <span
                      key={a}
                      className="rounded-md px-2 py-0.5 text-xs"
                      style={{
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid var(--border-strong)",
                        color: "var(--text)",
                      }}
                    >
                      {a}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {cc.length > 0 && (
              <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                <dt className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>
                  Cc
                </dt>
                <dd className="flex flex-wrap gap-1.5">
                  {cc.map((a) => (
                    <span
                      key={a}
                      className="rounded-md px-2 py-0.5 text-xs"
                      style={{
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid var(--border-strong)",
                        color: "var(--text)",
                      }}
                    >
                      {a}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            <div className="grid grid-cols-[4.5rem_1fr] gap-2">
              <dt className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>
                Subject
              </dt>
              <dd style={{ color: "var(--text)" }}>{message.subject}</dd>
            </div>
          </dl>

          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.65rem] uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>
              Message
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                className="cursor-pointer rounded-md px-2.5 py-1 text-[0.65rem] font-semibold"
                style={{
                  background: viewMode === "dark" ? "var(--accent-dim)" : "transparent",
                  color: viewMode === "dark" ? "var(--accent-bright)" : "var(--text-muted)",
                  border: "1px solid var(--border)",
                }}
                onClick={() => {
                  setViewMode("dark");
                  haptic("tap");
                }}
              >
                Dark adapt
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-md px-2.5 py-1 text-[0.65rem] font-semibold"
                style={{
                  background: viewMode === "original" ? "var(--accent-dim)" : "transparent",
                  color: viewMode === "original" ? "var(--accent-bright)" : "var(--text-muted)",
                  border: "1px solid var(--border)",
                }}
                onClick={() => {
                  setViewMode("original");
                  haptic("tap");
                }}
                title={
                  branded
                    ? "Show the email’s original light theme (newsletters)"
                    : "Show original HTML colors"
                }
              >
                Original
              </button>
            </div>
          </div>

          <div
            className={
              viewMode === "dark"
                ? "mail-message-body mail-dark-adapt"
                : "mail-message-body mail-original"
            }
            dangerouslySetInnerHTML={{ __html: main }}
          />

          {quote && (
            <div className="mt-4">
              <button
                type="button"
                className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium"
                style={{
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                }}
                onClick={() => {
                  setShowQuote((v) => !v);
                  haptic("tap");
                }}
              >
                {showQuote ? "Hide quoted history" : "Show quoted history"}
              </button>
              {showQuote && (
                <div
                  className={
                    viewMode === "dark"
                      ? "mail-message-body mail-message-quote mail-dark-adapt mt-3"
                      : "mail-message-body mail-message-quote mail-original mt-3"
                  }
                  dangerouslySetInnerHTML={{ __html: quote }}
                />
              )}
            </div>
          )}

          {message.attachments && message.attachments.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {message.attachments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-1.5">
                  <a
                    href={`/api/mail/attachments/${a.id}`}
                    download={a.filename}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-opacity hover:opacity-90"
                    style={{
                      background: "var(--accent-dim)",
                      border: "1px solid rgba(99,102,241,0.3)",
                      color: "var(--accent-bright)",
                    }}
                    onClick={() => haptic("tap")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 3v12" />
                      <path d="M8 11l4 4 4-4" />
                      <path d="M4 19h16" />
                    </svg>
                    {a.filename}
                    {a.size != null ? ` · ${Math.max(1, Math.round(a.size / 1024))} KB` : ""}
                  </a>
                  {onSummarizeAttachment && (
                    <button
                      type="button"
                      className="cursor-pointer rounded-lg px-2.5 py-2 text-[0.65rem] font-medium"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid var(--border-strong)",
                        color: "var(--text-muted)",
                      }}
                      onClick={() => {
                        haptic("tap");
                        onSummarizeAttachment(a.id, a.filename);
                      }}
                    >
                      AI summary
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {message.listUnsubscribe && onUnsubscribe && (
            <button
              type="button"
              className="mt-3 cursor-pointer text-[0.7rem] font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--text-dim)" }}
              onClick={() => {
                haptic("tap");
                onUnsubscribe(message.id);
              }}
            >
              Unsubscribe options…
            </button>
          )}
        </div>
      )}
    </motion.article>
  );
}
