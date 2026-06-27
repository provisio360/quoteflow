import { describe, expect, it } from "vitest";
import { stockStatusGroup } from "./batch-line-fill";

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
