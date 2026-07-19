import Anthropic from "@anthropic-ai/sdk";
import {
  hasBlockingErrors,
  validateInvoiceDraft,
  type DraftValidationInput,
  type ValidationIssue,
} from "@/lib/invoice/validate";

/**
 * Rules-first validation; optional Claude pass for soft compliance language issues.
 */
export async function validateInvoiceDraftSmart(
  input: DraftValidationInput,
  opts?: { useAi?: boolean },
): Promise<{
  issues: ValidationIssue[];
  canIssue: boolean;
  aiNotes?: string;
}> {
  const issues = validateInvoiceDraft(input);
  let aiNotes: string | undefined;

  if (opts?.useAi && process.env.ANTHROPIC_API_KEY && !hasBlockingErrors(issues)) {
    try {
      const client = new Anthropic();
      const res = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: `You are a GST compliance assistant for Indian consulting invoices (SAC 998313).
Review this draft and list brief warnings only (not tax calculations). If nothing notable, say OK.
Draft JSON:
${JSON.stringify(input, null, 2)}`,
          },
        ],
      });
      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("\n")
        .trim();
      if (text && text.toUpperCase() !== "OK") {
        aiNotes = text;
        issues.push({
          level: "warning",
          code: "AI_REVIEW",
          message: text.slice(0, 500),
        });
      }
    } catch {
      // non-fatal
    }
  }

  return {
    issues,
    canIssue: !hasBlockingErrors(issues),
    aiNotes,
  };
}
