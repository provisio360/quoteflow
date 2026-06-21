import { describe, it, expect } from "vitest";
import { resolveQcThreshold } from "./qc-threshold";

// The per-item QC Threshold with study-default fallback (#86 / ADR-0014 amended).
// Both values are FRACTIONS (CONTEXT.md: QC Threshold); the per-item value only
// overrides the study default when present.

describe("resolveQcThreshold", () => {
  it("uses the per-item threshold when the item sets one", () => {
    expect(resolveQcThreshold(0.1, 0.25)).toBe(0.1);
  });

  it("falls back to the study default when the item has none", () => {
    expect(resolveQcThreshold(null, 0.25)).toBe(0.25);
  });

  it("treats a per-item value of zero as a real override, not absence", () => {
    expect(resolveQcThreshold(0, 0.25)).toBe(0);
  });
});
