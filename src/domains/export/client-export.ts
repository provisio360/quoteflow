// Pure decision core — no framework, DB, or network imports.
//
// Builds the Client Export workbook (issue #93, CONTEXT.md: Client Export,
// ADR-0029): the released + approved data a Client User downloads of their own
// tenant. One detail sheet named after the study (Market as a column), matching
// the client_final_report artifact column-for-column, plus a global Summary sheet
// (per-item min/median/max) that reuses the dashboard fold so the export agrees
// with the on-screen Competitor Price Range. The Client Price, the Quoted Price
// Difference, and the Paper Quote flag are NEVER columns here (ADR-0003/0029). The
// tenant gate, the released/approved read, and exceljs rendering live in the adapter.

import type { Cell, Column, SheetData, WorkbookData } from "./workbook";
import { yesNo, naWhenOff, composeSourceLocation } from "./cells";
import { buildItemDashboards } from "@/domains/analytics/dashboard";

/** One released + approved Quote Line as the client detail reads it: the line and
 *  its parent document's facts, never the item's Client Price. `convertedPricePerUnit`
 *  doubles as the USD/unit the Summary folds into min/median/max. */
export interface ClientExportLine {
  readonly rowId: number;
  readonly marketQuoteNumber: number;
  readonly sourceName: string | null;
  readonly sourceLocality: string | null;
  readonly sourceCountry: string | null;
  readonly sourceUrl: string | null;
  readonly competitorBrand: string | null;
  readonly competitorItemDescription: string | null;
  readonly competitorItemQuantity: number | null;
  readonly competitorItemNumber: string | null;
  readonly dateQuoteReceived: string | null;
  readonly currencyTypeQuoted: string | null;
  readonly quotedPrice: number | null;
  readonly currencyExchangeRate: number | null;
  readonly convertedPrice: number | null;
  readonly convertedPricePerUnit: number | null;
  readonly stockStatus: string | null;
  readonly shippingLeadTimeValue: number | null;
  readonly shippingLeadTimeUnit: string | null;
  readonly landedCostIncluded: boolean | null;
  readonly landedCostNote: string | null;
  readonly warranty1Value: number | null;
  readonly warranty1Unit: string | null;
  readonly warranty2Value: number | null;
  readonly warranty2Unit: string | null;
  readonly discountAvailable: boolean | null;
  readonly discountApplied: boolean | null;
  readonly discountValue: number | null;
  readonly discountType: string | null;
  readonly otherNotes1: string | null;
  readonly otherNotes2: string | null;
  readonly confidenceCode: string | null;
}

/** A released Benchmark Item with its approved lines (possibly none — a released
 *  item with no usable data still appears, as a no-data Summary row). The item-
 *  level fields are shared by all its detail rows. */
export interface ClientExportItem {
  readonly market: string;
  readonly clientCategory: string | null;
  readonly clientSourceUnit: string | null;
  readonly clientSourceUnitIdentifier: string | null;
  readonly clientItemOffering: string | null;
  readonly clientItemDescription: string;
  readonly clientItemSecondaryDescription: string | null;
  readonly clientItemQuantity: number | null;
  readonly clientItemNumber: string;
  readonly clientSecondaryItemNumber: string | null;
  readonly clientItemConfigurationComment: string | null;
  readonly quotes: readonly ClientExportLine[];
}

