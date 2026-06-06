// Pure decision core — no framework, DB, or network imports.
//
// The Competitor Price Range (issue #14 / ADR-0017): the min / median / max
// USD-price-per-unit across a Benchmark Item's released + approved Quotes. The
// released/approved/tenant gating, and the Decimal↔number marshalling, live in
// the thin adapter (src/lib/analytics); this core is pure arithmetic over plain
// numbers, exhaustively unit-testable (the issue's "unit-tested where pure" AC).

/** The competitive spread for one Benchmark Item (CONTEXT.md: Competitor Price
 *  Range). `hasData: false` is the explicit no-data result — distinct from zeros
 *  — for an item left with no usable data points (mirrors PriceFlagResult's
 *  `comparable: false`). min/max are exact data points; median is rounded. */
export type PriceRange =
  | { readonly hasData: false }
  | {
      readonly hasData: true;
      readonly min: number;
      readonly max: number;
      readonly median: number;
      readonly count: number;
    };

/**
 * Aggregate a Benchmark Item's USD-price-per-unit data points into its range. A
 * `null` point (a released+approved quote with no per-unit figure) is excluded;
 * if nothing usable remains the result is `{ hasData: false }`. The median is
 * the mean of the middle pair for an even-sized population, rounded to 4 dp to
 * match the schema's Decimal(14,4) scale; min and max are exact.
 */
export function priceRange(pointsUsdPerUnit: readonly (number | null)[]): PriceRange {
  const points = pointsUsdPerUnit
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b);
  if (points.length === 0) return { hasData: false };
  const mid = Math.floor(points.length / 2);
  const median =
    points.length % 2 === 1
      ? points[mid]
      : roundTo4(points[mid - 1] + points[mid], 2);
  return {
    hasData: true,
    min: points[0],
    max: points[points.length - 1],
    median,
    count: points.length,
  };
}

/** View D's internal benchmark comparison (CONTEXT.md: Competitor Price Range;
 *  ADR-0017). `comparable: false` when there is nothing to compare against —
 *  either the item has no data points or no Client Price set (the latter mirrors
 *  the *not comparable* case of PriceFlagResult, ADR-0015). Otherwise it carries
 *  the Client Price; positioning it against the range is the UI's job. */
export type BenchmarkComparison =
  | { readonly comparable: false }
  | { readonly comparable: true; readonly clientPrice: number };

/**
 * Compare a Benchmark Item's [[Client Price]] against its Competitor Price Range
 * for the internal-only View D. Not comparable when the range has no data or the
 * item has no Client Price; otherwise the Client Price is carried through for the
 * analyst to read beside min/median/max. Internal only — this value is never in
 * a client-facing read (ADR-0003).
 */
export function compareToBenchmark(
  range: PriceRange,
  clientPrice: number | null,
): BenchmarkComparison {
  if (!range.hasData || clientPrice === null) return { comparable: false };
  return { comparable: true, clientPrice };
}

/** Round `sum / divisor` half-up to 4 dp — the schema's Decimal(14,4) scale. The
 *  epsilon nudge keeps a true ".xxxx5" (e.g. 1.000055) from rounding down on its
 *  binary-float under-representation. */
function roundTo4(sum: number, divisor: number): number {
  const value = sum / divisor;
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4;
}
