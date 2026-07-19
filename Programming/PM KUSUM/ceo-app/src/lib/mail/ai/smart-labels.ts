/** Canonical AI smart labels applied by triage. */

export const SMART_LABELS = [
  "NEEDS_REPLY",
  "FYI",
  "RECEIPT",
  "BANKING",
  "PM_KUSUM",
  "NEWSLETTER",
  "WAITING_ON_THEM",
] as const;

export type SmartLabel = (typeof SMART_LABELS)[number];

export const SMART_LABEL_SET = new Set<string>(SMART_LABELS);

/** Labels that mean "noise / not for Smart Inbox". */
export const SMART_INBOX_EXCLUDE_LABELS = [
  "NEWSLETTER",
  "RECEIPT",
  "BANKING",
] as const;

export const SMART_LABEL_META: Record<
  SmartLabel,
  { label: string; hint: string; definition: string }
> = {
  NEEDS_REPLY: {
    label: "Needs reply",
    hint: "Waiting on you",
    definition:
      "A real person is asking you something or needs a decision. NEVER for newsletters, marketing, promos, or automated mail — even if the subject has a question mark.",
  },
  FYI: {
    label: "FYI",
    hint: "No action needed",
    definition:
      "Informational only — status updates, acknowledgements, test messages, or notes that do not need a reply and are not transactional receipts.",
  },
  RECEIPT: {
    label: "Receipt",
    hint: "Bills / confirmations",
    definition:
      "Commerce proof of purchase only: merchant invoices, order confirmations, shipping notices. NOT bank/UPI/card account alerts (use BANKING).",
  },
  BANKING: {
    label: "Banking",
    hint: "Bank / UPI / cards",
    definition:
      "Bank and payment-rail mail: e-statements, POS statements, NEFT/IMPS/RTGS/UPI alerts, account credited/debited, balance alerts, card transaction alerts from banks/wallets.",
  },
  PM_KUSUM: {
    label: "PM KUSUM",
    hint: "Solar / KUSUM",
    definition:
      "Mail about the PM KUSUM scheme or BluRidge KUSUM work: plants, Component A/B/C, solar pumps, feeder-level solar, DPR/PPA/LOA, MNRE/discom, KUSUM financing or mandates. Can pair with NEEDS_REPLY.",
  },
  NEWSLETTER: {
    label: "Newsletter",
    hint: "Marketing / digests",
    definition:
      "Bulk marketing, product digests, mailing-list mail with unsubscribe, promotions, sales, or automated noreply campaigns.",
  },
  WAITING_ON_THEM: {
    label: "Waiting on them",
    hint: "Ball in their court",
    definition:
      "You already asked/sent something and the next action is theirs (awaiting their reply or delivery). Never for promotional mail.",
  },
};

