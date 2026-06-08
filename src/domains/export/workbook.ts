// Pure decision core — no framework, DB, or network imports.
//
// The framework-agnostic description of an export workbook (issue #15). The pure
// export builders (client-export, internal-export) produce this shape; the
// adapter (src/lib/export) renders it to an .xlsx via exceljs. Keeping the
// description plain data is what makes the column/row logic exhaustively
// unit-testable with no spreadsheet library in the loop.

/** A single cell value. Dates are pre-formatted to strings by the builders so the
 *  pure shape stays free of timezone/locale concerns. */
export type Cell = string | number | null;

/** One column: the human header shown in the sheet and the row key it reads. */
export interface Column {
  readonly header: string;
  readonly key: string;
}

/** One sheet: its tab name, ordered columns, and rows keyed by column key. */
export interface SheetData {
  readonly name: string;
  readonly columns: readonly Column[];
  readonly rows: readonly Readonly<Record<string, Cell>>[];
}

/** A whole workbook: an ordered set of sheets. */
export interface WorkbookData {
  readonly sheets: readonly SheetData[];
}
