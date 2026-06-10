// Generates a valid sample brief .xlsx for UAT case A2 (bulk import).
// Headers + rules per src/domains/benchmark-items/import.ts:
//   Required columns: Country, Client Part Number, Item Description,
//                     Machine/Model, Required Quotes
//   Optional columns: Configuration Comment, Quantity, Client Price
//   Country must be a canonical name; Required Quotes = whole number >= 0;
//   Client Price > 0 or blank; Quantity = whole number > 0 or blank.
// Run: npx tsx scripts/make-uat-import.ts
import ExcelJS from "exceljs";

const HEADERS = [
  "Country",
  "Client Part Number",
  "Item Description",
  "Configuration Comment",
  "Quantity",
  "Machine/Model",
  "Required Quotes",
  "Client Price",
];

// [country, partNo, description, configComment, quantity, machine/model, requiredQuotes, clientPrice]
const ROWS: (string | number)[][] = [
  ["United States", "CPN-1001", "Hydraulic pump assembly", "High-pressure variant", 5, "Excavator EX-200", 3, 1850.0],
  ["United States", "CPN-1002", "Track roller", "Sealed bearing", 12, "Excavator EX-200", 3, 145.5],
  ["United States", "CPN-1003", "Bucket cutting edge", "", 4, "Loader LD-90", 2, ""],
  ["Germany", "CPN-2001", "Fuel injector", "Common-rail", 8, "Tractor TR-450", 3, 320.0],
  ["Germany", "CPN-2002", "Turbocharger", "Variable-geometry", 2, "Tractor TR-450", 2, 2100.0],
  ["Germany", "CPN-2003", "Air filter element", "", 20, "Tractor TR-450", 2, 38.75],
  ["Japan", "CPN-3001", "Alternator 24V", "80A output", 6, "Forklift FK-30", 3, 410.0],
  ["Japan", "CPN-3002", "Brake disc", "Ventilated", 10, "Forklift FK-30", 2, ""],
  ["United Kingdom", "CPN-4001", "Starter motor", "Gear-reduction", 3, "Generator GN-500", 3, 275.0],
  ["United Kingdom", "CPN-4002", "Coolant pump", "", 7, "Generator GN-500", 2, 165.25],
];

// Deliberately-broken rows for UAT case A4 (all-or-nothing rejection with a
// per-row error report). Each row carries exactly one defect so the report is
// easy to read against. Spreadsheet row numbers are data-row + 1 (header = 1).
const INVALID_ROWS: (string | number)[][] = [
  // row 2: unknown country
  ["Atlantis", "BAD-1", "Hydraulic pump", "", 5, "Excavator EX-200", 3, 100.0],
  // row 3: missing Client Part Number
  ["Germany", "", "Fuel injector", "", 8, "Tractor TR-450", 3, 320.0],
  // row 4: missing Item Description
  ["Japan", "BAD-3", "", "", 6, "Forklift FK-30", 3, 410.0],
  // row 5: Required Quotes not a whole number >= 0
  ["France", "BAD-4", "Brake disc", "", 4, "Loader LD-90", -2, 55.0],
  // row 6: Client Price present but <= 0
  ["Canada", "BAD-5", "Air filter", "", 10, "Tractor TR-450", 2, 0],
  // row 7: Quantity present but not a positive whole number
  ["Mexico", "BAD-6", "Coolant pump", "", 0, "Generator GN-500", 2, 165.0],
  // row 8: missing Machine/Model
  ["Brazil", "BAD-7", "Starter motor", "", 3, "", 3, 275.0],
  // rows 9 & 10: duplicate of each other on (Client Part Number + Country)
  ["United States", "DUP-9", "Track roller", "", 12, "Excavator EX-200", 3, 145.5],
  ["United States", "dup-9", "Track roller", "", 12, "Excavator EX-200", 3, 145.5],
];

async function writeWorkbook(name: string, rows: (string | number)[][]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Benchmark Items");
  sheet.addRow(HEADERS);
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };
  await wb.xlsx.writeFile(name);
}

async function main() {
  await writeWorkbook("uat-import-sample.xlsx", ROWS);
  console.log(`Wrote uat-import-sample.xlsx: ${ROWS.length} valid rows across 4 countries.`);

  await writeWorkbook("uat-import-invalid.xlsx", INVALID_ROWS);
  console.log(`Wrote uat-import-invalid.xlsx: ${INVALID_ROWS.length} rows, each with one defect.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
