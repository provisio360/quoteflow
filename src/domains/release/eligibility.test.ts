import { describe, it, expect } from "vitest";
import { evaluateRelease } from "./eligibility";

// The Country Release Eligibility gate (issue #13 / ADR-0016). A pure judgement
// over per-item counts: a Country is releasable only when EVERY Benchmark Item
// has at least its Required Quotes approved AND no item has an in-flight
// (Draft/Submitted) quote. A Rejected quote is not in-flight and never blocks.

describe("evaluateRelease", () => {
  it("is releasable when every item meets Required Quotes and none are in-flight", () => {
    expect(
      evaluateRelease([
        { requiredQuotes: 2, approvedCount: 2, inFlightCount: 0 },
        { requiredQuotes: 1, approvedCount: 3, inFlightCount: 0 },
      ]),
    ).toEqual({ releasable: true });
  });

  it("is not releasable when an item has fewer approved than Required, counting it short", () => {
    expect(
      evaluateRelease([
        { requiredQuotes: 2, approvedCount: 1, inFlightCount: 0 },
        { requiredQuotes: 1, approvedCount: 1, inFlightCount: 0 },
      ]),
    ).toEqual({ releasable: false, reasons: { shortItems: 1, inFlightItems: 0 } });
  });

  it("is not releasable when an item has an in-flight (Draft/Submitted) quote", () => {
    // Required is met (1 approved ≥ 1), but one quote is still in flight.
    expect(
      evaluateRelease([{ requiredQuotes: 1, approvedCount: 1, inFlightCount: 1 }]),
    ).toEqual({ releasable: false, reasons: { shortItems: 0, inFlightItems: 1 } });
  });

  it("treats an item that requires zero quotes with none approved as satisfied", () => {
    // Required Quotes may be zero (CONTEXT.md): 0 approved ≥ 0 required.
    expect(
      evaluateRelease([{ requiredQuotes: 0, approvedCount: 0, inFlightCount: 0 }]),
    ).toEqual({ releasable: true });
  });

  it("is not releasable for a Country with no Benchmark Items", () => {
    // Releasing nothing is meaningless (ADR-0016) — no complaints, still false.
    expect(evaluateRelease([])).toEqual({
      releasable: false,
      reasons: { shortItems: 0, inFlightItems: 0 },
    });
  });

  it("aggregates multiple blockers across items (an item can be both short and in-flight)", () => {
    expect(
      evaluateRelease([
        { requiredQuotes: 2, approvedCount: 0, inFlightCount: 2 }, // short AND in-flight
        { requiredQuotes: 1, approvedCount: 0, inFlightCount: 0 }, // short only
        { requiredQuotes: 1, approvedCount: 1, inFlightCount: 1 }, // in-flight only
      ]),
    ).toEqual({ releasable: false, reasons: { shortItems: 2, inFlightItems: 2 } });
  });
});
