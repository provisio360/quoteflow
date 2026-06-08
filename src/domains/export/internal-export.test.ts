import { describe, it, expect } from "vitest";
import { buildInternalExport, type InternalExportQuote } from "./internal-export";

// The Internal Export (issue #15, CONTEXT.md: Internal Export): the fuller
// workbook an Analyst/EM downloads of a whole study — every non-Draft Quote
// across all countries, WITH the Client Price, QC Flag direction, and
// Justification (none of which a Client User ever sees). Pure — the Analyst+EM
// gate, the all-non-Draft read, the ExportAudit write, and exceljs rendering
// live in the adapter (src/lib/export); this builds the workbook shape.

function quote(over: Partial<InternalExportQuote> = {}): InternalExportQuote {
  return {
    country: "Germany",
    clientPartNumber: "PN-G1",
    itemDescription: "Pump",
    clientPrice: 1000,
    state: "Approved",
    quoteNumber: 1,
    competitorBrand: "Caterpillar",
    dealerName: "Acme",
    dealerLocation: "Berlin",
    price: 1100,
    currency: "EUR",
    quantityQuoted: 1,
    convertedUsdPrice: 1200,
    usdPricePerUnit: 1200,
    stockStatus: null,
    leadTime: null,
    warranty: null,
    discount: null,
    notes: null,
    justification: "genuinely a premium part",
    rejectionReason: null,
    ...over,
  };
}

describe("buildInternalExport — Quotes sheet", () => {
  it("includes Client Price and Justification columns and one row per non-Draft quote", () => {
    const wb = buildInternalExport(
      [
        quote({ state: "Submitted", quoteNumber: 1, justification: "premium" }),
        quote({ state: "Rejected", quoteNumber: 2, rejectionReason: "wrong part", justification: null }),
      ],
      25,
    );

    const sheet = wb.sheets.find((s) => s.name === "Quotes")!;
    const keys = sheet.columns.map((c) => c.key);
    expect(keys).toContain("clientPrice");
    expect(keys).toContain("justification");
    expect(keys).toContain("state");

    expect(sheet.rows.map((r) => ({ state: r.state, clientPrice: r.clientPrice, justification: r.justification, rejectionReason: r.rejectionReason }))).toEqual([
      { state: "Submitted", clientPrice: 1000, justification: "premium", rejectionReason: null },
      { state: "Rejected", clientPrice: 1000, justification: null, rejectionReason: "wrong part" },
    ]);
  });

  it("reports the QC Flag direction, marking out-of-threshold quotes as flagged", () => {
    const wb = buildInternalExport(
      [
        quote({ usdPricePerUnit: 2000, clientPrice: 1000 }), // +100% vs 25% threshold
        quote({ usdPricePerUnit: 1050, clientPrice: 1000 }), // within threshold, dearer
      ],
      25,
    );
    const flags = wb.sheets[0].rows.map((r) => r.qcFlag);
    expect(flags).toEqual(["above (flagged)", "above"]);
  });

  it("marks a quote with no Client Price or no USD figure as 'n/a' (not comparable)", () => {
    const wb = buildInternalExport(
      [
        quote({ clientPrice: null, usdPricePerUnit: 1200 }),
        quote({ clientPrice: 1000, usdPricePerUnit: null }),
      ],
      25,
    );
    expect(wb.sheets[0].rows.map((r) => r.qcFlag)).toEqual(["n/a", "n/a"]);
  });
});
