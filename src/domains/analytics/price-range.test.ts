import { describe, it, expect } from "vitest";
import { priceRange, compareToBenchmark } from "./price-range";

// The Competitor Price Range (issue #14 / ADR-0017). A pure aggregation over a
// Benchmark Item's released + approved USD-price-per-unit data points: min /
// median / max, with null points excluded and an empty population yielding an
// explicit no-data result. The released/approved/tenant gating lives in the I/O
// adapter (src/lib/analytics); this core is just the maths, exhaustively tested.

describe("priceRange", () => {
  it("reports a single data point as its own min, median, and max", () => {
    expect(priceRange([42.5])).toEqual({
      hasData: true,
      min: 42.5,
      max: 42.5,
      median: 42.5,
      count: 1,
    });
  });

  it("sorts an unordered odd-sized population and takes the middle as the median", () => {
    expect(priceRange([30, 10, 20])).toEqual({
      hasData: true,
      min: 10,
      max: 30,
      median: 20,
      count: 3,
    });
  });

  it("takes the mean of the middle pair as the median for an even-sized population", () => {
    // Sorted [10, 20, 30, 40] → middle pair (20, 30) → median 25.
    expect(priceRange([40, 10, 30, 20])).toEqual({
      hasData: true,
      min: 10,
      max: 40,
      median: 25,
      count: 4,
    });
  });

  it("excludes null data points (a released+approved quote with no per-unit figure)", () => {
    // Only 10 and 30 count; the nulls are dropped before aggregating.
    expect(priceRange([10, null, 30, null])).toEqual({
      hasData: true,
      min: 10,
      max: 30,
      median: 20,
      count: 2,
    });
  });

  it("yields an explicit no-data result for an empty population", () => {
    expect(priceRange([])).toEqual({ hasData: false });
  });

  it("yields no-data when every point is null (item released with no usable quotes)", () => {
    expect(priceRange([null, null])).toEqual({ hasData: false });
  });

  it("rounds the median to 4 dp to match the Decimal(14,4) scale; min/max stay exact", () => {
    // Middle pair (100.00001, 100.00002) → mean 100.000015 → 4 dp 100.0000 (round half up
    // on the 5th decimal: ...15 → the 4th-dp digit stays 0). min/max are returned verbatim.
    expect(priceRange([100.00001, 100.00002])).toEqual({
      hasData: true,
      min: 100.00001,
      max: 100.00002,
      median: 100.0,
      count: 2,
    });
  });

  it("rounds a median half-up at the 4th decimal place", () => {
    // Middle pair (1.00005, 1.00006) → mean 1.000055 → 4 dp 1.0001 (round half up).
    const result = priceRange([1.00006, 1.00005]);
    expect(result).toMatchObject({ hasData: true, median: 1.0001 });
  });
});

// View D's internal comparison (ADR-0017): the only thing the internal view adds
// over the client views is the Client Price beside the range. The core just
// reports whether the comparison is possible and carries the value; the UI does
// the positioning against min/median/max.

describe("compareToBenchmark", () => {
  it("carries the Client Price when the item has both a range and a Client Price", () => {
    const range = priceRange([10, 30]);
    expect(compareToBenchmark(range, 100)).toEqual({
      comparable: true,
      clientPrice: 100,
    });
  });

  it("is not comparable when the item has no Client Price (unset, ADR-0015)", () => {
    expect(compareToBenchmark(priceRange([10, 30]), null)).toEqual({
      comparable: false,
    });
  });

  it("is not comparable when the item has no data points, even with a Client Price", () => {
    expect(compareToBenchmark(priceRange([]), 100)).toEqual({
      comparable: false,
    });
  });
});
