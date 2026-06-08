import { describe, it, expect } from "vitest";
import {
  buildClientExport,
  type ClientExportItem,
  type ClientExportQuote,
} from "./client-export";

// The Client Export (issue #15): the workbook a Client User downloads of their
// own tenant's released + approved data. Two sheets — a detail "Quotes" sheet
// (one row per released+approved Quote) and a "Summary" sheet (per-item
// min/median/max). The Client Price is NEVER present (ADR-0003). Pure — the
// tenant gate, released/approved read, and exceljs rendering live in the adapter
// (src/lib/export); this builds the workbook shape.

function item(over: Partial<ClientExportItem> = {}): ClientExportItem {
  return {
    country: "France",
    clientPartNumber: "CP-1",
    itemDescription: "Widget",
    quotes: [],
    ...over,
  };
}

describe("buildClientExport — detail Quotes sheet", () => {
  it("emits one detail row per approved quote, with no Client Price column", () => {
    const wb = buildClientExport([
      item({
        country: "Germany",
        clientPartNumber: "PN-G1",
        itemDescription: "Pump",
        quotes: [
          {
            quoteNumber: 1,
            competitorBrand: "Caterpillar",
            dealerName: "Acme",
            dealerLocation: "Berlin",
            price: 1100,
            currency: "EUR",
            quantityQuoted: 1,
            convertedUsdPrice: 1200,
            usdPricePerUnit: 1200,
            stockStatus: "In stock",
            leadTime: "2w",
            warranty: "1y",
            discount: null,
            notes: "ex-demo",
          },
        ],
      }),
    ]);

    const quotes = wb.sheets.find((s) => s.name === "Quotes");
    expect(quotes).toBeDefined();
    // The Client Price must never appear among the client export's columns.
    expect(quotes!.columns.map((c) => c.key)).not.toContain("clientPrice");
    expect(quotes!.rows).toEqual([
      {
        country: "Germany",
        clientPartNumber: "PN-G1",
        itemDescription: "Pump",
        quoteNumber: 1,
        competitorBrand: "Caterpillar",
        dealerName: "Acme",
        dealerLocation: "Berlin",
        price: 1100,
        currency: "EUR",
        quantityQuoted: 1,
        convertedUsdPrice: 1200,
        usdPricePerUnit: 1200,
        stockStatus: "In stock",
        leadTime: "2w",
        warranty: "1y",
        discount: null,
        notes: "ex-demo",
      },
    ]);
  });
});

describe("buildClientExport — Summary sheet", () => {
  function quote(usdPricePerUnit: number | null): ClientExportQuote {
    return {
      quoteNumber: 1,
      competitorBrand: "Acme",
      dealerName: "Acme",
      dealerLocation: null,
      price: null,
      currency: null,
      quantityQuoted: null,
      convertedUsdPrice: null,
      usdPricePerUnit,
      stockStatus: null,
      leadTime: null,
      warranty: null,
      discount: null,
      notes: null,
    };
  }

  it("summarises each item's range as min/median/max, and Client Price never appears", () => {
    const wb = buildClientExport([
      item({
        country: "Germany",
        clientPartNumber: "PN-G1",
        itemDescription: "Pump",
        quotes: [quote(900), quote(1100), quote(1300)],
      }),
    ]);

    const summary = wb.sheets.find((s) => s.name === "Summary");
    expect(summary).toBeDefined();
    expect(summary!.columns.map((c) => c.key)).not.toContain("clientPrice");
    expect(summary!.rows).toEqual([
      {
        country: "Germany",
        clientPartNumber: "PN-G1",
        itemDescription: "Pump",
        min: 900,
        median: 1100,
        max: 1300,
        quoteCount: 3,
      },
    ]);
  });

  it("shows a released item with no usable data as an explicit no-data row, not zeros", () => {
    const wb = buildClientExport([
      item({ country: "Germany", clientPartNumber: "PN-G2", quotes: [] }),
    ]);
    const summary = wb.sheets.find((s) => s.name === "Summary")!;
    expect(summary.rows).toEqual([
      {
        country: "Germany",
        clientPartNumber: "PN-G2",
        itemDescription: "Widget",
        min: null,
        median: null,
        max: null,
        quoteCount: 0,
      },
    ]);
  });
});
