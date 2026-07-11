import Anthropic from "@anthropic-ai/sdk";
import { GST_ENTITIES } from "@/lib/gst-entities";
import {
  buildInvoiceContext,
  fallbackGstEntity,
  inferFromRawExtract,
  inferFromTaxPattern,
  parseAiGstResponse,
  readInvoiceAttachment,
  type GstClassificationResult,
} from "@/lib/gst-inference";

const CLASSIFY_PROMPT = `You classify which BluRidge GST registration an Indian tax invoice was raised under.

BluRidge (BLURIDGE CONSULTING PRIVATE LIMITED) has exactly two GST registrations:
- DEL: GSTIN ${GST_ENTITIES.DEL.gstin}, Delhi (state code ${GST_ENTITIES.DEL.stateCode}), ${GST_ENTITIES.DEL.addressLine1}, ${GST_ENTITIES.DEL.city}
- RAJ: GSTIN ${GST_ENTITIES.RAJ.gstin}, Rajasthan (state code ${GST_ENTITIES.RAJ.stateCode}), ${GST_ENTITIES.RAJ.addressLine1}, ${GST_ENTITIES.RAJ.city}

Rules:
- Look at the SELLER / supplier GSTIN and address on the invoice — NOT the buyer.
- If seller GSTIN starts with 07 → DEL. If starts with 08 and matches BluRidge → RAJ.
- CGST+SGST means same-state supply (seller and buyer in same state). IGST means inter-state.
- Seller name may include "-RAJASTHAN" or "-DELHI" suffix.

Return ONLY JSON (no markdown):
{"gstEntity":"DEL"|"RAJ","confidence":0.0-1.0,"reason":"brief explanation"}`;

type InvoiceForClassification = {
  number: string;
  buyerName: string;
  buyerAddress?: string | null;
  buyerGstin?: string | null;
  buyerState?: string | null;
  buyerStateCode?: string | null;
  taxableTotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  grandTotal: number;
  remarks?: string | null;
  rawExtract?: string | null;
  filePath?: string | null;
  sourceFilePath?: string | null;
};

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey });
}

async function classifyWithAiText(invoice: InvoiceForClassification): Promise<GstClassificationResult | null> {
  const client = getClient();
  const context = buildInvoiceContext(invoice);

  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `${CLASSIFY_PROMPT}\n\nInvoice data:\n${context}`,
      },
    ],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
  const parsed = parseAiGstResponse(raw);
  return parsed ? { ...parsed, method: "ai-text" } : null;
}

async function classifyWithAiDocument(
  invoice: InvoiceForClassification,
  filePath: string,
): Promise<GstClassificationResult | null> {
  const file = await readInvoiceAttachment(filePath);
  if (!file) return null;

  const client = getClient();
  type ContentBlock = Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam | Anthropic.TextBlockParam;

  const contentParts: ContentBlock[] =
    file.mediaType === "application/pdf"
      ? [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: file.base64 },
          },
          { type: "text", text: `${CLASSIFY_PROMPT}\n\nInvoice number: ${invoice.number}` },
        ]
      : [
          {
            type: "image",
            source: { type: "base64", media_type: file.mediaType, data: file.base64 },
          },
          { type: "text", text: `${CLASSIFY_PROMPT}\n\nInvoice number: ${invoice.number}` },
        ];

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content: contentParts }],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
  const parsed = parseAiGstResponse(raw);
  return parsed ? { ...parsed, method: "ai-document" } : null;
}

/** Classify a single invoice — deterministic extract first, then AI on document/text */
export async function classifyInvoiceGstEntity(
  invoice: InvoiceForClassification,
): Promise<GstClassificationResult> {
  if (invoice.rawExtract) {
    const fromExtract = inferFromRawExtract(invoice.rawExtract);
    if (fromExtract && fromExtract.confidence >= 0.9) return fromExtract;
  }

  const docPath = invoice.filePath || invoice.sourceFilePath;
  if (docPath) {
    try {
      const fromDoc = await classifyWithAiDocument(invoice, docPath);
      if (fromDoc) return fromDoc;
    } catch (err) {
      console.error(`[classify-gst] document AI failed for ${invoice.number}:`, err);
    }
  }

  if (invoice.rawExtract) {
    const fromExtract = inferFromRawExtract(invoice.rawExtract);
    if (fromExtract) {
      try {
        const fromAi = await classifyWithAiText(invoice);
        if (fromAi && fromAi.confidence >= fromExtract.confidence) return fromAi;
      } catch (err) {
        console.error(`[classify-gst] text AI failed for ${invoice.number}:`, err);
      }
      return fromExtract;
    }
  }

  try {
    const fromAi = await classifyWithAiText(invoice);
    if (fromAi) return fromAi;
  } catch (err) {
    console.error(`[classify-gst] text AI failed for ${invoice.number}:`, err);
  }

  const fromTax = inferFromTaxPattern(invoice);
  if (fromTax) return fromTax;

  return fallbackGstEntity();
}
