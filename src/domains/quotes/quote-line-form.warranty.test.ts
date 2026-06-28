import { describe, expect, it } from "vitest";
import { lineFieldsFromForm } from "./quote-line-form";

// The researcher's Warranty chain (Warranty Offered? → up to two value+unit pairs).
// Offered is required to submit; the pairs render only under Yes, so a No/blank answer
// posts no pair keys. Unlike the discount chain, the parser CLEARS the pairs to null
// when Offered is not Yes (not undefined) so a No/blank can never leave a stale warranty
// on the line (ADR-0037).

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("lineFieldsFromForm — warranty chain", () => {
  it("records Offered=Yes with both pairs, thousands-stripped", () => {
    const fields = lineFieldsFromForm(
      form({
        warrantyOffered: "true",
        warranty1Value: "12,000",
        warranty1Unit: "miles",
        warranty2Value: "5",
        warranty2Unit: "year",
      }),
    );
    expect(fields.warrantyOffered).toBe(true);
    expect(fields.warranty1Value).toBe(12000);
    expect(fields.warranty1Unit).toBe("miles");
    expect(fields.warranty2Value).toBe(5);
    expect(fields.warranty2Unit).toBe("year");
  });

  it("Offered=Yes keeps a half pair (caught later at submit)", () => {
    const fields = lineFieldsFromForm(form({ warrantyOffered: "true", warranty1Value: "3" }));
    expect(fields.warrantyOffered).toBe(true);
    expect(fields.warranty1Value).toBe(3);
    expect(fields.warranty1Unit).toBeUndefined();
  });

  it("Offered=No records false and CLEARS all four pairs to null", () => {
    // Even if stale values somehow reach the parser, a No answer nulls them so the DB
    // never carries a "No" line with a residual warranty.
    const fields = lineFieldsFromForm(
      form({ warrantyOffered: "false", warranty1Value: "3", warranty1Unit: "year" }),
    );
    expect(fields.warrantyOffered).toBe(false);
    expect(fields.warranty1Value).toBeNull();
    expect(fields.warranty1Unit).toBeNull();
    expect(fields.warranty2Value).toBeNull();
    expect(fields.warranty2Unit).toBeNull();
  });

  it("a blank/unanswered Offered posts no flag (undefined) and clears the pairs", () => {
    const fields = lineFieldsFromForm(form({ warrantyOffered: "" }));
    expect(fields.warrantyOffered).toBeUndefined();
    expect(fields.warranty1Value).toBeNull();
    expect(fields.warranty2Unit).toBeNull();
  });
});
