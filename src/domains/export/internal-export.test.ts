import { describe, it, expect } from "vitest";
import { buildInternalExport, type InternalExportLine } from "./internal-export";

// The Internal Export (issue #93, CONTEXT.md: Internal Export, ADR-0029): the
// analyst_tracker workbook an Analyst/EM downloads of a whole study — every
// non-Draft Quote Line across all countries, in ONE sheet named after the study
// with Market as a column, matching the real artifact column-for-column. It adds
// the analyst-only Client Item Price (USD/unit), the Quoted Price Difference, and
// the Paper Quote flag, plus two trailing columns beyond the artifact (Price Flag
// direction + Justification). Pure — the Analyst+EM gate, the all-non-Draft read,
// the ExportAudit write, and exceljs rendering live in the adapter.

function line(over: Partial<InternalExportLine> = {}): InternalExportLine {
  return {
    rowId: 1,
    market: "Brazil",
    marketQuoteNumber: 1,
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
    sourceName: "Acme",
    sourceLocality: "Sao Paulo",
    sourceCountry: "Brazil",
    sourceUrl: null,
    competitorBrand: "Caterpillar",
    competitorItemDescription: null,
    competitorItemQuantity: 4,
    competitorItemNumber: null,
    dateQuoteReceived: "2026-06-15",
    currencyTypeQuoted: "BRL",
    quotedPriceTotal: 1100,
    currencyExchangeRate: 0.19727,
    convertedPrice: 1200,
    convertedPricePerUnit: 1200,
    clientItemPriceUsd: 1000,
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
    paperQuote: false,
    state: "Approved",
    justification: null,
    rejectionReason: null,
    ...over,
  };
}

// The analyst_tracker column headers, in the exact order the real artifact carries
// them, with the two analyst-only QC columns appended after Paper Quote (#93).
const ANALYST_TRACKER_HEADERS = [
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
  "Quoted Price Total",
  "Converted Currency",
  "Currency Exchange Rate",
  "Converted Price",
  "Converted Price Per Unit",
  "Client Item Price (USD/unit)",
  "Quoted Price Difference to Client Price",
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
  "Paper Quote",
  "Price Flag",
  "Justification",
  "State",
  "Rejection Reason",
];

