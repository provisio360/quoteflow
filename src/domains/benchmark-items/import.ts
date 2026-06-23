// Pure decision core — no framework, DB, or network imports.
//
// The Bulk Import validator (issue #5, extended in #86). Given the raw cell grid
// of a brief spreadsheet (the thin .xlsx adapter's only output), it validates the
// WHOLE file all-or-nothing and either returns normalised Benchmark Item records
// or a per-row error report — never a partial result (PRD: "never a half-loaded
// study"). Spreadsheet parsing lives in the adapter; ALL validation lives here,
// so the rules are exhaustively unit-testable with no file and no database.
//
// See CONTEXT.md (Benchmark Item, Required Quotes, Country, Client Price, QC
// Threshold, Required Competitors) and ADR-0009 (import is the source of truth;
// the upsert key is Client Item Number + country), ADR-0015 / ADR-0027 (Client
// Price is import-seeded once then analyst-owned; the seed trio is insert-only).

import { canonicalCountry } from "./countries";
import { deriveClientPrice } from "./client-price-derivation";

/** The number of `Required Competitor N` columns the brief may carry. */
const MAX_REQUIRED_COMPETITORS = 10;

/** The scalar Benchmark Item fields a brief row carries, in canonical form.
 *  Required Competitors are handled separately (a numbered column family). */
export const BENCHMARK_ITEM_FIELDS = [
  "country",
  "clientItemNumber",
  "itemDescription",
  "configurationComment",
  "quantity",
  "clientSourceUnit",
  "sourceUnitIdentifier",
  "clientCategory",
  "clientItemOffering",
  "itemSecondaryDescription",
  "clientSecondaryItemNumber",
  "requiredQuotes",
  "qcThreshold",
  "clientItemPrice",
  "clientItemPriceCurrency",
  "clientItemPriceQuantity",
] as const;

export type BenchmarkItemField = (typeof BENCHMARK_ITEM_FIELDS)[number];

/** Fields whose column must be present. Everything else is optional/nullable —
 *  including Client Source Unit (#86: not every brief names a source unit) and
 *  the Client Price trio (only *seeds* the value, ADR-0015). */
const REQUIRED_FIELDS = [
  "country",
  "clientItemNumber",
  "itemDescription",
  "requiredQuotes",
] as const satisfies readonly BenchmarkItemField[];

/** The canonical spreadsheet header label for each field (matched loosely). */
const CANONICAL_HEADERS: Record<BenchmarkItemField, string> = {
  country: "Country",
  clientItemNumber: "Client Item Number",
  itemDescription: "Item Description",
  configurationComment: "Configuration Comment",
  quantity: "Quantity",
  clientSourceUnit: "Client Source Unit",
  sourceUnitIdentifier: "Source Unit Identifier",
  clientCategory: "Client Category",
  clientItemOffering: "Client Item Offering",
  itemSecondaryDescription: "Item Secondary Description",
  clientSecondaryItemNumber: "Client Secondary Item Number",
  requiredQuotes: "Required Quotes",
  qcThreshold: "Price Difference Threshold",
  clientItemPrice: "Client Item Price",
  clientItemPriceCurrency: "Client Item Price Currency",
  clientItemPriceQuantity: "Client Item Price Quantity",
};

/** Extra header labels a brief may carry for a field, beyond the canonical label
 *  (matched just as loosely). Real client briefs name Country "Market" and prefix
 *  most item columns with "Client" — e.g. "Client Item Description". Both the
 *  canonical label and any alias resolve to the same field. */
const HEADER_ALIASES: Partial<Record<BenchmarkItemField, readonly string[]>> = {
  country: ["Market"],
  itemDescription: ["Client Item Description"],
  configurationComment: ["Client Item Configuration Comment"],
  quantity: ["Client Item Quantity"],
  sourceUnitIdentifier: ["Client Source Unit Identifier"],
  itemSecondaryDescription: ["Client Item Secondary Description"],
};

/** A validated, normalised Benchmark Item ready to upsert (numbers parsed,
 *  country canonicalised, item-number key folded). `clientPrice` is the derived
 *  USD/unit; the raw trio is retained as seed provenance (ADR-0027). */
