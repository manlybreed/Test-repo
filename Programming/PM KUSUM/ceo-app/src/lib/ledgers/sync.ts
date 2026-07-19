import { postOutwardFromInvoice } from "@/lib/ledgers/outward";
import { postAdvanceFromInvoice } from "@/lib/ledgers/advance";
import type { Invoice } from "@prisma/client";

/** Call after invoice issue / cancel / CN / DN / RV / RFV */
export async function syncLedgersForInvoice(
  invoice: Invoice,
  actorUserId?: string | null,
) {
  await postOutwardFromInvoice(invoice, { actorUserId });
  await postAdvanceFromInvoice(invoice, { actorUserId });
}
