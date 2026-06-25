import { describe, expect, it } from "vitest";
import { lineFieldsFromForm } from "./quote-line-form";

// Shipping Lead Time (value + unit) and Landed Cost (Included? + Note) entry parsing
// (ADR-0035). Lead-time value groups at rest like warranty (unit-agnostic) and is
// stripped back to a bare number. Landed Cost's flag is tri-state; the Note rides
// along only when Included? is "Yes" (it is rendered, and so posts, only then).

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("lineFieldsFromForm — shipping lead time", () => {
  it("records a value + unit pair, stripping thousands commas from the value", () => {
    const fields = lineFieldsFromForm(form({ leadTimeValue: "1,500", leadTimeUnit: "days" }));
    expect(fields.leadTimeValue).toBe(1500);
    expect(fields.leadTimeUnit).toBe("days");
  });

  it("leaves an absent pair undefined", () => {
    const fields = lineFieldsFromForm(form({}));
    expect(fields.leadTimeValue).toBeUndefined();
    expect(fields.leadTimeUnit).toBeUndefined();
  });
});

describe("lineFieldsFromForm — landed cost", () => {
  it("records Included=Yes with its Note", () => {
    const fields = lineFieldsFromForm(form({ landedCostIncluded: "true", landedCostNote: "DDP Hamburg" }));
    expect(fields.landedCostIncluded).toBe(true);
    expect(fields.landedCostNote).toBe("DDP Hamburg");
  });

  it("records Included=No (the Note is not rendered, so absent)", () => {
    const fields = lineFieldsFromForm(form({ landedCostIncluded: "false" }));
    expect(fields.landedCostIncluded).toBe(false);
    expect(fields.landedCostNote).toBeUndefined();
  });

  it("leaves an unanswered flag undefined (not false)", () => {
    const fields = lineFieldsFromForm(form({}));
    expect(fields.landedCostIncluded).toBeUndefined();
    expect(fields.landedCostNote).toBeUndefined();
  });
});
