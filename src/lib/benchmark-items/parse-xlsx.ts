import ExcelJS from "exceljs";

// Thin adapter: turn .xlsx bytes into the raw cell grid the pure import
// validator consumes (issue #5; PRD: "spreadsheet parsing is a thin adapter
// feeding the pure validator"). It does NO validation — every cell becomes a
// trimmed string, blanks become "", and the grid keeps its row/column shape.
// All the rules live in src/domains/benchmark-items, with no file dependency.

/** Parse the first worksheet of an .xlsx workbook into a grid of string cells
 *  (including the header row). Empty workbook -> []. */
export async function parseXlsx(data: Buffer | ArrayBuffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as ArrayBuffer);

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) return [];

  // Width is the header row's column span; read every row to that width so
  // columns stay aligned even when a data row has trailing blanks.
  const width = sheet.getRow(1).cellCount;
  const grid: string[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) {
      cells.push((row.getCell(c).text ?? "").trim());
    }
    grid.push(cells);
  }
  return grid;
}
