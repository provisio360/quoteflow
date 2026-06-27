import { describe, expect, it } from "vitest";
import {
  landedCostGroup,
  leadTimeGroup,
  stockStatusGroup,
  warranty1Group,
  warranty2Group,
} from "./batch-line-fill";

// Batch line-fill's per-group builders (#128 / ADR-0036). A per-group apply is
// TOTAL: an empty select clears the field on every Draft line, so empty maps to
// `null` (stamp blank) — deliberately UNLIKE the single-line entry parser
// (`quote-line-form.ts`), where an empty field is `undefined` (omit, "don't touch").

describe("stockStatusGroup", () => {
  it("carries a chosen value through", () => {
    expect(stockStatusGroup("Out of stock")).toEqual({ stockStatus: "Out of stock" });
  });

  it("maps an empty selection to null (stamp blank / clear-all)", () => {
    expect(stockStatusGroup("")).toEqual({ stockStatus: null });
  });
});

describe("leadTimeGroup", () => {
  it("carries a value + unit pair through", () => {
    expect(leadTimeGroup("3", "weeks")).toEqual({
      leadTimeValue: 3,
      leadTimeUnit: "weeks",
    });
  });

  it("strips thousands grouping from the value", () => {
    expect(leadTimeGroup("1,200", "days")).toEqual({
      leadTimeValue: 1200,
      leadTimeUnit: "days",
    });
  });

  it("clears each half independently — a half-pair (value, no unit) is stampable", () => {
    expect(leadTimeGroup("3", "")).toEqual({ leadTimeValue: 3, leadTimeUnit: null });
  });

  it("clears each half independently — a half-pair (unit, no value)", () => {
    expect(leadTimeGroup("", "weeks")).toEqual({ leadTimeValue: null, leadTimeUnit: "weeks" });
  });

  it("maps a fully-empty pair to null/null (clear-all)", () => {
    expect(leadTimeGroup("", "")).toEqual({ leadTimeValue: null, leadTimeUnit: null });
  });
});

describe("warranty1Group", () => {
  it("stamps its own warranty-1 keys, thousands-stripped", () => {
    expect(warranty1Group("12,000", "miles")).toEqual({
      warranty1Value: 12000,
      warranty1Unit: "miles",
    });
  });

  it("clears its own keys on a fully-empty pair", () => {
    expect(warranty1Group("", "")).toEqual({ warranty1Value: null, warranty1Unit: null });
  });
});

describe("warranty2Group", () => {
  it("stamps its own warranty-2 keys", () => {
    expect(warranty2Group("5", "years")).toEqual({
      warranty2Value: 5,
      warranty2Unit: "years",
    });
  });
});

// The landed-cost group is a CHAIN (ADR-0036): Included? gates the Note, so a stamped
// chain is always coherent — the Note is kept only when Included? = Yes, cleared
// otherwise, regardless of any lingering note text (#130 / ADR-0035).
describe("landedCostGroup", () => {
  it("stamps Yes + note as a coherent pair", () => {
    expect(landedCostGroup("true", "ships DDP")).toEqual({
      landedCostIncluded: true,
      landedCostNote: "ships DDP",
    });
  });

  it("drops the note on No, carrying no stale text", () => {
    expect(landedCostGroup("false", "ships DDP")).toEqual({
      landedCostIncluded: false,
      landedCostNote: null,
    });
  });

  it("keeps Yes but clears an empty note", () => {
    expect(landedCostGroup("true", "")).toEqual({
      landedCostIncluded: true,
      landedCostNote: null,
    });
  });

  it("clears the whole group on a blank Included? (empty-is-clear)", () => {
    expect(landedCostGroup("", "ignored")).toEqual({
      landedCostIncluded: null,
      landedCostNote: null,
    });
  });
});
