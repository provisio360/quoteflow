import { describe, it, expect } from "vitest";
import { evaluatePriceFlag, isLineFlagged } from "./price-flag";

// The QC out-of-range flag (ADR-0014). A converted Quote's USD price-per-unit is
// compared to its Benchmark Item's Client Price via the symmetric relative
// difference; a divergence beyond the QC Threshold (a FRACTION, e.g. 0.25 = 25%)
// flags it. The threshold is a fraction at every layer (CONTEXT.md: QC Threshold).

describe("evaluatePriceFlag", () => {
  it("does not flag a quote within the threshold of the Client Price", () => {
    // 110 vs 100: diff = |110-100| / ((110+100)/2) ≈ 0.0952 < 0.25.
    expect(
      evaluatePriceFlag({ usdPricePerUnit: 110, clientPrice: 100, threshold: 0.25 }),
    ).toEqual({ comparable: true, flagged: false, direction: "above", relativeDiff: expect.closeTo(0.0952, 3), percentDiff: expect.closeTo(9.5238, 3) });
  });

  it("flags a quote dearer than the benchmark beyond the threshold (direction above)", () => {
    // 150 vs 100: diff = 50 / 125 = 0.40 > 0.25.
    expect(
      evaluatePriceFlag({ usdPricePerUnit: 150, clientPrice: 100, threshold: 0.25 }),
    ).toEqual({ comparable: true, flagged: true, direction: "above", relativeDiff: 0.4, percentDiff: 40 });
  });

  it("flags a quote cheaper than the benchmark beyond the threshold (direction below)", () => {
    // 60 vs 100: diff = 40 / 80 = 0.50 > 0.25.
    expect(
      evaluatePriceFlag({ usdPricePerUnit: 60, clientPrice: 100, threshold: 0.25 }),
    ).toEqual({ comparable: true, flagged: true, direction: "below", relativeDiff: 0.5, percentDiff: 50 });
  });

  it("is not comparable when the quote has no USD price-per-unit (pending/unconverted)", () => {
    expect(
      evaluatePriceFlag({ usdPricePerUnit: null, clientPrice: 100, threshold: 0.25 }),
    ).toEqual({ comparable: false });
  });

  it("is not comparable when the Benchmark Item has no Client Price (unset, ADR-0015)", () => {
    expect(
      evaluatePriceFlag({ usdPricePerUnit: 110, clientPrice: null, threshold: 0.25 }),
    ).toEqual({ comparable: false });
  });

  it("does not flag a quote exactly at the threshold (boundary is inclusive)", () => {
    // Choose a = 100, b = 60: diff = 40 / 80 = 0.50, threshold = 0.50.
    expect(
      evaluatePriceFlag({ usdPricePerUnit: 100, clientPrice: 60, threshold: 0.5 }),
    ).toEqual({ comparable: true, flagged: false, direction: "above", relativeDiff: 0.5, percentDiff: 50 });
  });
});

// The single boolean the rest of the app keys off a Quote Line — collapsing the
// "comparable AND flagged" question and resolving the per-item/study threshold in
// one place (ADR-0014). The Justification gate (approve) and the researcher's
// Justification field (edit) both read exactly this.
describe("isLineFlagged", () => {
  it("flags a line whose USD price-per-unit diverges beyond the resolved threshold", () => {
    // 150 vs 100 ⇒ symmetric diff 0.40 > study default 0.25.
    expect(
      isLineFlagged({ usdPricePerUnit: 150, clientPrice: 100, itemThreshold: null, studyThreshold: 0.25 }),
    ).toBe(true);
  });

  it("never flags a not-yet-converted (pending) line", () => {
    expect(
      isLineFlagged({ usdPricePerUnit: null, clientPrice: 100, itemThreshold: null, studyThreshold: 0.25 }),
    ).toBe(false);
  });

  it("never flags a line whose item has no Client Price", () => {
    expect(
      isLineFlagged({ usdPricePerUnit: 150, clientPrice: null, itemThreshold: null, studyThreshold: 0.25 }),
    ).toBe(false);
  });

  it("resolves the per-item threshold over the study default", () => {
    // 130 vs 100 ⇒ diff ≈ 0.26: inside the study default 0.40, outside the tight
    // per-item 0.05 ⇒ flagged only because the item threshold won.
    expect(
      isLineFlagged({ usdPricePerUnit: 130, clientPrice: 100, itemThreshold: 0.05, studyThreshold: 0.4 }),
    ).toBe(true);
  });
});
