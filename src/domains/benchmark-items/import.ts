// Pure decision core — no framework, DB, or network imports.
//
// The Bulk Import validator (issue #5). Given the raw cell grid of a brief
// spreadsheet (the thin .xlsx adapter's only output), it validates the WHOLE
// file all-or-nothing and either returns normalised Benchmark Item records or a
// per-row error report — never a partial result (PRD: "never a half-loaded
// study"). Spreadsheet parsing lives in the adapter; ALL validation lives here,
// so the rules are exhaustively unit-testable with no file and no database.
//
// See CONTEXT.md (Benchmark Item, Required Quotes, Country, Client Price) and
// ADR-0009 (import is the source of truth; the upsert key is part number +
// country).

import { canonicalCountry } from "./countries";

/** The Benchmark Item fields a brief row carries, in canonical form. */
export const BENCHMARK_ITEM_FIELDS = [
  "country",
  "clientPartNumber",
  "itemDescription",
  "configurationComment",
  "quantity",
  "machineModel",
  "requiredQuotes",
  "clientPrice",
] as const;

export type BenchmarkItemField = (typeof BENCHMARK_ITEM_FIELDS)[number];

/** Fields whose column must be present; the rest (comment, quantity, clientPrice)
 *  are optional. Client Price is only *seeded* by the brief (ADR-0015): an item
 *  the client never priced may omit it, so the column is not required. */
const REQUIRED_FIELDS = [
  "country",
  "clientPartNumber",
  "itemDescription",
  "machineModel",
  "requiredQuotes",
] as const satisfies readonly BenchmarkItemField[];

/** The canonical spreadsheet header label for each field (matched loosely). */
const CANONICAL_HEADERS: Record<BenchmarkItemField, string> = {
  country: "Country",
  clientPartNumber: "Client Part Number",
  itemDescription: "Item Description",
  configurationComment: "Configuration Comment",
  quantity: "Quantity",
  machineModel: "Machine/Model",
  requiredQuotes: "Required Quotes",
  clientPrice: "Client Price",
};

/** A validated, normalised Benchmark Item ready to upsert (numbers parsed,
 *  country canonicalised, part-number key folded). `clientPrice` is USD/unit. */
export interface ValidatedBenchmarkItem {
  readonly country: string;
  readonly clientPartNumber: string;
  readonly clientPartNumberKey: string;
  readonly itemDescription: string;
  readonly configurationComment: string | null;
  readonly quantity: number | null;
  readonly machineModel: string;
  readonly requiredQuotes: number;
  /** USD/unit. Null when the brief left it blank — an unpriced item (ADR-0015). */
  readonly clientPrice: number | null;
}

/** One problem with the file. `row` is the 1-based spreadsheet row (data starts
 *  at row 2); `null` means a file-level problem (e.g. a missing header). */
export interface ImportError {
  readonly row: number | null;
  readonly field: BenchmarkItemField | null;
  readonly message: string;
}

export type ImportValidation =
  | { readonly ok: true; readonly items: readonly ValidatedBenchmarkItem[] }
  | { readonly ok: false; readonly errors: readonly ImportError[] };

/** Fold a part number for the upsert key: trim + lowercase (ADR-0009 — the key
 *  matches case-insensitively on part number; first-seen casing is displayed). */
export function partNumberKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The Benchmark Item identity, as a single collision-free string: canonical
 *  country + folded part number (ADR-0009). The one definition of the key, used
 *  both for in-file duplicate detection and the upsert resolver. */
export function benchmarkItemKey(item: {
  readonly country: string;
  readonly clientPartNumberKey: string;
}): string {
  return JSON.stringify([item.country, item.clientPartNumberKey]);
}

/**
 * Validate a whole brief spreadsheet, all-or-nothing.
 *
 * @param grid the raw cell grid including the header row (`grid[0]`), every cell
 *   already stringified by the adapter; blanks are `""`.
 */
