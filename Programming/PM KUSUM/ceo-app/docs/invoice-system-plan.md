# Invoice System — GST-First + AI-Enabled Build Plan

> Not legal/tax advice. Verify thresholds, NIC schema, and returns mapping with a GST practitioner before go-live.

## Principles

1. **GST compliance wins** over legacy convenience (numbering, delete/edit, refunds).
2. **Tax math is deterministic** — AI proposes; the engine numbers, taxes, and issues.
3. **AI everywhere** around that engine (draft, import, validate, match, refund advisor, returns, Ask AI).

## Scope (Choice A — default)

Domestic B2B/B2C consulting for BluRidge DEL/RAJ: proforma, Rule 46 tax invoices, immutability, CN/DN + refunds, GSTR-1, AI layer. E-invoice scaffolded behind AATO flag (off).

Deferred: e-way, composition BoS, full export/FEMA/LUT, maker-checker, bilingual PDF.

## Document types & series

| Type | Series code | Notes |
|------|-------------|--------|
| Proforma | `PF` | Not a tax invoice; convert creates new tax invoice |
| Tax invoice | `INV` | FY-scoped; immutable when ISSUED |
| Credit note | `CN` | Linked to original tax invoice |
| Debit note | `DN` | Linked to original tax invoice |
| Receipt voucher | `RV` | Advances |
| Refund voucher | `RFV` | Advance returned without supply |

Number format: `{SERIES}/{FYshort}/{seq}` e.g. `INV/2526/0009` (≤16 chars).

## Refunds

- After tax invoice → **Credit note** + payment refund metadata (never delete/un-issue).
- After advance only → Receipt voucher → **Refund voucher**.

## AI capabilities

Smart draft, import→compliant draft, pre-issue validator, client/agreement match, refund advisor, GST entity classify, GSTR anomaly review, Invoice Ask AI, CEO tools (proforma / issue / refund / validate).

## Phases

- **A** Gap matrix + break list + company config  
- **B** Compliant Prisma model + migrate  
- **C** Deterministic engine + tests  
- **D** AI core  
- **E** Proforma + Rule 46 PDF + immutability  
- **F** CN/DN + refund wizard  
- **G** GSTR-1 + AI reconcile  
- **H** E-invoice scaffold (flagged)  
- **I** Backlog (export/LUT, e-way, …)  
- **J** Ledgers schema + retention + expense harden  
- **K** Outward/inward/ITC/advance posting engines + backfill  
- **L** GSTR-2B/1 portal seed + Ledgers UI  
- **M** On-demand CSV register export + 72-month guards  
- **N** Docs / gap matrix for ledgers  

### Ledgers (Phases J–N)

Software maintains Rule 56 registers: **Outward**, **Inward**, **ITC**, **Advance**, and **Stock** (N/A scaffold for services — `maintainsStockLedger=false`). Books are append-only; corrections strike + compensate; never hard-delete ledger rows. Sec 36 retention: entries store `retentionUntil` (FY annual-return due + 72 months heuristic — confirm with practitioner). On-demand CSV export per register. Seed from GSTR-2B / GSTR-1 JSON uploads.

See also: [gap-matrix-and-breaks.md](./gap-matrix-and-breaks.md).
