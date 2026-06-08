import ExcelJS from "exceljs";
import type { WorkbookData } from "@/domains/export/workbook";

// The generic WorkbookData → .xlsx renderer (issue #15). Both the Client Export
// and the Internal Export build a pure WorkbookData (src/domains/export) and pass
// it through here to get the bytes the route handler streams. exceljs is confined
// to this one module; the column/row logic stays pure and library-free.

/** Render a pure WorkbookData description into an .xlsx file buffer. */
export async function renderWorkbook(data: WorkbookData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of data.sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key }));
    for (const row of sheet.rows) {
      ws.addRow(row);
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
