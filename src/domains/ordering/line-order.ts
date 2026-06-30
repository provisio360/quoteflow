// Pure decision core — no framework, DB, or network imports.
//
// The catalog order Quote Lines are listed in (ADR-0040, superseding ADR-0029's
// row-order clause): document-major and alphabetical —
//
//   Market → Market Quote Number → Client Source Unit (A→Z, nulls last)
//          → Client Item Number (A→Z)
//
// "Quote group" in the ordering means the Market Quote, keyed on its stored,
// monotonic-per-(study, country) Market Quote Number — never the transient
// Quote-Group collection lens, which is not persisted. Within one document there
// is exactly one line per Benchmark Item, so (Market Quote Number, Client Item
// Number) is already unique per market — the order is total, no tiebreaker needed.
//
// Strings sort by code-unit comparison (A→Z / 0→9), NOT numeric value: the item
// numbers are alphanumeric (e.g. "BRC8T450X") with no numeric interpretation. The
// comparison is locale-independent so the order is identical across environments.
// Each comparator is a stable refinement: callers may rely on Array.prototype.sort
// being stable, so lines equal on every key keep their input order.

/** The minimal shape the full catalog order reads. Export rows and any line view
 *  can be narrowed to this. */
export interface CatalogOrderKey {
  readonly market: string;
  readonly marketQuoteNumber: number;
  readonly clientSourceUnit: string | null;
  readonly clientItemNumber: string;
}

/** Code-unit string compare (A→Z / 0→9), deterministic across locales. */
function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Client Source Unit order: named units A→Z, then the unnamed (null) ones last. */
function compareSourceUnit(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1; // a is unnamed → after b
  if (b === null) return -1; // b is unnamed → after a
  return compareString(a, b);
}

/** The within-a-document order: Client Source Unit (A→Z, nulls last) → Client Item
 *  Number (A→Z). Used where Market and Market Quote Number are already constant —
 *  the lines of one dealer document, or a part listing under one country. */
export function compareBySourceUnitThenItem(
  a: Pick<CatalogOrderKey, "clientSourceUnit" | "clientItemNumber">,
  b: Pick<CatalogOrderKey, "clientSourceUnit" | "clientItemNumber">,
): number {
  return (
    compareSourceUnit(a.clientSourceUnit, b.clientSourceUnit) ||
    compareString(a.clientItemNumber, b.clientItemNumber)
  );
}

/** The full catalog order across a study's lines: Market → Market Quote Number →
 *  Client Source Unit (A→Z, nulls last) → Client Item Number (A→Z). */
export function compareCatalogOrder(
  a: CatalogOrderKey,
  b: CatalogOrderKey,
): number {
  return (
    compareString(a.market, b.market) ||
    a.marketQuoteNumber - b.marketQuoteNumber ||
    compareBySourceUnitThenItem(a, b)
  );
}
