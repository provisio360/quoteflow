import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseXlsx } from "./parse-xlsx";

// Build a real .xlsx in memory so we exercise the actual parser, not a mock.
async function xlsxBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("parseXlsx — thin .xlsx -> string grid adapter", () => {
  it("returns every cell as a trimmed string, preserving rows and columns", async () => {
    const buf = await xlsxBuffer([
      ["Country", "Client Part Number", "Client Price"],
      ["Germany", "PN-100", 1250.5], // numbers come back as strings
    ]);

    const grid = await parseXlsx(buf);

    expect(grid).toEqual([
      ["Country", "Client Part Number", "Client Price"],
      ["Germany", "PN-100", "1250.5"],
    ]);
  });

  it("returns an empty grid for an empty workbook", async () => {
    const buf = await xlsxBuffer([]);
    expect(await parseXlsx(buf)).toEqual([]);
  });
});
