import { describe, it, expect } from "vitest";
import {
  buildClientExport,
  type ClientExportItem,
  type ClientExportLine,
} from "./client-export";

// The Client Export (issue #93, CONTEXT.md: Client Export, ADR-0029): the
// client_final_report workbook a Client User downloads of their own tenant's
// released + approved data. One detail sheet named after the study (Market as a
// column), matching the artifact column-for-column, plus a global Summary sheet
// (per-item min/median/max). NEVER the Client Price, the Quoted Price Difference,
// or the Paper Quote (ADR-0003/0029). Pure — the tenant gate, the released read,
// and exceljs rendering live in the adapter.

function line(over: Partial<ClientExportLine> = {}): ClientExportLine {
  return {
    rowId: 1,
    marketQuoteNumber: 1,
    sourceName: "Acme",
    sourceLocation: "Sao Paulo",
    sourceUrl: null,
    competitorBrand: "Caterpillar",
    competitorItemDescription: null,
    competitorItemQuantity: 4,
    competitorItemNumber: null,
    dateQuoteReceived: "2026-06-15",
    currencyTypeQuoted: "BRL",
    quotedPrice: 1100,
    currencyExchangeRate: 0.19727,
    convertedPrice: 1200,
    convertedPricePerUnit: 1200,
    stockStatus: "In stock",
    shippingLeadTimeValue: null,
    shippingLeadTimeUnit: null,
    landedCostIncluded: null,
    landedCostNote: null,
    warranty1Value: null,
    warranty1Unit: null,
    warranty2Value: null,
    warranty2Unit: null,
    discountAvailable: null,
    discountApplied: null,
    discountValue: null,
    discountType: null,
    otherNotes1: null,
    otherNotes2: null,
    confidenceCode: null,
    ...over,
  };
}

function item(over: Partial<ClientExportItem> = {}): ClientExportItem {
  return {
    market: "Brazil",
    clientCategory: null,
    clientSourceUnit: null,
    clientSourceUnitIdentifier: null,
    clientItemOffering: null,
    clientItemDescription: "Pump",
    clientItemSecondaryDescription: null,
    clientItemQuantity: 4,
    clientItemNumber: "PN-G1",
    clientSecondaryItemNumber: null,
    clientItemConfigurationComment: null,
    quotes: [],
    ...over,
  };
}

const CLIENT_REPORT_HEADERS = [
  "Row Id",
  "Market",
  "Market Quote Number",
  "Client Category",
  "Client Source Unit",
  "Client Source Unit Identifier",
  "Client Item Offering",
  "Client Item Description",
  "Client Item Secondary Description",
  "Client Item Quantity",
  "Client Item Number",
  "Client Secondary Item Number",
  "Client Item Configuration Comment",
  "Source Name",
  "Source Location",
  "Source URL",
  "Competitor Brand",
  "Competitor Category",
  "Competitor Source Unit",
  "Competitor Source Unit Identifier",
  "Competitor Item Offering",
  "Competitor Item Description",
  "Competitor Item Secondary Description",
  "Competitor Item Quantity",
  "Competitor Item Number",
  "Date Quote Received",
  "Currency Type Quoted",
  "Quoted Price",
  "Converted Currency",
  "Currency Exchange Rate",
  "Converted Price",
  "Converted Price Per Unit",
  "Item is In-stock or Out-of-stock",
  "Shipping Lead Time Value",
  "Shipping Lead Time Unit",
  "Landed Cost Value",
  "Landed Cost Note",
  "Item Warranty Value 1",
  "Item Warranty Unit 1",
  "Item Warranty Value 2",
  "Item Warranty Unit 2",
  "Discount Available",
  "Discount Applied to Quoted Price",
  "Discount Value",
  "Discount Type",
  "Other Notes 1",
  "Other Notes 2",
  "Confidence Code",
];

describe("buildClientExport — client_final_report detail sheet", () => {
  it("names the detail sheet after the study, with the client artifact columns and no analyst-only columns", () => {
    const wb = buildClientExport("Boznia", [item({ quotes: [line()] })]);

    const detail = wb.sheets[0];
    expect(detail.name).toBe("Boznia");
    expect(detail.columns.map((c) => c.header)).toEqual(CLIENT_REPORT_HEADERS);
    // The analyst-only columns must never appear in the client export.
    for (const banned of ["clientItemPriceUsd", "quotedPriceDifference", "paperQuote", "priceFlag", "justification"]) {
      expect(detail.columns.map((c) => c.key)).not.toContain(banned);
    }
  });

  it("emits one detail row per approved line, merging the item fields with the line, Market as a column", () => {
    const wb = buildClientExport("Boznia", [
      item({
        market: "Brazil",
        clientItemNumber: "PN-G1",
        clientItemDescription: "Pump",
        quotes: [line({ rowId: 7, competitorBrand: "Caterpillar", quotedPrice: 1100 })],
      }),
    ]);
    const [row] = wb.sheets[0].rows;
    expect(row.market).toBe("Brazil");
    expect(row.rowId).toBe(7);
    expect(row.clientItemNumber).toBe("PN-G1");
    expect(row.competitorBrand).toBe("Caterpillar");
    expect(row.quotedPrice).toBe(1100);
    expect(row.convertedCurrency).toBe("USD");
  });
});

describe("buildClientExport — global Summary sheet", () => {
  it("places a Summary sheet after the detail sheet with per-item min/median/max", () => {
    const wb = buildClientExport("Boznia", [
      item({
        market: "Brazil",
        clientItemNumber: "PN-G1",
        clientItemDescription: "Pump",
        quotes: [line({ convertedPricePerUnit: 900 }), line({ convertedPricePerUnit: 1100 }), line({ convertedPricePerUnit: 1300 })],
      }),
    ]);

    expect(wb.sheets.map((s) => s.name)).toEqual(["Boznia", "Summary"]);
    const summary = wb.sheets[1];
    expect(summary.columns.map((c) => c.key)).not.toContain("clientPrice");
    expect(summary.rows).toEqual([
      {
        market: "Brazil",
        clientItemNumber: "PN-G1",
        clientItemDescription: "Pump",
        min: 900,
        median: 1100,
        max: 1300,
        quoteCount: 3,
      },
    ]);
  });

  it("shows a released item with no usable data as an explicit no-data row, not zeros", () => {
    const wb = buildClientExport("Boznia", [item({ market: "Brazil", clientItemNumber: "PN-G2", quotes: [] })]);
    expect(wb.sheets[1].rows).toEqual([
      {
        market: "Brazil",
        clientItemNumber: "PN-G2",
        clientItemDescription: "Pump",
        min: null,
        median: null,
        max: null,
        quoteCount: 0,
      },
    ]);
  });
});

describe("buildClientExport — empty population", () => {
  it("emits a header-only detail sheet and an empty Summary when nothing qualifies", () => {
    const wb = buildClientExport("Boznia", []);
    expect(wb.sheets.map((s) => s.name)).toEqual(["Boznia", "Summary"]);
    expect(wb.sheets[0].columns.map((c) => c.header)).toEqual(CLIENT_REPORT_HEADERS);
    expect(wb.sheets[0].rows).toEqual([]);
    expect(wb.sheets[1].rows).toEqual([]);
  });
});