export function validateImport(grid: readonly (readonly string[])[]): ImportValidation {
  if (grid.length === 0) {
    return { ok: false, errors: [{ row: null, field: null, message: "The file is empty" }] };
  }

  const header = grid[0];
  const columnOf = mapHeaders(header);

  // File-level header validation first, so a missing column is reported once —
  // not as per-row "required" noise on every data row.
  const headerErrors: ImportError[] = REQUIRED_FIELDS.filter((f) => !columnOf.has(f)).map(
    (f) => ({ row: null, field: f, message: `Missing required column: "${CANONICAL_HEADERS[f]}"` }),
  );
  if (headerErrors.length > 0) return { ok: false, errors: headerErrors };

  if (grid.length < 2) {
    return { ok: false, errors: [{ row: null, field: null, message: "The file has no data rows" }] };
  }

  const errors: ImportError[] = [];
  const items: ValidatedBenchmarkItem[] = [];
  const firstSeenAtRow = new Map<string, number>(); // upsert key -> earliest row

  for (let i = 1; i < grid.length; i++) {
    const rowNumber = i + 1; // spreadsheet row: header is row 1, data from row 2
    const row = grid[i];
    const cell = (field: BenchmarkItemField): string => {
      const idx = columnOf.get(field);
      return idx === undefined ? "" : (row[idx] ?? "").trim();
    };
    const fail = (field: BenchmarkItemField, message: string) =>
      errors.push({ row: rowNumber, field, message });

    // Required free-text fields: present and non-blank.
    const country = cell("country");
    const canonical = canonicalCountry(country);
    const clientPartNumber = cell("clientPartNumber");
    const clientPartNumberKey = partNumberKey(clientPartNumber);
    const itemDescription = cell("itemDescription");
    const machineModel = cell("machineModel");
    if (country === "") fail("country", "Country is required");
    else if (canonical === null)
      fail("country", `Unknown country "${country}" — use a canonical country name`);
    if (clientPartNumber === "") fail("clientPartNumber", "Client Part Number is required");
    if (itemDescription === "") fail("itemDescription", "Item Description is required");
    if (machineModel === "") fail("machineModel", "Machine/Model is required");

    // Required numeric fields, with range checks.
    const requiredQuotesRaw = cell("requiredQuotes");
    const requiredQuotes = Number(requiredQuotesRaw);
    if (requiredQuotesRaw === "") fail("requiredQuotes", "Required Quotes is required");
    else if (!Number.isInteger(requiredQuotes) || requiredQuotes < 0)
      fail("requiredQuotes", "Required Quotes must be a whole number >= 0");

    // Client Price is optional — the brief only seeds it (ADR-0015). Blank means
    // an unpriced item (null). A value that IS present must be a number > 0.
    const clientPriceRaw = cell("clientPrice");
    const clientPrice = clientPriceRaw === "" ? null : Number(clientPriceRaw);
    if (clientPrice !== null && (!Number.isFinite(clientPrice) || clientPrice <= 0))
      fail("clientPrice", "Client Price must be a number greater than 0 when provided");

    // Quantity is optional, but a value that IS present must be a positive whole
    // number (the client's own quantity for the part).
    const quantityRaw = cell("quantity");
    const quantity = quantityRaw === "" ? null : Number(quantityRaw);
    if (quantity !== null && (!Number.isInteger(quantity) || quantity <= 0))
      fail("quantity", "Quantity must be a whole number greater than 0 when provided");

    // In-file duplicate detection on the upsert key. Only meaningful once both
    // halves are present (a blank/unknown country is already its own error).
    if (canonical !== null && clientPartNumber !== "") {
      const key = benchmarkItemKey({ country: canonical, clientPartNumberKey });
      const firstRow = firstSeenAtRow.get(key);
      if (firstRow !== undefined) {
        fail("clientPartNumber", `Duplicate of row ${firstRow}: same Client Part Number + Country`);
      } else {
        firstSeenAtRow.set(key, rowNumber);
      }
    }

    items.push({
      country: canonical ?? country,
      clientPartNumber,
      clientPartNumberKey,
      itemDescription,
      configurationComment: cell("configurationComment") || null,
      quantity,
      machineModel,
      requiredQuotes,
      clientPrice,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, items };
}

/** Normalise a header label for tolerant matching: trim, collapse whitespace,
 *  lowercase. "Machine / Model" and "machine/model" both match. */
function normaliseHeader(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Map each known field to the column index it occupies in the header row. */
function mapHeaders(header: readonly string[]): Map<BenchmarkItemField, number> {
  const byLabel = new Map<string, number>();
  header.forEach((label, idx) => byLabel.set(normaliseHeader(label), idx));

  const columnOf = new Map<BenchmarkItemField, number>();
  for (const field of BENCHMARK_ITEM_FIELDS) {
    const idx = byLabel.get(normaliseHeader(CANONICAL_HEADERS[field]));
    if (idx !== undefined) columnOf.set(field, idx);
  }
  return columnOf;
}