export interface ValidatedBenchmarkItem {
  readonly country: string;
  readonly clientItemNumber: string;
  readonly clientItemNumberKey: string;
  readonly itemDescription: string;
  readonly configurationComment: string | null;
  readonly quantity: number | null;
  readonly clientSourceUnit: string | null;
  readonly sourceUnitIdentifier: string | null;
  readonly clientCategory: string | null;
  /** Free-form client offering label, kept verbatim; null when blank (#86). */
  readonly clientItemOffering: string | null;
  readonly itemSecondaryDescription: string | null;
  readonly clientSecondaryItemNumber: string | null;
  readonly requiredQuotes: number;
  /** Per-item QC Threshold as a FRACTION; null falls back to the study default. */
  readonly qcThreshold: number | null;
  /** Advisory competitor brands, ordered, blanks dropped; empty is normal. */
  readonly requiredCompetitors: readonly string[];
  /** Derived USD/unit. Null when the brief left the trio blank (ADR-0015). */
  readonly clientPrice: number | null;
  /** Raw Client Price seed provenance (ADR-0027); all null when unpriced. */
  readonly clientItemPrice: number | null;
  readonly clientItemPriceCurrency: string | null;
  readonly clientItemPriceQuantity: number | null;
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

/** Fold an item number for the upsert key: trim + collapse whitespace +
 *  lowercase (ADR-0009 — the key matches case-insensitively; first-seen casing
 *  is displayed). */
export function itemNumberKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The Benchmark Item identity, as a single collision-free string: canonical
 *  country + folded Client Item Number (ADR-0009). The one definition of the key,
 *  used both for in-file duplicate detection and the upsert resolver. */
export function benchmarkItemKey(item: {
  readonly country: string;
  readonly clientItemNumberKey: string;
}): string {
  return JSON.stringify([item.country, item.clientItemNumberKey]);
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
  const competitorColumns = mapCompetitorColumns(header);

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
    const clientItemNumber = cell("clientItemNumber");
    const clientItemNumberKey = itemNumberKey(clientItemNumber);
    const itemDescription = cell("itemDescription");
    if (country === "") fail("country", "Country is required");
    else if (canonical === null)
      fail("country", `Unknown country "${country}" — use a canonical country name`);
    if (clientItemNumber === "") fail("clientItemNumber", "Client Item Number is required");
    if (itemDescription === "") fail("itemDescription", "Item Description is required");

    // Required numeric field, with range checks.
    const requiredQuotesRaw = cell("requiredQuotes");
    const requiredQuotes = Number(requiredQuotesRaw);
    if (requiredQuotesRaw === "") fail("requiredQuotes", "Required Quotes is required");
    else if (!Number.isInteger(requiredQuotes) || requiredQuotes < 0)
      fail("requiredQuotes", "Required Quotes must be a whole number >= 0");

    // Client Price arrives as a raw trio; the derivation core enforces the
    // all-or-nothing + USD-only rules and yields both the USD/unit value and the
    // retained seed (ADR-0027). Errors map to the Client Item Price column.
    const derivation = deriveClientPrice({
      price: cell("clientItemPrice"),
      currency: cell("clientItemPriceCurrency"),
      priceQuantity: cell("clientItemPriceQuantity"),
    });
    if (!derivation.ok) fail("clientItemPrice", derivation.message);

    // Per-item QC Threshold (a FRACTION); optional, falls back to the study
    // default when blank. A present value must be a number > 0.
    const qcThresholdRaw = cell("qcThreshold");
    const qcThreshold = qcThresholdRaw === "" ? null : Number(qcThresholdRaw);
    if (qcThreshold !== null && (!Number.isFinite(qcThreshold) || qcThreshold <= 0))
      fail("qcThreshold", "Price Difference Threshold must be a fraction greater than 0 when provided");

    // Client Item Offering: optional, free-form. Kept verbatim, blank → null;
    // no enum constraint (briefs annotate it, e.g. "Standard (Premium dunkle)").
    const clientItemOffering = cell("clientItemOffering") || null;

    // Quantity is optional, but a value that IS present must be a positive whole
    // number (the client's own quantity for the part).
    const quantityRaw = cell("quantity");
    const quantity = quantityRaw === "" ? null : Number(quantityRaw);
    if (quantity !== null && (!Number.isInteger(quantity) || quantity <= 0))
      fail("quantity", "Quantity must be a whole number greater than 0 when provided");

    // Required Competitors: ordered, blanks dropped, no dedupe (advisory).
    const requiredCompetitors = competitorColumns
      .map((idx) => (row[idx] ?? "").trim())
      .filter((v) => v !== "");

    // In-file duplicate detection on the upsert key. Only meaningful once both
    // halves are present (a blank/unknown country is already its own error).
    if (canonical !== null && clientItemNumber !== "") {
      const key = benchmarkItemKey({ country: canonical, clientItemNumberKey });
      const firstRow = firstSeenAtRow.get(key);
      if (firstRow !== undefined) {
        fail("clientItemNumber", `Duplicate of row ${firstRow}: same Client Item Number + Country`);
      } else {
        firstSeenAtRow.set(key, rowNumber);
      }
    }

    items.push({
      country: canonical ?? country,
      clientItemNumber,
      clientItemNumberKey,
      itemDescription,
      configurationComment: cell("configurationComment") || null,
      quantity,
      clientSourceUnit: cell("clientSourceUnit") || null,
      sourceUnitIdentifier: cell("sourceUnitIdentifier") || null,
      clientCategory: cell("clientCategory") || null,
      clientItemOffering,
      itemSecondaryDescription: cell("itemSecondaryDescription") || null,
      clientSecondaryItemNumber: cell("clientSecondaryItemNumber") || null,
      requiredQuotes,
      qcThreshold,
      requiredCompetitors,
      clientPrice: derivation.ok ? derivation.clientPrice : null,
      clientItemPrice: derivation.ok && derivation.seed ? derivation.seed.price : null,
      clientItemPriceCurrency: derivation.ok && derivation.seed ? derivation.seed.currency : null,
      clientItemPriceQuantity: derivation.ok && derivation.seed ? derivation.seed.priceQuantity : null,
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
    const labels = [CANONICAL_HEADERS[field], ...(HEADER_ALIASES[field] ?? [])];
    for (const label of labels) {
      const idx = byLabel.get(normaliseHeader(label));
      if (idx !== undefined) {
        columnOf.set(field, idx);
        break;
      }
    }
  }
  return columnOf;
}

/** Resolve the `Required Competitor 1..N` columns to their indices, in order.
 *  Missing numbers are simply absent — the order follows N, not file position. */
function mapCompetitorColumns(header: readonly string[]): number[] {
  const byLabel = new Map<string, number>();
  header.forEach((label, idx) => byLabel.set(normaliseHeader(label), idx));

  const columns: number[] = [];
  for (let n = 1; n <= MAX_REQUIRED_COMPETITORS; n++) {
    // Accept both "Required Competitor 1" and the unspaced "Required Competitor1"
    // that client briefs emit (normaliseHeader keeps them distinct).
    const idx =
      byLabel.get(normaliseHeader(`Required Competitor ${n}`)) ??
      byLabel.get(normaliseHeader(`Required Competitor${n}`));
    if (idx !== undefined) columns.push(idx);
  }
  return columns;
}
