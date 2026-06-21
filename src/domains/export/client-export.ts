// Pure decision core — no framework, DB, or network imports.
//
// Builds the Client Export workbook (issue #15, CONTEXT.md: Client Export): the
// released + approved data a Client User downloads of their own tenant. Two
// sheets — a per-quote detail "Quotes" sheet and a per-item "Summary" sheet
// (min/median/max), the latter reusing the dashboard fold. The Client Price is
// NEVER a column here (ADR-0003). The tenant gate, the released/approved read,
// and exceljs rendering live in the adapter (src/lib/export); this is the shape.

import type { Cell, Column, SheetData, WorkbookData } from "./workbook";
import { buildItemDashboards } from "@/domains/analytics/dashboard";

/** One released + approved Quote as the client detail sheet reads it. All the
 *  competitive fields, but never the item's Client Price. */
export interface ClientExportQuote {
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
}

/** A released Benchmark Item with its approved quotes (possibly none). */
export interface ClientExportItem {
  readonly country: string;
  readonly clientItemNumber: string;
  readonly itemDescription: string;
  readonly quotes: readonly ClientExportQuote[];
}

const QUOTE_COLUMNS: readonly Column[] = [
  { header: "Country", key: "country" },
  { header: "Client Item Number", key: "clientItemNumber" },
  { header: "Item Description", key: "itemDescription" },
  { header: "Quote #", key: "quoteNumber" },
  { header: "Competitor", key: "competitorBrand" },
  { header: "Dealer", key: "dealerName" },
  { header: "Dealer Location", key: "dealerLocation" },
  { header: "Price", key: "price" },
  { header: "Currency", key: "currency" },
  { header: "Quantity Quoted", key: "quantityQuoted" },
  { header: "Converted USD Price", key: "convertedUsdPrice" },
  { header: "USD Price / Unit", key: "usdPricePerUnit" },
  { header: "Stock Status", key: "stockStatus" },
  { header: "Lead Time", key: "leadTime" },
  { header: "Warranty", key: "warranty" },
  { header: "Discount", key: "discount" },
  { header: "Notes", key: "notes" },
];

const SUMMARY_COLUMNS: readonly Column[] = [
  { header: "Country", key: "country" },
  { header: "Client Item Number", key: "clientItemNumber" },
  { header: "Item Description", key: "itemDescription" },
  { header: "Min USD / Unit", key: "min" },
  { header: "Median USD / Unit", key: "median" },
  { header: "Max USD / Unit", key: "max" },
  { header: "Approved Quotes", key: "quoteCount" },
];

/** Build the Client Export workbook for a study's released + approved items. */
export function buildClientExport(items: readonly ClientExportItem[]): WorkbookData {
  return { sheets: [quotesSheet(items), summarySheet(items)] };
}

function quotesSheet(items: readonly ClientExportItem[]): SheetData {
  const rows: Record<string, Cell>[] = [];
  for (const item of items) {
    for (const q of item.quotes) {
      rows.push({
        country: item.country,
        clientItemNumber: item.clientItemNumber,
        itemDescription: item.itemDescription,
        quoteNumber: q.quoteNumber,
        competitorBrand: q.competitorBrand,
        dealerName: q.dealerName,
        dealerLocation: q.dealerLocation,
        price: q.price,
        currency: q.currency,
        quantityQuoted: q.quantityQuoted,
        convertedUsdPrice: q.convertedUsdPrice,
        usdPricePerUnit: q.usdPricePerUnit,
        stockStatus: q.stockStatus,
        leadTime: q.leadTime,
        warranty: q.warranty,
        discount: q.discount,
        notes: q.notes,
      });
    }
  }
  return { name: "Quotes", columns: QUOTE_COLUMNS, rows };
}

/** The per-item min/median/max summary. Reuses the dashboard fold so the export's
 *  range agrees with the on-screen Competitor Price Range; a no-data item yields
 *  blank figures (never zeros), staying visible because it was released. */
function summarySheet(items: readonly ClientExportItem[]): SheetData {
  const dashboards = buildItemDashboards(
    items.map((item) => ({
      country: item.country,
      clientItemNumber: item.clientItemNumber,
      itemDescription: item.itemDescription,
      quotes: item.quotes.map((q) => ({
        competitorBrand: q.competitorBrand,
        usdPricePerUnit: q.usdPricePerUnit,
      })),
    })),
  );
  const rows: Record<string, Cell>[] = dashboards.map((d) => ({
    country: d.country,
    clientItemNumber: d.clientItemNumber,
    itemDescription: d.itemDescription,
    min: d.range.hasData ? d.range.min : null,
    median: d.range.hasData ? d.range.median : null,
    max: d.range.hasData ? d.range.max : null,
    quoteCount: d.range.hasData ? d.range.count : 0,
  }));
  return { name: "Summary", columns: SUMMARY_COLUMNS, rows };
}
