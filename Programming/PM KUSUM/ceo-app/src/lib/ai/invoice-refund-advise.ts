import Anthropic from "@anthropic-ai/sdk";

export type RefundAdvice = {
  path: "CREDIT_NOTE" | "REFUND_VOUCHER" | "NONE";
  fullOrPartial: "FULL" | "PARTIAL";
  reasonText: string;
  notes: string;
};

/**
 * Recommend GST document path for a refund. Never suggests deleting a tax invoice.
 */
export async function adviseRefundPath(input: {
  hasIssuedTaxInvoice: boolean;
  hasReceiptVoucherOnly: boolean;
  reason?: string;
  invoiceNumber?: string;
  grandTotal?: number;
  requestedAmount?: number;
}): Promise<RefundAdvice> {
  if (input.hasIssuedTaxInvoice) {
    const partial =
      input.requestedAmount != null &&
      input.grandTotal != null &&
      input.requestedAmount < input.grandTotal - 0.01;
    const base: RefundAdvice = {
      path: "CREDIT_NOTE",
      fullOrPartial: partial ? "PARTIAL" : "FULL",
      reasonText:
        input.reason?.trim() ||
        "Supply cancelled / amount excess — credit note under Section 34",
      notes:
        "Issue a Credit Note linked to the tax invoice, then record the bank refund against the CN. Do not delete the original invoice.",
    };

    if (!process.env.ANTHROPIC_API_KEY) return base;

    try {
      const client = new Anthropic();
      const res = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: `Suggest a short GST credit-note reason (1 sentence) for invoice ${input.invoiceNumber}, amount ${input.requestedAmount ?? input.grandTotal}. User reason: ${input.reason || "n/a"}. Return plain text only.`,
          },
        ],
      });
      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b.type === "text" ? b.text : ""))
        .join(" ")
        .trim();
      if (text) base.reasonText = text.slice(0, 280);
    } catch {
      // keep base
    }
    return base;
  }

  if (input.hasReceiptVoucherOnly) {
    return {
      path: "REFUND_VOUCHER",
      fullOrPartial: "FULL",
      reasonText: input.reason?.trim() || "Advance returned — no supply",
      notes:
        "Issue a Refund Voucher linked to the Receipt Voucher. Do not invent a tax invoice credit note.",
    };
  }

  return {
    path: "NONE",
    fullOrPartial: "FULL",
    reasonText: "",
    notes: "No issued tax invoice or receipt voucher found — cannot advise a GST refund document.",
  };
}