const DETAIL_COLUMNS: readonly Column[] = [
  { header: "Row Id", key: "rowId" },
  { header: "Market", key: "market" },
  { header: "Market Quote Number", key: "marketQuoteNumber" },
  { header: "Client Category", key: "clientCategory" },
  { header: "Client Source Unit", key: "clientSourceUnit" },
  { header: "Client Source Unit Identifier", key: "clientSourceUnitIdentifier" },
  { header: "Client Item Offering", key: "clientItemOffering" },
  { header: "Client Item Description", key: "clientItemDescription" },
  { header: "Client Item Secondary Description", key: "clientItemSecondaryDescription" },
  { header: "Client Item Quantity", key: "clientItemQuantity" },
  { header: "Client Item Number", key: "clientItemNumber" },
  { header: "Client Secondary Item Number", key: "clientSecondaryItemNumber" },
  { header: "Client Item Configuration Comment", key: "clientItemConfigurationComment" },
  { header: "Source Name", key: "sourceName" },
  { header: "Source Location", key: "sourceLocation" },
  { header: "Source URL", key: "sourceUrl" },
  { header: "Competitor Brand", key: "competitorBrand" },
  { header: "Competitor Category", key: "competitorCategory" },
  { header: "Competitor Source Unit", key: "competitorSourceUnit" },
  { header: "Competitor Source Unit Identifier", key: "competitorSourceUnitIdentifier" },
  { header: "Competitor Item Offering", key: "competitorItemOffering" },
  { header: "Competitor Item Description", key: "competitorItemDescription" },
  { header: "Competitor Item Secondary Description", key: "competitorItemSecondaryDescription" },
  { header: "Competitor Item Quantity", key: "competitorItemQuantity" },
  { header: "Competitor Item Number", key: "competitorItemNumber" },
  { header: "Date Quote Received", key: "dateQuoteReceived" },
  { header: "Currency Type Quoted", key: "currencyTypeQuoted" },
  { header: "Quoted Price", key: "quotedPrice" },
  { header: "Converted Currency", key: "convertedCurrency" },
  { header: "Currency Exchange Rate", key: "currencyExchangeRate" },
  { header: "Converted Price", key: "convertedPrice" },
  { header: "Converted Price Per Unit", key: "convertedPricePerUnit" },
  { header: "Item is In-stock or Out-of-stock", key: "stockStatus" },
  { header: "Shipping Lead Time Value", key: "shippingLeadTimeValue" },
  { header: "Shipping Lead Time Unit", key: "shippingLeadTimeUnit" },
  { header: "Landed Cost Value", key: "landedCostValue" },
  { header: "Landed Cost Note", key: "landedCostNote" },
  { header: "Item Warranty Value 1", key: "warranty1Value" },
  { header: "Item Warranty Unit 1", key: "warranty1Unit" },
  { header: "Item Warranty Value 2", key: "warranty2Value" },
  { header: "Item Warranty Unit 2", key: "warranty2Unit" },
  { header: "Discount Available", key: "discountAvailable" },
  { header: "Discount Applied to Quoted Price", key: "discountApplied" },
  { header: "Discount Value", key: "discountValue" },
  { header: "Discount Type", key: "discountType" },
  { header: "Other Notes 1", key: "otherNotes1" },
  { header: "Other Notes 2", key: "otherNotes2" },
  { header: "Confidence Code", key: "confidenceCode" },
];

const SUMMARY_COLUMNS: readonly Column[] = [
  { header: "Market", key: "market" },
  { header: "Client Item Number", key: "clientItemNumber" },
  { header: "Client Item Description", key: "clientItemDescription" },
  { header: "Min USD / Unit", key: "min" },
  { header: "Median USD / Unit", key: "median" },
  { header: "Max USD / Unit", key: "max" },
  { header: "Approved Quotes", key: "quoteCount" },
];

/** Build the Client Export workbook for a study's released + approved items.
 *  `studyName` names the detail sheet (the renderer sanitizes it for Excel). */
export function buildClientExport(
  studyName: string,
  items: readonly ClientExportItem[],
): WorkbookData {
  return { sheets: [detailSheet(studyName, items), summarySheet(items)] };
}