describe("buildInternalExport — analyst_tracker shape", () => {
  it("emits one detail sheet named after the study, with the full artifact column set in order", () => {
    const wb = buildInternalExport("Boznia", [line()], 0.25);

    expect(wb.sheets).toHaveLength(1);
    const sheet = wb.sheets[0];
    expect(sheet.name).toBe("Boznia");
    expect(sheet.columns.map((c) => c.header)).toEqual(ANALYST_TRACKER_HEADERS);
  });

  it("keeps Row Id (the Quote Line Number) distinct from the Market Quote Number", () => {
    const wb = buildInternalExport("Boznia", [line({ rowId: 87, marketQuoteNumber: 3 })], 0.25);
    const [row] = wb.sheets[0].rows;
    expect(row.rowId).toBe(87);
    expect(row.marketQuoteNumber).toBe(3);
  });

  it("composes the single 'Source Location' cell from locality + Dealer Country (ADR-0032)", () => {
    const wb = buildInternalExport(
      "Boznia",
      [
        line({ sourceLocality: "Sao Paulo", sourceCountry: "Brazil" }),
        line({ sourceLocality: "Lyon", sourceCountry: null }),
        line({ sourceLocality: null, sourceCountry: "France" }),
        line({ sourceLocality: null, sourceCountry: null }),
      ],
      0.25,
    );
    expect(wb.sheets[0].rows.map((r) => r.sourceLocation)).toEqual([
      "Sao Paulo, Brazil",
      "Lyon",
      "France",
      null,
    ]);
  });

  it("reports the Client Price, the relative-difference fraction, and Paper Quote as Yes/No", () => {
    const wb = buildInternalExport(
      "Boznia",
      [line({ clientItemPriceUsd: 64384, convertedPricePerUnit: 61270, paperQuote: true })],
      0.25,
    );
    const [row] = wb.sheets[0].rows;
    expect(row.clientItemPriceUsd).toBe(64384);
    // |61270-64384| / ((61270+64384)/2) = 3114 / 62827 ≈ 0.04956 (the artifact value).
    expect(row.quotedPriceDifference).toBeCloseTo(0.04956, 4);
    expect(row.paperQuote).toBe("Yes");
  });

  it("leaves the difference blank when the line is not comparable (no Client Price or no USD)", () => {
    const wb = buildInternalExport(
      "Boznia",
      [
        line({ rowId: 1, clientItemPriceUsd: null, convertedPricePerUnit: 1200 }),
        line({ rowId: 2, clientItemPriceUsd: 1000, convertedPricePerUnit: null }),
      ],
      0.25,
    );
    expect(wb.sheets[0].rows.map((r) => r.quotedPriceDifference)).toEqual([null, null]);
  });

  it("appends Price Flag (direction only when breached) and Justification beyond the artifact", () => {
    const wb = buildInternalExport(
      "Boznia",
      [
        line({ rowId: 1, convertedPricePerUnit: 2000, clientItemPriceUsd: 1000, justification: "premium part" }), // +100% > 25%, dearer
        line({ rowId: 2, convertedPricePerUnit: 500, clientItemPriceUsd: 1000, justification: null }), // -67% > 25%, cheaper
        line({ rowId: 3, convertedPricePerUnit: 1050, clientItemPriceUsd: 1000, justification: null }), // within threshold
        line({ rowId: 4, convertedPricePerUnit: 1200, clientItemPriceUsd: null, justification: null }), // not comparable
      ],
      0.25,
    );
    expect(wb.sheets[0].rows.map((r) => ({ flag: r.priceFlag, just: r.justification }))).toEqual([
      { flag: "higher", just: "premium part" },
      { flag: "lower", just: null },
      { flag: null, just: null },
      { flag: null, just: null },
    ]);
  });

  it("renders dependent discount/landed-cost fields as N/A when their parent flag is off", () => {
    const wb = buildInternalExport(
      "Boznia",
      [
        line({
          discountAvailable: false,
          discountApplied: null,
          discountValue: null,
          discountType: null,
          landedCostIncluded: false,
          landedCostNote: null,
        }),
      ],
      0.25,
    );
    const [row] = wb.sheets[0].rows;
    expect(row.discountAvailable).toBe("No");
    expect(row.discountApplied).toBe("N/A");
    expect(row.discountValue).toBe("N/A");
    expect(row.discountType).toBe("N/A");
    expect(row.landedCostValue).toBe("No");
    expect(row.landedCostNote).toBe("N/A");
  });

  it("keeps the discount type when available but not applied; value stays N/A", () => {
    const wb = buildInternalExport(
      "Boznia",
      [line({ discountAvailable: true, discountApplied: false, discountValue: null, discountType: "loyalty" })],
      0.25,
    );
    const [row] = wb.sheets[0].rows;
    expect(row.discountApplied).toBe("No");
    expect(row.discountType).toBe("loyalty");
    expect(row.discountValue).toBe("N/A");
  });

  it("renders an applied discount's value/type, not N/A", () => {
    const wb = buildInternalExport(
      "Boznia",
      [line({ discountAvailable: true, discountApplied: true, discountValue: 10, discountType: "percent" })],
      0.25,
    );
    const [row] = wb.sheets[0].rows;
    expect(row.discountApplied).toBe("Yes");
    expect(row.discountValue).toBe(10);
    expect(row.discountType).toBe("percent");
  });

  it("emits the 5 unbacked competitor-descriptive columns as blank (fixed superset, never dropped)", () => {
    const wb = buildInternalExport("Boznia", [line()], 0.25);
    const [row] = wb.sheets[0].rows;
    for (const key of [
      "competitorCategory",
      "competitorSourceUnit",
      "competitorSourceUnitIdentifier",
      "competitorItemOffering",
      "competitorItemSecondaryDescription",
    ]) {
      expect(row[key]).toBeNull();
    }
  });

  it("sets Converted Currency to the constant USD", () => {
    const wb = buildInternalExport("Boznia", [line()], 0.25);
    expect(wb.sheets[0].rows[0].convertedCurrency).toBe("USD");
  });

  it("appends the analyst-only State and Rejection Reason columns (beyond the artifact)", () => {
    const wb = buildInternalExport(
      "Boznia",
      [
        line({ rowId: 1, state: "Rejected", rejectionReason: "wrong part" }),
        line({ rowId: 2, state: "Approved", rejectionReason: null }),
      ],
      0.25,
    );
    expect(wb.sheets[0].rows.map((r) => ({ state: r.state, reason: r.rejectionReason }))).toEqual([
      { state: "Rejected", reason: "wrong part" },
      { state: "Approved", reason: null },
    ]);
  });
});

