import { describe, expect, it } from "vitest";
import { lineFieldsFromForm } from "./quote-line-form";

// The researcher's discount chain (Discount Available → Applied → % + Type).
// Discount is advisory metadata: the % is recorded as typed (15 = 15%), never
// applied to the price (the price is already the dealer's discount-inclusive
// final). The nested fields are only rendered when their parent is "Yes", so a
// "No"/blank answer posts the parent flag with no nested keys at all.

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("lineFieldsFromForm — discount chain", () => {
  it("records the full chain: Available=Yes, Applied=Yes, % and Type", () => {
    const fields = lineFieldsFromForm(
      form({
        discountAvailable: "true",
        discountApplied: "true",
        discountValue: "15",
        discountType: "Volume",
      }),
    );
    expect(fields.discountAvailable).toBe(true);
    expect(fields.discountApplied).toBe(true);
    expect(fields.discountValue).toBe(15);
    expect(fields.discountType).toBe("Volume");
  });

  it("Available=No leaves the nested fields untouched (keys absent in DOM)", () => {
    const fields = lineFieldsFromForm(form({ discountAvailable: "false" }));
    expect(fields.discountAvailable).toBe(false);
    expect(fields.discountApplied).toBeUndefined();
    expect(fields.discountValue).toBeUndefined();
    expect(fields.discountType).toBeUndefined();
  });

  it("a blank/unanswered Available posts no flag (undefined, not false)", () => {
    const fields = lineFieldsFromForm(form({ discountAvailable: "" }));
    expect(fields.discountAvailable).toBeUndefined();
  });

  it("Available=Yes, Applied=No records the No and omits the %", () => {
    const fields = lineFieldsFromForm(
      form({ discountAvailable: "true", discountApplied: "false" }),
    );
    expect(fields.discountAvailable).toBe(true);
    expect(fields.discountApplied).toBe(false);
    expect(fields.discountValue).toBeUndefined();
    expect(fields.discountType).toBeUndefined();
  });
});