function detailSheet(studyName: string, items: readonly ClientExportItem[]): SheetData {
  const rows: Record<string, Cell>[] = [];
  for (const item of items) {
    for (const l of item.quotes) {
      const discountOn = l.discountAvailable === true && l.discountApplied === true;
      rows.push({
        rowId: l.rowId,
        market: item.market,
        marketQuoteNumber: l.marketQuoteNumber,
        clientCategory: item.clientCategory,
        clientSourceUnit: item.clientSourceUnit,
        clientSourceUnitIdentifier: item.clientSourceUnitIdentifier,
        clientItemOffering: item.clientItemOffering,
        clientItemDescription: item.clientItemDescription,
        clientItemSecondaryDescription: item.clientItemSecondaryDescription,
        clientItemQuantity: item.clientItemQuantity,
        clientItemNumber: item.clientItemNumber,
        clientSecondaryItemNumber: item.clientSecondaryItemNumber,
        clientItemConfigurationComment: item.clientItemConfigurationComment,
        sourceName: l.sourceName,
        sourceLocation: composeSourceLocation(l.sourceLocality, l.sourceCountry),
        sourceUrl: l.sourceUrl,
        competitorBrand: l.competitorBrand,
        competitorCategory: null,
        competitorSourceUnit: null,
        competitorSourceUnitIdentifier: null,
        competitorItemOffering: null,
        competitorItemDescription: l.competitorItemDescription,
        competitorItemSecondaryDescription: null,
        competitorItemQuantity: l.competitorItemQuantity,
        competitorItemNumber: l.competitorItemNumber,
        dateQuoteReceived: l.dateQuoteReceived,
        currencyTypeQuoted: l.currencyTypeQuoted,
        quotedPrice: l.quotedPrice,
        convertedCurrency: "USD",
        currencyExchangeRate: l.currencyExchangeRate,
        convertedPrice: l.convertedPrice,
        convertedPricePerUnit: l.convertedPricePerUnit,
        stockStatus: l.stockStatus,
        shippingLeadTimeValue: l.shippingLeadTimeValue,
        shippingLeadTimeUnit: l.shippingLeadTimeUnit,
        landedCostValue: yesNo(l.landedCostIncluded),
        landedCostNote: naWhenOff(l.landedCostIncluded, l.landedCostNote),
        warranty1Value: l.warranty1Value,
        warranty1Unit: l.warranty1Unit,
        warranty2Value: l.warranty2Value,
        warranty2Unit: l.warranty2Unit,
        discountAvailable: yesNo(l.discountAvailable),
        discountApplied: naWhenOff(l.discountAvailable, yesNo(l.discountApplied)),
        discountValue: discountOn ? l.discountValue : "N/A",
        // Type describes the kind of discount on offer, so it rides on
        // availability, not application — captured even when not applied.
        discountType: naWhenOff(l.discountAvailable, l.discountType),
        otherNotes1: l.otherNotes1,
        otherNotes2: l.otherNotes2,
        confidenceCode: l.confidenceCode,
      });
    }
  }
  return { name: studyName, columns: DETAIL_COLUMNS, rows };
}

/** The per-item min/median/max summary. Reuses the dashboard fold so the export's
 *  range agrees with the on-screen Competitor Price Range; a no-data item yields
 *  blank figures (never zeros), staying visible because it was released. */
function summarySheet(items: readonly ClientExportItem[]): SheetData {
  const dashboards = buildItemDashboards(
    items.map((item) => ({
      country: item.market,
      clientItemNumber: item.clientItemNumber,
      itemDescription: item.clientItemDescription,
      quotes: item.quotes.map((q) => ({
        competitorBrand: q.competitorBrand,
        usdPricePerUnit: q.convertedPricePerUnit,
      })),
    })),
  );
  const rows: Record<string, Cell>[] = dashboards.map((d) => ({
    market: d.country,
    clientItemNumber: d.clientItemNumber,
    clientItemDescription: d.itemDescription,
    min: d.range.hasData ? d.range.min : null,
    median: d.range.hasData ? d.range.median : null,
    max: d.range.hasData ? d.range.max : null,
    quoteCount: d.range.hasData ? d.range.count : 0,
  }));
  return { name: "Summary", columns: SUMMARY_COLUMNS, rows };
}
