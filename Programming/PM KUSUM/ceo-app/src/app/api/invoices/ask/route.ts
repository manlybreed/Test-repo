import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildGstr1Export } from "@/lib/invoice/gstr1";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { question?: string };
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
    take: 40,
    include: { originalInvoice: true, lines: true },
  });

  const summary = invoices.map((i) => ({
    number: i.number,
    type: i.documentType,
    status: i.status,
    buyer: i.buyerName,
    gstEntity: i.gstEntity,
    taxable: i.taxableTotal,
    grand: i.grandTotal,
    igst: i.igstAmount,
    cgst: i.cgstAmount,
    sgst: i.sgstAmount,
    pos: i.placeOfSupplyStateCode,
    original: i.originalInvoice?.number,
  }));

  const anomalies = buildGstr1Export(invoices).anomalies;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      answer: `No ANTHROPIC_API_KEY. Recent docs: ${summary
        .slice(0, 5)
        .map((s) => s.number)
        .join(", ")}. Anomalies: ${anomalies.join("; ") || "none"}.`,
    });
  }

  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: `You are BluRidge GST invoice assistant. Tax math is deterministic (engine); you explain compliance and data.
Rules: issued tax invoices are immutable; refunds need credit notes; proforma ≠ tax invoice; DEL/RAJ dual GSTIN; SAC 998313.
Anomalies: ${JSON.stringify(anomalies)}
Recent documents: ${JSON.stringify(summary)}
Question: ${question}`,
      },
    ],
  });

  const answer = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n");

  return NextResponse.json({ answer });
}
