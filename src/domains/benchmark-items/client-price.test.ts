import { describe, it, expect } from "vitest";
import { parseClientPrice } from "./client-price";

// The analyst's in-app Client Price edit (issue #12 / ADR-0015): a positive
// USD/unit value, or blank to CLEAR it back to "unpriced" (null). Pure so the
// rule is testable without a form or a database; the same rule guards the action.

describe("parseClientPrice", () => {
  it("accepts a positive number", () => {
    expect(parseClientPrice("1250.50")).toEqual({ ok: true, value: 1250.5 });
  });

  it("treats a blank value as a clear (null), so the item becomes unpriced", () => {
    expect(parseClientPrice("")).toEqual({ ok: true, value: null });
  });

  it("treats whitespace as a clear (null)", () => {
    expect(parseClientPrice("   ")).toEqual({ ok: true, value: null });
  });

  it.each(["0", "-5", "abc"])("rejects a present but non-positive value %s", (raw) => {
    const result = parseClientPrice(raw);
    expect(result.ok).toBe(false);
  });
});