/** Strong receipt/transaction signals — require at least one to keep RECEIPT. */
const RECEIPT_POSITIVE =
  /\b(invoice|receipt|payment\s+(received|confirmed|successful)|order\s*#?\s*\d|tax\s*invoice|proforma|credit\s*note|debit\s*note|shipping\s*confirmation|tracking\s*number|booking\s*confirmed|subscription\s*(renewed|charged)|statement\s+ready)\b/i;

const RECEIPT_MONEY = /(?:₹|rs\.?\s*|inr\s*|usd\s*|\$)\s*[\d,]+(?:\.\d{2})?/i;

const BANKING_POSITIVE =
  /\b(e-?statement|pos\s+e-?statement|account\s+(statement|summary|alert)|mini\s+statement|neft|imps|rtgs|upi\s+(txn|transaction|alert|ref)|a\/c\b|account\s+(credited|debited|xx)|available\s+balance|debit\s+card\s+(txn|transaction|alert)|credit\s+card\s+(txn|transaction|alert)|net\s*banking|banking\s+alert|transaction\s+alert|inward\s+remittance|outward\s+remittance|txn\s*(id|alert)|card\s+ending)\b/i;

const BANKING_FROM =
  /\b(hdfc|icici|axisbank|axis\.|sbi\.|statebank|kotak|yesbank|idfc|indusind|rblbank|federalbank|hsbc|citibank|standardchartered|paytm|phonepe|reportsmailer|bank\.|alerts?@|statement@|noreply@.*bank)\b/i;

/** PM KUSUM / BluRidge solar-finance project mail. */
const PM_KUSUM_POSITIVE =
  /\b(pm\s*[-_]?kusum|pmkusum|kusum\s*(scheme|component|plant|project|loan|finance|mandate|dpr|ppa|loa)?|component\s*[abc]\b.*solar|solar\s*(pump|feeder|agriculture)|feeder\s*level\s*solar|mnre|discom.*solar|bluridge.*kusum|kusum.*bluridge)\b/i;

const NEWSLETTER_POSITIVE =
  /\b(unsubscribe|view\s+in\s+browser|manage\s+preferences|newsletter|digest|weekly\s+roundup|you('re|\s+are)\s+receiving\s+this|top\s+tech\s+content|sent\s+at\s+noon|click\.(redditmail|mail)|tracking\.(mail|send)|list-unsubscribe)\b/i;

/** Broader promo / marketing — never NEEDS_REPLY. */
const PROMO_POSITIVE =
  /\b(%\s*off|flat\s*\d+\s*%|limited[- ]time|shop\s+now|buy\s+now|flash\s+sale|exclusive\s+offer|promo(tion|tional)?|marketing|sale\s+ends|use\s+code|coupon|newsletter|digest|round[- ]?up|view\s+in\s+browser|manage\s+preferences|unsubscribe|open\s+in\s+(the\s+)?app|download\s+our\s+app|don'?t\s+miss|hurry|deal\s+of\s+the\s+day|top\s+tech\s+content|ai\s+coding\s+tip)\b/i;

const NOREPLY_FROM =
  /^(no[-_.]?reply|donotreply|do[-_.]?not[-_.]?reply|newsletter|marketing|promo|notifications?|notify|news|updates?|mailer|bounce|digest|alerts?)\b/i;

/** Known bulk / social / digest domains — always NEWSLETTER. */
const BULK_FROM_DOMAINS =
  /\b(hackernoon\.com|redditmail\.com|reddit\.com|substack\.com|medium\.com|mailchimp\.com|sendgrid\.net|mailgun\.org|sparkpostmail\.com|convertkit\.com|beehiiv\.com|ghost\.io|linkedin\.com|facebookmail\.com|twitter\.com|x\.com|googlegroups\.com|email\.apple\.com|email\.claude\.com|anthropic\.com|e\.stripe\.com|mc\.+|newsletter\.|news\.|marketing\.)/i;

/**
 * Strong human ask cues only — bare "?" is NOT enough (promos love questions).
 */
const NEEDS_REPLY_CUES =
  /\b(can you|could you|would you|please (reply|confirm|advise|review|approve|let me know|share|send|sign)|what do you think|awaiting your|need your (input|feedback|response|approval|thoughts)|kindly (reply|confirm|advise|approve)|looking forward to your (reply|response)|when (can|could) you|do you (have|want|need|think))\b/i;

const TEST_OR_ACK =
  /\b(test(ing)?(\s+email|\s+mail)?|it worked|got it|thanks?|thank you|ok(ay)?|noted|acknowledged|sounds good|lgtm|received your (mail|email)|just checking)\b/i;

export function parseLabelsJson(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function hasSmartLabel(labels: string[]): boolean {
  return labels.some((l) => SMART_LABEL_SET.has(l));
}

export function isSmartLabel(value: string): value is SmartLabel {
  return SMART_LABEL_SET.has(value);
}

export function stripSmartLabels(labels: string[]): string[] {
  return labels.filter((l) => !SMART_LABEL_SET.has(l));
}

/** Replace prior smart labels with the new set; keep custom/IMAP labels. */
export function mergeSmartLabels(
  existing: string[],
  nextSmart: string[],
): string[] {
  const smart = nextSmart.filter(isSmartLabel);
  return Array.from(new Set([...stripSmartLabels(existing), ...smart]));
}

export type LabelRefineContext = {
  subject: string;
  /** Concatenated from/snippets/bodies used for triage. */
  text: string;
  fromAddresses?: string[];
  myAddress?: string | null;
  hasListUnsubscribe?: boolean;
};

function corpus(ctx: LabelRefineContext): string {
  return `${ctx.subject}\n${ctx.text}`.toLowerCase();
}

export function looksLikeBanking(ctx: LabelRefineContext): boolean {
  const c = corpus(ctx);
  if (BANKING_POSITIVE.test(c)) return true;
  if (BANKING_FROM.test(c)) return true;
  for (const raw of ctx.fromAddresses || []) {
    if (BANKING_FROM.test(raw.toLowerCase())) return true;
  }
  return false;
}

export function looksLikePmKusum(ctx: LabelRefineContext): boolean {
  return PM_KUSUM_POSITIVE.test(corpus(ctx));
}

/** Attach topic tag; keep action label when present (max 2). */
function withPmKusum(labels: SmartLabel[], ctx: LabelRefineContext): SmartLabel[] {
  if (!looksLikePmKusum(ctx)) {
    return labels.filter((l) => l !== "PM_KUSUM").slice(0, 2);
  }
  const action = labels.find(
    (l) => l === "NEEDS_REPLY" || l === "WAITING_ON_THEM",
  );
  if (action) return [action, "PM_KUSUM"];
  // Prefer topic over bare FYI so the Smart label filter is useful
  if (!labels.length || labels.every((l) => l === "FYI" || l === "PM_KUSUM")) {
    return ["PM_KUSUM"];
  }
  const primary = labels.find((l) => l !== "PM_KUSUM" && l !== "FYI");
  if (primary && (primary === "NEWSLETTER" || primary === "BANKING" || primary === "RECEIPT")) {
    // Still surface KUSUM topic alongside noise categories when clearly about the scheme
    return ["PM_KUSUM", primary];
  }
  if (primary) return [primary, "PM_KUSUM"];
  return ["PM_KUSUM"];
}

function looksLikeReceipt(ctx: LabelRefineContext): boolean {
  if (looksLikeBanking(ctx)) return false;
  const c = corpus(ctx);
  if (RECEIPT_POSITIVE.test(c)) return true;
  if (
    RECEIPT_MONEY.test(c) &&
    /\b(paid|payment|charged|invoice|receipt|order|bill)\b/i.test(c)
  ) {
    return true;
  }
  return false;
}

function looksLikeNewsletter(ctx: LabelRefineContext): boolean {
  if (ctx.hasListUnsubscribe) return true;
  return NEWSLETTER_POSITIVE.test(corpus(ctx));
}

/** Promotional / bulk / automated — never Needs reply. */
export function looksLikePromo(ctx: LabelRefineContext): boolean {
  if (looksLikeBanking(ctx)) return false;
  if (ctx.hasListUnsubscribe) return true;
  if (looksLikeNewsletter(ctx)) return true;
  const c = corpus(ctx);
  if (PROMO_POSITIVE.test(c)) return true;
  for (const raw of ctx.fromAddresses || []) {
    const addr = raw.toLowerCase().trim();
    const local = addr.split("@")[0] || "";
    const domain = addr.split("@")[1] || "";
    if (NOREPLY_FROM.test(local)) return true;
    if (domain && BULK_FROM_DOMAINS.test(domain)) return true;
    if (BULK_FROM_DOMAINS.test(addr)) return true;
  }
  return false;
}

function looksLikeTestOrAck(ctx: LabelRefineContext): boolean {
  const c = corpus(ctx);
  if (TEST_OR_ACK.test(c)) return true;
  if (
    /\btest\b/i.test(ctx.subject) &&
    c.replace(/\s+/g, " ").trim().length < 280
  ) {
    return true;
  }
  return false;
}

function hasStrongNeedsReplyCue(ctx: LabelRefineContext): boolean {
  if (looksLikePromo(ctx) || looksLikeBanking(ctx)) return false;
  return NEEDS_REPLY_CUES.test(corpus(ctx));
}

/**
 * Deterministic guardrails after the model.
 * Prevents nonsense like labeling promos as NEEDS_REPLY or tests as RECEIPT.
 */
export function refineSmartLabels(
  labels: string[],
  ctx: LabelRefineContext,
): SmartLabel[] {
  let next = labels.filter(isSmartLabel);

  const bankingOk = looksLikeBanking(ctx);
  const kusumOk = looksLikePmKusum(ctx);
  const receiptOk = looksLikeReceipt(ctx);
  // Real KUSUM project mail is never "just a newsletter"
  const promoOk = looksLikePromo(ctx) && !kusumOk;
  const testOrAck = looksLikeTestOrAck(ctx);

  // Banking wins over promo/receipt heuristics
  if (bankingOk) {
    return withPmKusum(["BANKING"], ctx);
  }

  // Promotional / bulk mail: never Needs reply or Waiting on them
  if (promoOk && !receiptOk) {
    return ["NEWSLETTER"];
  }
  if (promoOk && receiptOk) {
    return ["RECEIPT"];
  }

  if (next.includes("BANKING") && !bankingOk) {
    next = next.filter((l) => l !== "BANKING");
  }
  if (next.includes("RECEIPT") && !receiptOk) {
    next = next.filter((l) => l !== "RECEIPT");
  }

  // Model said NEWSLETTER without signals → drop (unless already handled as promo)
  if (next.includes("NEWSLETTER") && !promoOk) {
    next = next.filter((l) => l !== "NEWSLETTER");
  }

  // Strip NEEDS_REPLY without a real human ask (promos already handled above)
  if (next.includes("NEEDS_REPLY") && !hasStrongNeedsReplyCue(ctx)) {
    next = next.filter((l) => l !== "NEEDS_REPLY");
    if (!next.length) next = ["FYI"];
  }

  if (testOrAck) {
    next = next.filter(
      (l) => l !== "RECEIPT" && l !== "NEWSLETTER" && l !== "BANKING",
    );
    if (!hasStrongNeedsReplyCue(ctx) && !next.includes("WAITING_ON_THEM")) {
      next = ["FYI"];
    }
  }

  // Mutual exclusions
  if (next.includes("BANKING")) {
    next = ["BANKING"];
  }
  if (next.includes("RECEIPT")) {
    next = next.filter((l) => l === "RECEIPT" || l === "WAITING_ON_THEM");
  }
  if (next.includes("NEWSLETTER")) {
    next = ["NEWSLETTER"];
  }
  if (next.includes("NEEDS_REPLY") && next.includes("FYI")) {
    next = next.filter((l) => l !== "FYI");
  }
  if (next.includes("NEEDS_REPLY") && next.includes("WAITING_ON_THEM")) {
    const first = next.find(
      (l) => l === "NEEDS_REPLY" || l === "WAITING_ON_THEM",
    )!;
    next = next.filter(
      (l) => l === first || (l !== "NEEDS_REPLY" && l !== "WAITING_ON_THEM"),
    );
  }

  if (!next.length) {
    if (bankingOk) return withPmKusum(["BANKING"], ctx);
    if (receiptOk) return withPmKusum(["RECEIPT"], ctx);
    if (promoOk) return ["NEWSLETTER"];
    if (hasStrongNeedsReplyCue(ctx)) return withPmKusum(["NEEDS_REPLY"], ctx);
    if (kusumOk) return ["PM_KUSUM"];
    return ["FYI"];
  }

  return withPmKusum(next.slice(0, 2), ctx);
}

export function smartLabelPromptBlock(): string {
  return SMART_LABELS.map((id) => {
    const m = SMART_LABEL_META[id];
    return `- ${id}: ${m.definition}`;
  }).join("\n");
}

/**
 * Whether a thread belongs in Smart Inbox (readable / actionable mail).
 * Excludes newsletters/receipts/banking and low-value P4 noise.
 */
export function isSmartInboxThread(opts: {
  labelsJson?: string | null;
  priority?: string | null;
}): boolean {
  const labels = parseLabelsJson(opts.labelsJson);
  if (SMART_INBOX_EXCLUDE_LABELS.some((l) => labels.includes(l))) return false;
  // Always keep PM KUSUM work visible in Smart Inbox
  if (labels.includes("PM_KUSUM")) return true;
  if (labels.includes("NEEDS_REPLY") || labels.includes("WAITING_ON_THEM")) {
    return true;
  }
  const pri = (opts.priority || "NONE").toUpperCase();
  // P4 is noise by definition in our triage scale
  if (pri === "P4") return false;
  return pri === "P1" || pri === "P2" || pri === "P3" || pri === "NONE";
}
