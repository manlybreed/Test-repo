import fs from "fs/promises";
import path from "path";
import {
  GST_ENTITIES,
  gstEntityFromSellerGstin,
  type GstEntity,
  isGstEntity,
  normalizeGstEntity,
} from "@/lib/gst-entities";
import { resolveStoragePath } from "@/lib/storage";

export type GstClassificationResult = {
  gstEntity: GstEntity;
  confidence: number;
  method: "sellerGstin" | "rawExtract" | "ai-text" | "ai-document" | "tax-heuristic" | "default";
  reason: string;
};

export { gstEntityFromSellerGstin };

export function inferFromRawExtract(rawExtract: string): GstClassificationResult | null {
  try {
    const data = JSON.parse(rawExtract) as Record<string, unknown>;
    const fromGstin = gstEntityFromSellerGstin(String(data.sellerGstin ?? ""));
    if (fromGstin) {
      return {
        gstEntity: fromGstin,
        confidence: 0.99,
        method: "sellerGstin",
        reason: `Seller GSTIN ${data.sellerGstin} matches BluRidge ${fromGstin} registration`,
      };
    }

    const sellerName = String(data.sellerName ?? "").toLowerCase();
    if (sellerName.includes("rajasthan") || sellerName.includes("-raj")) {
      return {
        gstEntity: "RAJ",
        confidence: 0.92,
        method: "rawExtract",
        reason: `Seller name indicates Rajasthan: ${data.sellerName}`,
      };
    }
    if (sellerName.includes("delhi") || sellerName.includes("-del")) {
      return {
        gstEntity: "DEL",
        confidence: 0.92,
        method: "rawExtract",
        reason: `Seller name indicates Delhi: ${data.sellerName}`,
      };
    }

    if (data.gstEntity && isGstEntity(String(data.gstEntity))) {
      return {
        gstEntity: String(data.gstEntity) as GstEntity,
        confidence: 0.9,
        method: "rawExtract",
        reason: "gstEntity field present in stored extract",
      };
    }
  } catch {
    /* ignore malformed JSON */
  }
  return null;
}

/** CGST+SGST with buyer in Rajasthan → likely RAJ; Delhi buyer + CGST → likely DEL */
export function inferFromTaxPattern(input: {
  buyerStateCode?: string | null;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
}): GstClassificationResult | null {
  const code = input.buyerStateCode?.trim();
  const hasCgstSgst = input.cgstAmount > 0 && input.sgstAmount > 0;
  const hasIgst = input.igstAmount > 0;

  if (hasCgstSgst && code === GST_ENTITIES.RAJ.stateCode) {
    return {
      gstEntity: "RAJ",
      confidence: 0.75,
      method: "tax-heuristic",
      reason: "CGST+SGST with Rajasthan buyer suggests invoice raised under RAJ GST",
    };
  }
  if (hasCgstSgst && code === GST_ENTITIES.DEL.stateCode) {
    return {
      gstEntity: "DEL",
      confidence: 0.75,
      method: "tax-heuristic",
      reason: "CGST+SGST with Delhi buyer suggests invoice raised under DEL GST",
    };
  }
  if (hasIgst && code === GST_ENTITIES.RAJ.stateCode) {
    return {
      gstEntity: "DEL",
      confidence: 0.6,
      method: "tax-heuristic",
      reason: "IGST to Rajasthan buyer suggests invoice raised under DEL GST (inter-state)",
    };
  }
  if (hasIgst && code === GST_ENTITIES.DEL.stateCode) {
    return {
      gstEntity: "RAJ",
      confidence: 0.6,
      method: "tax-heuristic",
      reason: "IGST to Delhi buyer suggests invoice raised under RAJ GST (inter-state)",
    };
  }
  return null;
}

export async function readInvoiceAttachment(
  relativePath: string,
): Promise<{ base64: string; mediaType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" } | null> {
  try {
    const full = relativePath.startsWith("uploads/")
      ? path.join(process.cwd(), "public", relativePath)
      : resolveStoragePath(relativePath);

    const bytes = await fs.readFile(full);
    const ext = path.extname(full).toLowerCase();
    const mediaType =
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : "image/jpeg";

    return { base64: bytes.toString("base64"), mediaType };
  } catch {
    return null;
  }
}

export function buildInvoiceContext(input: {
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
}): string {
  let extractSummary: Record<string, unknown> | null = null;
  if (input.rawExtract) {
    try {
      const parsed = JSON.parse(input.rawExtract) as Record<string, unknown>;
      extractSummary = {
        sellerName: parsed.sellerName,
        sellerGstin: parsed.sellerGstin,
        buyerName: parsed.buyerName,
        buyerState: parsed.buyerState,
        buyerStateCode: parsed.buyerStateCode,
        cgstAmount: parsed.cgstAmount,
        sgstAmount: parsed.sgstAmount,
        igstAmount: parsed.igstAmount,
        remarks: parsed.remarks,
      };
    } catch {
      extractSummary = { raw: input.rawExtract.slice(0, 2000) };
    }
  }

  return JSON.stringify(
    {
      invoiceNumber: input.number,
      buyerName: input.buyerName,
      buyerAddress: input.buyerAddress,
      buyerGstin: input.buyerGstin,
      buyerState: input.buyerState,
      buyerStateCode: input.buyerStateCode,
      taxableTotal: input.taxableTotal,
      cgstAmount: input.cgstAmount,
      sgstAmount: input.sgstAmount,
      igstAmount: input.igstAmount,
      grandTotal: input.grandTotal,
      remarks: input.remarks,
      priorExtract: extractSummary,
    },
    null,
    2,
  );
}

export function parseAiGstResponse(raw: string): GstClassificationResult | null {
  try {
    const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const data = JSON.parse(json) as { gstEntity?: string; confidence?: number; reason?: string };
    if (!isGstEntity(data.gstEntity)) return null;
    return {
      gstEntity: data.gstEntity,
      confidence: typeof data.confidence === "number" ? data.confidence : 0.8,
      method: "ai-text",
      reason: data.reason || "AI classification",
    };
  } catch {
    return null;
  }
}

export function fallbackGstEntity(): GstClassificationResult {
  return {
    gstEntity: normalizeGstEntity(null),
    confidence: 0.3,
    method: "default",
    reason: "Could not determine GST entity — defaulted to DEL",
  };
}
