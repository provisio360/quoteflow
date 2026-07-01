import { describe, it, expect } from "vitest";
import { decimalSlip, quantityPlausible } from "./mechanical-checks";

// The entry-time mechanical sanity checks (issue #163 / ADR-0042) — benchmark-free
// fat-finger catches that fire independently of the peer-spread flag, even at n=0
// peers. Both are pure and advisory (a soft nudge, never a gate).

// decimalSlip: within the SAME Market Quote document, compare the new line's live
// USD-per-unit against the median USD-per-unit of the OTHER lines on that document
// (Q1: USD-per-unit normalises across the document's differently-priced items). Fire
// when the new line is >=10x or <=0.1x that median — a likely decimal slip. Silent
// on the document's first line (no siblings) or with no live USD.
describe("decimalSlip", () => {
  it("fires when the new line is 10x the median of the document's other lines", () => {
    // siblings median = 100; new line 1000 → ratio 10 → slip (direction higher).
    expect(
      decimalSlip({ liveUsdPerUnit: 1000, siblingUsdPerUnit: [90, 100, 110] }),
    ).toEqual({ silent: false, flagged: true, ratio: 10, direction: "higher" });
  });

  it("fires when the new line is a tenth of the median (dropped decimal, direction lower)", () => {
    // siblings median = 100; new line 10 → ratio 0.1 → slip.
    expect(
      decimalSlip({ liveUsdPerUnit: 10, siblingUsdPerUnit: [90, 100, 110] }),
    ).toEqual({ silent: false, flagged: true, ratio: 0.1, direction: "lower" });
  });

  it("does not fire for a line in the same order of magnitude as its siblings", () => {
    // 250 vs median 100 → ratio 2.5, well inside the 10x band — not a decimal slip.
    expect(
      decimalSlip({ liveUsdPerUnit: 250, siblingUsdPerUnit: [90, 100, 110] }),
    ).toEqual({ silent: false, flagged: false, ratio: 2.5, direction: "higher" });
  });

  it("is silent on the document's first line (no siblings with a USD)", () => {
    expect(decimalSlip({ liveUsdPerUnit: 1000, siblingUsdPerUnit: [] })).toEqual({ silent: true });
    expect(decimalSlip({ liveUsdPerUnit: 1000, siblingUsdPerUnit: [null, null] })).toEqual({ silent: true });
  });

  it("is silent when the new line has no live USD", () => {
    expect(decimalSlip({ liveUsdPerUnit: null, siblingUsdPerUnit: [100] })).toEqual({ silent: true });
  });
});

describe("quantityPlausible", () => {
  it("accepts a positive quantity", () => {
    expect(quantityPlausible(12)).toBe(true);
  });

  it("rejects zero, negative, null, and non-finite quantities", () => {
    expect(quantityPlausible(0)).toBe(false);
    expect(quantityPlausible(-3)).toBe(false);
    expect(quantityPlausible(null)).toBe(false);
    expect(quantityPlausible(Number.NaN)).toBe(false);
  });
});
