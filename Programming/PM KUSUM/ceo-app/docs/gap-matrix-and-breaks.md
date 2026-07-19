# Rule 46 gap matrix & breaking changes

## Breaking changes vs previous Invoice model

| Previous | Compliant target |
|----------|------------------|
| Global `INV-09` via single `InvoiceSequence` | Per-FY / per-series counters |
| Hard-delete any invoice | DRAFT-only delete; ISSUED retained |
| Content mutable after create | ISSUED content locked; payment/TDS only |
| Loose buyer GSTIN / no POS field | Rule 46 validation before issue |
| Header-only tax; no stored POS | Store `placeOfSupply*`, RCM, round-off |
| `clientId` unused in form | Match Client when possible; optional Agreement |
| “Unpaid” / delete as refund | Refund via Credit Note (or RFV for advances) |
| Import keeps external PDF only | Prefer validated draft → BluRidge PDF on issue |

## Rule 46 / field gap matrix

| Particular | DB | PDF | UI | Status |
|------------|----|-----|-----|--------|
| Supplier name & address | GST entity profiles | Yes | Entity select | Pass |
| Supplier GSTIN | Entity | Yes | Entity select | Pass |
| Invoice number (unique, FY series) | `number` + sequence | Yes | Preview | **Fixed** (was non-FY) |
| Invoice date | `invoiceDate` | Yes | Form | Pass |
| Document type | `documentType` | Title | Form | **Fixed** |
| Buyer name & address | Yes | Yes | Form | Pass |
| Buyer GSTIN (B2B) | Yes | Yes | Form + validate | Harden |
| Place of supply | `placeOfSupply*` | Yes | Derived/edit | **Fixed** |
| HSN/SAC | Line `hsn` | Yes | Form | Pass |
| Description of goods/services | Lines | Yes | Form | Pass |
| Taxable value | Yes | Yes | Calc | Pass |
| Rate of tax | Line `taxRate` + heads | Yes | Engine | Harden |
| CGST/SGST/IGST breakup | Yes | Yes | Engine | Pass |
| Reverse charge | `reverseCharge` | Flag | Form | **Fixed** |
| Round-off | `roundOff` | Yes | Engine | **Fixed** |
| Signature / authorised signatory | — | Block | — | Pass (soft) |
| Proforma labelling | `PROFORMA` | Distinct title | Form | **Fixed** |
| Credit/Debit note link | `originalInvoiceId` | Ref | Wizard | **Fixed** |
| IRN / signed QR | `irn*` fields | When flag on | Scaffold | Phase H |
| GSTR-1 export | Export action | — | Export UI | **Fixed** |

## Company config (Phase A)

- `aatoBand`: `UNDER_5CR` \| `OVER_5CR` (drives e-invoice readiness)
- `eInvoiceEnabled`: boolean (feature flag)
- `hsnDefault`: already on `CompanyProfile` (`998313`)
- `maintainsStockLedger`: default `false` (services)
- `retentionMonths`: default `72`

## Ledgers / Rule 56 (Phases J–N)

| Register | Status |
|----------|--------|
| Outward supply | **Fixed** — `OutwardSupplyEntry` posted from ISSUED tax/CN/DN |
| Inward supply | **Fixed** — from expenses + GSTR-2B seed; vendor GSTIN fields on Expense |
| ITC ledger | **Fixed** — provisional from inward; category blocks |
| Advance ledger | **Fixed** — RV/RFV posting + balance |
| Stock ledger | Scaffold / N/A banner when `maintainsStockLedger=false` |
| Audit trail 56(8) | **Fixed** — `AuditLog` append-only |
| Hard-delete ledgers | Forbidden — strike only |
| Expense hard-delete | Replaced with strike + inward/ITC strike |
| 72-month retention | `retentionUntil` on entries (heuristic) |
| On-demand export | CSV per register via Ledgers UI |
| Portal seed | GSTR-2B / GSTR-1 JSON + inward CSV |
