import { describe, it, expect } from "vitest";
import { peerSpreadFlag, peerMedian } from "./peer-spread-flag";

// The Researcher's live peer-spread nudge (ADR-0042). The new line's live
// USD-per-unit is compared to the PEER MEDIAN (other dealers' converted lines for
// the same Benchmark Item) via the SAME symmetric relative difference the analyst
// QC flag uses (reusing the study's QC Threshold fraction), but anchored to the
// market, never the Client Price. Direction reads higher/lower THAN THE OTHER
// DEALERS. Silent (no market defined) when there are fewer than 2 peers (median
// null) or no live USD on the new line. A soft nudge — never a gate (ADR-0042).

describe("peerSpreadFlag", () => {
  it("flags a live quote well above the peer median (direction higher)", () => {
    // 150 vs median 100: diff = 50 / 125 = 0.40 > 0.25.
    expect(
      peerSpreadFlag({ liveUsdPerUnit: 150, peerMedianUsdPerUnit: 100, threshold: 0.25 }),
    ).toEqual({ silent: false, flagged: true, direction: "higher", relativeDiff: 0.4, percentDiff: 40 });
  });

  it("flags a live quote well below the peer median (direction lower)", () => {
    // 60 vs median 100: diff = 40 / 80 = 0.50 > 0.25.
    expect(
      peerSpreadFlag({ liveUsdPerUnit: 60, peerMedianUsdPerUnit: 100, threshold: 0.25 }),
    ).toEqual({ silent: false, flagged: true, direction: "lower", relativeDiff: 0.5, percentDiff: 50 });
  });

  it("does not flag a live quote within the threshold of the peer median", () => {
    // 110 vs median 100: diff ≈ 0.0952 < 0.25 — in the pack, no nudge.
    expect(
      peerSpreadFlag({ liveUsdPerUnit: 110, peerMedianUsdPerUnit: 100, threshold: 0.25 }),
    ).toEqual({
      silent: false,
      flagged: false,
      direction: "higher",
      relativeDiff: expect.closeTo(0.0952, 3),
      percentDiff: expect.closeTo(9.5238, 3),
    });
  });

  it("does not flag exactly at the threshold (strict exceed, matching the QC flag)", () => {
    // 150 vs 100 gives relativeDiff = 50/125 = 0.4 exactly; a threshold OF 0.4 is
    // not exceeded (strict `>`), so the line is not flagged.
    const exact = peerSpreadFlag({ liveUsdPerUnit: 150, peerMedianUsdPerUnit: 100, threshold: 0.4 });
    expect(exact).toMatchObject({ silent: false, flagged: false, relativeDiff: 0.4 });
  });

  it("is silent when the new line has no live USD (rate miss / incomplete entry)", () => {
    expect(
      peerSpreadFlag({ liveUsdPerUnit: null, peerMedianUsdPerUnit: 100, threshold: 0.25 }),
    ).toEqual({ silent: true });
  });

  it("is silent when there are fewer than 2 converted peers (median null) — first quote never flags", () => {
    expect(
      peerSpreadFlag({ liveUsdPerUnit: 150, peerMedianUsdPerUnit: null, threshold: 0.25 }),
    ).toEqual({ silent: true });
  });
});

describe("peerMedian", () => {
  it("is null with no peers (n=0) — no market defined", () => {
    expect(peerMedian([])).toBeNull();
  });

  it("is null with a single peer (n=1) — one point is not a spread", () => {
    expect(peerMedian([100])).toBeNull();
  });

  it("averages the middle pair for an even population (n=2)", () => {
    expect(peerMedian([80, 120])).toBe(100);
  });

  it("takes the middle value for an odd population, order-independent", () => {
    expect(peerMedian([110, 90, 100])).toBe(100);
  });
});
