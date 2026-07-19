import Anthropic from "@anthropic-ai/sdk";
import type { InvoiceDocumentType, InvoiceLineCalcInput } from "@/lib/invoice/types";

export type AiInvoiceDraft = {
  documentType: InvoiceDocumentType;
  buyerName: string;
  buyerAddress?: string;
  buyerGstin?: string;
  buyerState?: string;
  buyerStateCode?: string;
  gstEntity?: "DEL" | "RAJ";
  remarks?: string;
  lines: InvoiceLineCalcInput[];
  rationale?: string;
};

const FALLBACK: AiInvoiceDraft = {
  documentType: "TAX_INVOICE",
  buyerName: "",
  gstEntity: "DEL",
  lines: [{ description: "Consultancy Service", hsn: "998313", quantity: 1, rate: 0 }],
};

/** Natural-language → draft invoice fields (user must confirm; engine issues). */
export async function draftInvoiceFromText(
  prompt: string,
): Promise<AiInvoiceDraft> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...FALLBACK, rationale: "No API key — fill manually." };
  }

  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    messages: [
      {
        role: "user",
        content: `Extract a BluRidge consulting invoice draft from the CEO request.
Return ONLY JSON with keys:
documentType (PROFORMA|TAX_INVOICE), buyerName, buyerAddress, buyerGstin, buyerState, buyerStateCode (2-digit), gstEntity (DEL|RAJ), remarks, lines[{description,hsn,quantity,rate}], rationale.
Default HSN 998313. DEL = Delhi GST, RAJ = Rajasthan GST.
Request:
${prompt}`,
      },
    ],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n");

  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { ...FALLBACK, rationale: text.slice(0, 200) };
  try {
    const parsed = JSON.parse(m[0]) as AiInvoiceDraft;
    if (!parsed.buyerName) parsed.buyerName = "";
    if (!parsed.lines?.length) parsed.lines = FALLBACK.lines;
    if (parsed.documentType !== "PROFORMA") parsed.documentType = "TAX_INVOICE";
    return parsed;
  } catch {
    return { ...FALLBACK, rationale: "Failed to parse AI draft." };
  }
}
