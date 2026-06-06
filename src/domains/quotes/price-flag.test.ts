import { describe, it, expect } from "vitest";
import { evaluatePriceFlag } from "./price-flag";

// The QC out-of-range flag (ADR-0014). A converted Quote's USD price-per-unit is
// compared to its Benchmark Item's Client Price via the symmetric relative
// percent difference; a divergence beyond the study's QC Threshold flags it.

describe("evaluatePriceFlag", () => {
  it("does not flag a quote within the threshold of the Client Price", () => {
    // 110 vs 100: percent_diff = |110-100| / ((110+100)/2) * 100 ≈ 9.52% < 25%.
    expect(
      evaluatePriceFlag({ usdPricePerUnit: 110, clientPrice: 100, thresholdPct: 25 }),
    ).toEqual({ comparable: true, flagged: false, direction: "above", percentDiff: expect.closeTo(9.5238, 3) });
  });

  it("flags a quote dearer than the benchmark beyond the threshold (direction above)", () => {
    // 150 vs 100: percent_diff = 50 / 125 * 100 = 40% > 25%.
    expect(
      evaluatePriceFlag({ usdPricePerUnit: 150, clientPrice: 100, thresholdPct: 25 }),
    ).toEqual({ comparable: true, flagged: true, direction: "above", percentDiff: 40 });
  });

  it("flags a quote cheaper than the benchmark beyond the threshold (direction below)", () => {
    // 60 vs 100: percent_diff = 40 / 80 * 100 = 50% > 25%.
    expect(
      evaluatePriceFlag({ usdPricePerUnit: 60, clientPrice: 100, thresholdPct: 25 }),
    ).toEqual({ comparable: true, flagged: true, direction: "below", percentDiff: 50 });
  });

  it("is not comparable when the quote has no USD price-per-unit (pending/unconverted)", () => {
    expect(
      evaluatePriceFlag({ usdPricePerUnit: null, clientPrice: 100, thresholdPct: 25 }),
    ).toEqual({ comparable: false });
  });

  it("does not flag a quote exactly at the threshold (boundary is inclusive)", () => {
    // Choose a = 100, b = 60: percent_diff = 40 / 80 * 100 = 50%, threshold = 50%.
    expect(
      evaluatePriceFlag({ usdPricePerUnit: 100, clientPrice: 60, thresholdPct: 50 }),
    ).toEqual({ comparable: true, flagged: false, direction: "above", percentDiff: 50 });
  });
});
