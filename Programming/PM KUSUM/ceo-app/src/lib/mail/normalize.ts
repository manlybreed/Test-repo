/** Strip HTML to plain text (lightweight). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function normalizeSubject(subject: string): string {
  return subject.replace(/^(re|fw|fwd|aw|sv):\s*/gi, "").trim() || "(no subject)";
}

/** Thread key from References / In-Reply-To / subject. */
export function threadKey(opts: {
  references?: string | null;
  inReplyTo?: string | null;
  rfcMessageId?: string | null;
  subject: string;
}): string {
  const refs = (opts.references || "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (opts.inReplyTo?.trim()) refs.unshift(opts.inReplyTo.trim());
  if (refs.length) return refs[0]!;
  if (opts.rfcMessageId?.trim()) return opts.rfcMessageId.trim();
  return `subj:${normalizeSubject(opts.subject).toLowerCase()}`;
}

export function parseAddressList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((a) => {
        if (typeof a === "string") return a;
        if (a && typeof a === "object" && "address" in a) {
          return String((a as { address?: string }).address || "");
        }
        return "";
      })
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function snippetFromBody(text: string | null | undefined, max = 160): string {
  if (!text) return "";
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}
