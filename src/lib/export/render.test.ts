import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { renderWorkbook, sanitizeSheetName } from "./render";
import type { WorkbookData } from "@/domains/export/workbook";

// Proves the generic WorkbookData → .xlsx renderer (issue #15) produces a real,
// readable spreadsheet: the same buffer both exports stream to the browser. We
// read the bytes back with exceljs and assert sheet names, headers, and a row —
// behavior (a downloadable workbook), not the renderer's internals.

const data: WorkbookData = {
  sheets: [
    {
      name: "Quotes",
      columns: [
        { header: "Country", key: "country" },
        { header: "Price", key: "price" },
        { header: "Notes", key: "notes" },
      ],
      rows: [
        { country: "Germany", price: 1200, notes: null },
        { country: "France", price: 900, notes: "ex-demo" },
      ],
    },
    { name: "Summary", columns: [{ header: "Country", key: "country" }], rows: [] },
  ],
};

describe("renderWorkbook", () => {
  it("renders a readable .xlsx with the given sheets, headers, and rows", async () => {
    const buffer = await renderWorkbook(data);

    const read = new ExcelJS.Workbook();
    await read.xlsx.load(buffer as unknown as ArrayBuffer);

    expect(read.worksheets.map((w) => w.name)).toEqual(["Quotes", "Summary"]);

    const quotes = read.getWorksheet("Quotes")!;
    expect(quotes.getRow(1).values).toEqual([undefined, "Country", "Price", "Notes"]);
    expect(quotes.getRow(2).values).toEqual([undefined, "Germany", 1200]);
    expect(quotes.getRow(3).values).toEqual([undefined, "France", 900, "ex-demo"]);
  });
});

describe("sanitizeSheetName", () => {
  it("strips Excel-illegal characters and caps the name at 31 chars", () => {
    expect(sanitizeSheetName("Q2 2026: Brazil/Boznia pump pricing study")).toBe("Q2 2026  Brazil Boznia pump pri");
    expect(sanitizeSheetName("Q2 2026: Brazil/Boznia pump pricing study").length).toBeLessThanOrEqual(31);
  });

  it("falls back to a default when the name is empty after cleaning", () => {
    expect(sanitizeSheetName("   ")).toBe("Sheet1");
  });
});
