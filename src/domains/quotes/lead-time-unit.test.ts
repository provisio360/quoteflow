import { describe, it, expect } from "vitest";
import { leadTimeUnitOptions, LEAD_TIME_UNIT_VALUES } from "./lead-time-unit";

// Shipping Lead Time is a value + unit pair (ADR-0035). Its unit picker mirrors the
// warranty picker's forward-tolerance — a legacy free-text unit round-trips an edit
// rather than being rejected — but carries shipping-oriented vocabulary.

describe("leadTimeUnitOptions", () => {
  it("offers exactly the canonical units when there is no prefilled value", () => {
    expect(leadTimeUnitOptions(null).map((o) => o.value)).toEqual([...LEAD_TIME_UNIT_VALUES]);
  });

  it("does not inject a duplicate when the prefilled value is already canonical", () => {
    expect(leadTimeUnitOptions("weeks").map((o) => o.value)).toEqual([...LEAD_TIME_UNIT_VALUES]);
  });

  it("trims surrounding whitespace before matching so a padded canonical value is not duplicated", () => {
    expect(leadTimeUnitOptions("days ").map((o) => o.value)).toEqual([...LEAD_TIME_UNIT_VALUES]);
  });

  it("prepends a legacy free-text unit as a selectable option so an edit round-trips it", () => {
    const opts = leadTimeUnitOptions("business days");
    expect(opts[0]).toEqual({ value: "business days", label: "business days" });
    expect(opts.map((o) => o.value)).toEqual(["business days", ...LEAD_TIME_UNIT_VALUES]);
  });
});
