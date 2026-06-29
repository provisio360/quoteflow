import { describe, expect, it } from "vitest";
import {
  batchStampFields,
  discountGroup,
  landedCostGroup,
  leadTimeGroup,
  stockStatusGroup,
  warrantyGroup,
  type BatchGroupValues,
} from "./batch-line-fill";

// Batch line-fill's per-group builders (#128 / ADR-0036). A per-group apply is
// TOTAL: an empty select clears the field on every Draft line, so empty maps to
// `null` (stamp blank) — deliberately UNLIKE the single-line entry parser
// (`quote-line-form.ts`), where an empty field is `undefined` (omit, "don't touch").

// `batchStampFields` is the merge the Quote Group Collect dealer step uses to
// stamp the five groups onto EACH line at creation (ADR-0038, #141). It spreads the
// same per-group builders (so the create-time stamp can never diverge from the
// Drafts-surface panel), and includes the Landed Cost group ONLY when the document is
// cross-border — exactly as the entry form unmounts the field domestically (ADR-0035).
describe("batchStampFields", () => {
  const filled: BatchGroupValues = {
    stockStatus: "In stock",
    leadTimeValue: "3",
    leadTimeUnit: "weeks",
    warrantyOffered: "true",
    warranty1Value: "12",
    warranty1Unit: "months",
    warranty2Value: "",
    warranty2Unit: "",
    landedCostIncluded: "true",
    landedCostNote: "ships DDP",
    discountAvailable: "true",
    discountType: "Volume",
    discountApplied: "true",
    discountValue: "15",
  };

  it("cross-border: spreads all five groups (landed cost included)", () => {
    expect(batchStampFields(filled, true)).toEqual({
      stockStatus: "In stock",
      leadTimeValue: 3,
      leadTimeUnit: "weeks",
      warrantyOffered: true,
      warranty1Value: 12,
      warranty1Unit: "months",
      warranty2Value: null,
      warranty2Unit: null,
      landedCostIncluded: true,
      landedCostNote: "ships DDP",
      discountAvailable: true,
      discountType: "Volume",
      discountApplied: true,
      discountValue: 15,
    });
  });

  it("domestic: omits the Landed Cost group entirely (never stamps it)", () => {
    const stamped = batchStampFields(filled, false);
    expect(stamped).not.toHaveProperty("landedCostIncluded");
    expect(stamped).not.toHaveProperty("landedCostNote");
    // The other four groups are unaffected.
    expect(stamped.stockStatus).toBe("In stock");
    expect(stamped.discountApplied).toBe(true);
  });
});

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

// The warranty group is a CHAIN gated by Offered? (ADR-0037): Yes stamps both pairs;
// No/blank clears the gate AND all four pair fields, so a stamped "No" can never leave
// a stale warranty — regardless of any lingering panel input.
describe("warrantyGroup", () => {
  it("stamps Offered=Yes with both pairs, thousands-stripped", () => {
    expect(warrantyGroup("true", "12,000", "miles", "5", "years")).toEqual({
      warrantyOffered: true,
      warranty1Value: 12000,
      warranty1Unit: "miles",
      warranty2Value: 5,
      warranty2Unit: "years",
    });
  });

  it("stamps a half pair under Yes (stampable, caught by the submit gate)", () => {
    expect(warrantyGroup("true", "3", "", "", "")).toEqual({
      warrantyOffered: true,
      warranty1Value: 3,
      warranty1Unit: null,
      warranty2Value: null,
      warranty2Unit: null,
    });
  });

  it("Offered=No clears the gate to false and nulls all four pairs (ignores lingering input)", () => {
    expect(warrantyGroup("false", "3", "year", "5", "years")).toEqual({
      warrantyOffered: false,
      warranty1Value: null,
      warranty1Unit: null,
      warranty2Value: null,
      warranty2Unit: null,
    });
  });

  it("a blank Offered clears the whole group (gate null, pairs null)", () => {
    expect(warrantyGroup("", "3", "year", "", "")).toEqual({
      warrantyOffered: null,
      warranty1Value: null,
      warranty1Unit: null,
      warranty2Value: null,
      warranty2Unit: null,
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

// The discount group is the full gated CHAIN (#131 / ADR-0036): Available? gates
// Type + Applied?, Applied? gates the % — so a stamped chain is always coherent.
// Type rides under Available (kept even when not applied — CONTEXT), % rides under
// Applied. The % is recorded as typed (15 = 15%), never applied to the price.
describe("discountGroup", () => {
  it("stamps the full chain: Available=Yes, Type, Applied=Yes, %", () => {
    expect(discountGroup("true", "Volume", "true", "15")).toEqual({
      discountAvailable: true,
      discountType: "Volume",
      discountApplied: true,
      discountValue: 15,
    });
  });

  it("keeps Type but clears the % when Applied=No (type captured even if not applied)", () => {
    expect(discountGroup("true", "Volume", "false", "15")).toEqual({
      discountAvailable: true,
      discountType: "Volume",
      discountApplied: false,
      discountValue: null,
    });
  });

  it("keeps Available=Yes with an unanswered Applied, clearing the %", () => {
    expect(discountGroup("true", "Volume", "", "")).toEqual({
      discountAvailable: true,
      discountType: "Volume",
      discountApplied: null,
      discountValue: null,
    });
  });

  it("clears Type/% on a blank Type even with Applied=Yes", () => {
    expect(discountGroup("true", "", "true", "")).toEqual({
      discountAvailable: true,
      discountType: null,
      discountApplied: true,
      discountValue: null,
    });
  });

  it("clears the whole chain on Available=No (no stale type/applied/value)", () => {
    expect(discountGroup("false", "Volume", "true", "15")).toEqual({
      discountAvailable: false,
      discountType: null,
      discountApplied: null,
      discountValue: null,
    });
  });

  it("clears the whole chain on a blank Available (empty-is-clear)", () => {
    expect(discountGroup("", "Volume", "true", "15")).toEqual({
      discountAvailable: null,
      discountType: null,
      discountApplied: null,
      discountValue: null,
    });
  });
});
