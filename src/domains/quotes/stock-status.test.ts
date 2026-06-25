import { describe, it, expect } from "vitest";
import { stockStatusOptions, STOCK_STATUS_VALUES } from "./stock-status";

describe("stockStatusOptions", () => {
  it("offers exactly the two canonical values when there is no prefilled value", () => {
    const opts = stockStatusOptions(null);
    expect(opts.map((o) => o.value)).toEqual([...STOCK_STATUS_VALUES]);
  });

  it("does not inject a duplicate when the prefilled value is already canonical", () => {
    const opts = stockStatusOptions("Out of stock");
    expect(opts.map((o) => o.value)).toEqual([...STOCK_STATUS_VALUES]);
  });

  it("trims surrounding whitespace before matching so a padded canonical value is not duplicated", () => {
    const opts = stockStatusOptions("In stock ");
    expect(opts.map((o) => o.value)).toEqual([...STOCK_STATUS_VALUES]);
  });

  it("prepends a legacy free-text value as a selectable option so an edit round-trips it", () => {
    const opts = stockStatusOptions("Low stock");
    expect(opts[0]).toEqual({ value: "Low stock", label: "Low stock" });
    expect(opts.map((o) => o.value)).toEqual(["Low stock", ...STOCK_STATUS_VALUES]);
  });
});
