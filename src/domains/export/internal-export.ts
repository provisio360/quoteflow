// Pure decision core — no framework, DB, or network imports.
//
// Builds the Internal Export workbook (issue #93, CONTEXT.md: Internal Export,
// ADR-0029): every non-Draft Quote Line in a study across all countries, in ONE
// sheet named after the study with Market as a column, reproducing the real
// analyst_tracker artifact column-for-column — PLUS the analyst-only Client Item
// Price (USD/unit), the Quoted Price Difference, the Paper Quote flag, and two
// trailing QC columns beyond the artifact (Price Flag direction + Justification).
// Drafts never reach here (ADR-0011); the Analyst+EM gate and the read live in the
// adapter (src/lib/export). Client-facing reads never produce this shape.

import type { Cell, Column, WorkbookData } from "./workbook";
import { yesNo, naWhenOff } from "./cells";
import { evaluatePriceFlag } from "@/domains/quotes/price-flag";

/** One non-Draft Quote Line as the analyst_tracker reads it: line fields joined to
 *  the parent document's facts, plus the item context the analyst needs (Client
 *  Price for the QC flag, the line's review fields). Booleans arrive raw and are
 *  rendered Yes/No here; the date arrives pre-formatted (YYYY-MM-DD) from the
 *  adapter so the pure core stays free of timezone concerns. */
export interface InternalExportLine {
  readonly rowId: number; // the Quote Line Number ("Row 87")
  readonly market: string;
  readonly marketQuoteNumber: number;
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
  readonly sourceName: string | null;
  readonly sourceLocality: string | null;
  readonly sourceUrl: string | null;
  readonly competitorBrand: string | null;
  readonly competitorItemDescription: string | null;
  readonly competitorItemQuantity: number | null;
  readonly competitorItemNumber: string | null;
  readonly dateQuoteReceived: string | null;
  readonly currencyTypeQuoted: string | null;
  readonly quotedPriceTotal: number | null;
  readonly currencyExchangeRate: number | null;
  readonly convertedPrice: number | null;
  readonly convertedPricePerUnit: number | null;
  readonly clientItemPriceUsd: number | null;
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
  readonly paperQuote: boolean;
  // The analyst-only review columns, appended beyond the artifact (#93): the line's
  // lifecycle state (so Submitted/Approved/Rejected is visible) and the latest
  // rejection reason. The Client Export never carries these.
  readonly state: string;
  readonly justification: string | null;
  readonly rejectionReason: string | null;
}

// The analyst_tracker columns, in the exact order the real artifact carries them,
// with the two analyst-only QC columns appended after Paper Quote. The five
// competitor-descriptive columns have no backing field yet and are emitted blank
// (ADR-0029) — a fixed superset, never dropped.
const COLUMNS: readonly Column[] = [
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
  { header: "Source Location", key: "sourceLocality" },
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
  { header: "Quoted Price Total", key: "quotedPriceTotal" },
  { header: "Converted Currency", key: "convertedCurrency" },
  { header: "Currency Exchange Rate", key: "currencyExchangeRate" },
  { header: "Converted Price", key: "convertedPrice" },
  { header: "Converted Price Per Unit", key: "convertedPricePerUnit" },
  { header: "Client Item Price (USD/unit)", key: "clientItemPriceUsd" },
  { header: "Quoted Price Difference to Client Price", key: "quotedPriceDifference" },
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
  { header: "Paper Quote", key: "paperQuote" },
  { header: "Price Flag", key: "priceFlag" },
  { header: "Justification", key: "justification" },
  { header: "State", key: "state" },
  { header: "Rejection Reason", key: "rejectionReason" },
];

/**
 * Build the Internal Export workbook. `studyName` names the single detail sheet
 * (the adapter/renderer sanitizes it for Excel); `threshold` is the QC Threshold
 * as a FRACTION, applied to each line's Price Flag exactly as the per-line flag.
 */
export function buildInternalExport(
  studyName: string,
  lines: readonly InternalExportLine[],
  threshold: number,
): WorkbookData {
  const rows: Record<string, Cell>[] = lines.map((l) => {
    const flag = evaluatePriceFlag({
      usdPricePerUnit: l.convertedPricePerUnit,
      clientPrice: l.clientItemPriceUsd,
      threshold,
    });
    const discountOn = l.discountAvailable === true && l.discountApplied === true;
    return {
      rowId: l.rowId,
      market: l.market,
      marketQuoteNumber: l.marketQuoteNumber,
      clientCategory: l.clientCategory,
      clientSourceUnit: l.clientSourceUnit,
      clientSourceUnitIdentifier: l.clientSourceUnitIdentifier,
      clientItemOffering: l.clientItemOffering,
      clientItemDescription: l.clientItemDescription,
      clientItemSecondaryDescription: l.clientItemSecondaryDescription,
      clientItemQuantity: l.clientItemQuantity,
      clientItemNumber: l.clientItemNumber,
      clientSecondaryItemNumber: l.clientSecondaryItemNumber,
      clientItemConfigurationComment: l.clientItemConfigurationComment,
      sourceName: l.sourceName,
      sourceLocality: l.sourceLocality,
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
      quotedPriceTotal: l.quotedPriceTotal,
      convertedCurrency: "USD",
      currencyExchangeRate: l.currencyExchangeRate,
      convertedPrice: l.convertedPrice,
      convertedPricePerUnit: l.convertedPricePerUnit,
      clientItemPriceUsd: l.clientItemPriceUsd,
      quotedPriceDifference: flag.comparable ? flag.relativeDiff : null,
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
      discountType: discountOn ? l.discountType : "N/A",
      otherNotes1: l.otherNotes1,
      otherNotes2: l.otherNotes2,
      confidenceCode: l.confidenceCode,
      paperQuote: yesNo(l.paperQuote),
      priceFlag: priceFlagCell(flag),
      justification: l.justification,
      state: l.state,
      rejectionReason: l.rejectionReason,
    };
  });
  return { sheets: [{ name: studyName, columns: COLUMNS, rows }] };
}

/** The Price Flag cell: the direction (higher/lower) ONLY when the line is
 *  actually flagged (breached its QC Threshold); blank when within tolerance or
 *  not comparable — the advisory signal is only raised on a breach. */
function priceFlagCell(flag: ReturnType<typeof evaluatePriceFlag>): Cell {
  if (!flag.comparable || !flag.flagged) return null;
  return flag.direction === "above" ? "higher" : flag.direction === "below" ? "lower" : null;
}