// Row ordering is document-major and alphabetical (ADR-0040, superseding ADR-0029's
// row-order clause): Market → Market Quote Number → Client Source Unit (A→Z, nulls
// last) → Client Item Number (A→Z). The same dealer document's lines cluster
// together; an item priced by several documents repeats under each.
describe("buildInternalExport — row ordering (ADR-0040)", () => {
  it("orders rows document-major: a Market Quote's lines all precede the next document's", () => {
    const wb = buildInternalExport(
      "Boznia",
      [
        line({ rowId: 1, marketQuoteNumber: 2, clientItemNumber: "A" }),
        line({ rowId: 2, marketQuoteNumber: 1, clientItemNumber: "A" }),
        line({ rowId: 3, marketQuoteNumber: 2, clientItemNumber: "B" }),
        line({ rowId: 4, marketQuoteNumber: 1, clientItemNumber: "B" }),
      ],
      0.25,
    );
    expect(wb.sheets[0].rows.map((r) => r.marketQuoteNumber)).toEqual([1, 1, 2, 2]);
  });

  it("within a document, orders by Client Source Unit A→Z then Client Item Number A→Z", () => {
    const wb = buildInternalExport(
      "Boznia",
      [
        line({ rowId: 1, marketQuoteNumber: 1, clientSourceUnit: "ITR336490G", clientItemNumber: "300254" }),
        line({ rowId: 2, marketQuoteNumber: 1, clientSourceUnit: "BRC8T450X", clientItemNumber: "579952" }),
        line({ rowId: 3, marketQuoteNumber: 1, clientSourceUnit: "BRC8T450X", clientItemNumber: "209801" }),
        line({ rowId: 4, marketQuoteNumber: 1, clientSourceUnit: "ITR336490G", clientItemNumber: "186095" }),
      ],
      0.25,
    );
    expect(wb.sheets[0].rows.map((r) => [r.clientSourceUnit, r.clientItemNumber])).toEqual([
      ["BRC8T450X", "209801"],
      ["BRC8T450X", "579952"],
      ["ITR336490G", "186095"],
      ["ITR336490G", "300254"],
    ]);
  });

  it("sorts items with no Client Source Unit last within a document", () => {
    const wb = buildInternalExport(
      "Boznia",
      [
        line({ rowId: 1, marketQuoteNumber: 1, clientSourceUnit: null, clientItemNumber: "111" }),
        line({ rowId: 2, marketQuoteNumber: 1, clientSourceUnit: "AAA", clientItemNumber: "999" }),
        line({ rowId: 3, marketQuoteNumber: 1, clientSourceUnit: null, clientItemNumber: "000" }),
      ],
      0.25,
    );
    expect(wb.sheets[0].rows.map((r) => [r.clientSourceUnit, r.clientItemNumber])).toEqual([
      ["AAA", "999"],
      [null, "000"],
      [null, "111"],
    ]);
  });

  it("ranks Market above Market Quote Number (countries stay grouped, low quote number first)", () => {
    const wb = buildInternalExport(
      "Boznia",
      [
        line({ rowId: 1, market: "France", marketQuoteNumber: 1 }),
        line({ rowId: 2, market: "Brazil", marketQuoteNumber: 9 }),
        line({ rowId: 3, market: "Brazil", marketQuoteNumber: 2 }),
      ],
      0.25,
    );
    expect(wb.sheets[0].rows.map((r) => [r.market, r.marketQuoteNumber])).toEqual([
      ["Brazil", 2],
      ["Brazil", 9],
      ["France", 1],
    ]);
  });
});
