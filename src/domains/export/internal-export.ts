// Pure decision core — no framework, DB, or network imports.
//
// Builds the Internal Export workbook (issue #15, CONTEXT.md: Internal Export):
// every non-Draft Quote in a study across all countries, WITH the item's Client
// Price, the QC Flag direction (reusing the Price Flag core), the Justification,
// and the rejection reason — the analyst's full view. Drafts never reach here
// (ADR-0011) and the Analyst+EM gate plus the read live in the adapter
// (src/lib/export); this is the shape. Client-facing reads never produce it.

import type { Cell, Column, WorkbookData } from "./workbook";
import { evaluatePriceFlag } from "@/domains/quotes/price-flag";

/** One non-Draft Quote as the internal sheet reads it, with the item context the
 *  analyst needs: Client Price (for the QC flag) and the quote's review fields. */
export interface InternalExportQuote {
  readonly country: string;
  readonly clientItemNumber: string;
  readonly itemDescription: string;
  readonly clientPrice: number | null;
  readonly state: string;
  readonly quoteNumber: number;
  readonly competitorBrand: string | null;
  readonly dealerName: string | null;
  readonly dealerLocation: string | null;
  readonly price: number | null;
  readonly currency: string | null;
  readonly quantityQuoted: number | null;
  readonly convertedUsdPrice: number | null;
  readonly usdPricePerUnit: number | null;
  readonly stockStatus: string | null;
  readonly leadTime: string | null;
  readonly warranty: string | null;
  readonly discount: string | null;
  readonly notes: string | null;
  readonly justification: string | null;
  readonly rejectionReason: string | null;
}

const QUOTE_COLUMNS: readonly Column[] = [
  { header: "Country", key: "country" },
  { header: "Client Item Number", key: "clientItemNumber" },
  { header: "Item Description", key: "itemDescription" },
  { header: "State", key: "state" },
  { header: "Quote #", key: "quoteNumber" },
  { header: "Competitor", key: "competitorBrand" },
  { header: "Dealer", key: "dealerName" },
  { header: "Dealer Location", key: "dealerLocation" },
  { header: "Price", key: "price" },
  { header: "Currency", key: "currency" },
  { header: "Quantity Quoted", key: "quantityQuoted" },
  { header: "Converted USD Price", key: "convertedUsdPrice" },
  { header: "USD Price / Unit", key: "usdPricePerUnit" },
  { header: "Client Price", key: "clientPrice" },
  { header: "QC Flag", key: "qcFlag" },
  { header: "Stock Status", key: "stockStatus" },
  { header: "Lead Time", key: "leadTime" },
  { header: "Warranty", key: "warranty" },
  { header: "Discount", key: "discount" },
  { header: "Justification", key: "justification" },
  { header: "Rejection Reason", key: "rejectionReason" },
  { header: "Notes", key: "notes" },
];

/**
 * Build the Internal Export workbook. `threshold` is the QC Threshold as a
 * FRACTION, applied to each quote's QC Flag exactly as the per-quote flag does.
 */
export function buildInternalExport(
  quotes: readonly InternalExportQuote[],
  threshold: number,
): WorkbookData {
  const rows: Record<string, Cell>[] = quotes.map((q) => ({
    country: q.country,
    clientItemNumber: q.clientItemNumber,
    itemDescription: q.itemDescription,
    state: q.state,
    quoteNumber: q.quoteNumber,
    competitorBrand: q.competitorBrand,
    dealerName: q.dealerName,
    dealerLocation: q.dealerLocation,
    price: q.price,
    currency: q.currency,
    quantityQuoted: q.quantityQuoted,
    convertedUsdPrice: q.convertedUsdPrice,
    usdPricePerUnit: q.usdPricePerUnit,
    clientPrice: q.clientPrice,
    qcFlag: qcFlag(q, threshold),
    stockStatus: q.stockStatus,
    leadTime: q.leadTime,
    warranty: q.warranty,
    discount: q.discount,
    justification: q.justification,
    rejectionReason: q.rejectionReason,
    notes: q.notes,
  }));
  return { sheets: [{ name: "Quotes", columns: QUOTE_COLUMNS, rows }] };
}

/** The QC Flag cell: "n/a" when the quote is not comparable (unconverted or no
 *  Client Price), otherwise the direction, marked "(flagged)" when out of range. */
function qcFlag(q: InternalExportQuote, threshold: number): string {
  const result = evaluatePriceFlag({
    usdPricePerUnit: q.usdPricePerUnit,
    clientPrice: q.clientPrice,
    threshold,
  });
  if (!result.comparable) return "n/a";
  return result.flagged ? `${result.direction} (flagged)` : result.direction;
}
