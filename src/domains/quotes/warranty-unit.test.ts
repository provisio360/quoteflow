import { describe, it, expect } from "vitest";
import { warrantyUnitOptions, WARRANTY_UNIT_VALUES } from "./warranty-unit";

describe("warrantyUnitOptions", () => {
  it("offers exactly the canonical units when there is no prefilled value", () => {
    const opts = warrantyUnitOptions(null);
    expect(opts.map((o) => o.value)).toEqual([...WARRANTY_UNIT_VALUES]);
  });

  it("does not inject a duplicate when the prefilled value is already canonical", () => {
    const opts = warrantyUnitOptions("year");
    expect(opts.map((o) => o.value)).toEqual([...WARRANTY_UNIT_VALUES]);
  });

  it("trims surrounding whitespace before matching so a padded canonical value is not duplicated", () => {
    const opts = warrantyUnitOptions("hours ");
    expect(opts.map((o) => o.value)).toEqual([...WARRANTY_UNIT_VALUES]);
  });

  it("prepends a legacy free-text unit as a selectable option so an edit round-trips it", () => {
    const opts = warrantyUnitOptions("km");
    expect(opts[0]).toEqual({ value: "km", label: "km" });
    expect(opts.map((o) => o.value)).toEqual(["km", ...WARRANTY_UNIT_VALUES]);
  });
});
