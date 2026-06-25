import { describe, it, expect } from "vitest";
import { landedCostApplies } from "./landed-cost";

// Landed Cost is only relevant when the part crosses a border to reach the market
// (ADR-0035): the Dealer Country differs from the market Country. The decision is
// the single source of truth for both the entry form's visibility and the submit
// gate, so it lives in one tested pure function.

describe("landedCostApplies", () => {
  it("applies when the Dealer Country differs from the market Country", () => {
    expect(landedCostApplies("Germany", "France")).toBe(true);
  });

  it("does not apply when the Dealer Country matches the market Country (domestic)", () => {
    expect(landedCostApplies("France", "France")).toBe(false);
  });

  it("does not apply until a real Dealer Country is chosen (blank dealer)", () => {
    expect(landedCostApplies("", "France")).toBe(false);
    expect(landedCostApplies(null, "France")).toBe(false);
  });

  it("does not apply when the market Country is unknown", () => {
    expect(landedCostApplies("Germany", "")).toBe(false);
    expect(landedCostApplies("Germany", null)).toBe(false);
  });
});
