import { describe, it, expect } from "vitest";
import { validateImport } from "./import";

// The canonical header row a brief spreadsheet must carry (order-independent;
// matched case/whitespace-insensitively by the validator).
const HEADERS = [
  "Country",
  "Client Part Number",
  "Item Description",
  "Configuration Comment",
  "Quantity",
  "Machine/Model",
  "Required Quotes",
  "Client Price",
];

// A fully-valid data row, aligned to HEADERS above.
const validRow = [
  "Germany",
  "PN-100",
  "Hydraulic pump",
  "With seal kit",
  "10",
  "Excavator X1",
  "3",
  "1250.50",
];

// Build a grid from rows expressed as field→value maps, so each test states
// only what it cares about and stays readable.
function gridOf(...rows: Partial<Record<string, string>>[]): string[][] {
  const base: Record<string, string> = {
    Country: "Germany",
    "Client Part Number": "PN-100",
    "Item Description": "Hydraulic pump",
    "Configuration Comment": "With seal kit",
    Quantity: "10",
    "Machine/Model": "Excavator X1",
    "Required Quotes": "3",
    "Client Price": "1250.50",
  };
  return [HEADERS, ...rows.map((r) => HEADERS.map((h) => ({ ...base, ...r })[h]!))];
}

describe("validateImport — a single valid row (tracer)", () => {
  it("normalizes one valid row into one Benchmark Item record", () => {
    const result = validateImport([HEADERS, validRow]);

    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow for the type checker
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      country: "Germany",
      clientPartNumber: "PN-100",
      clientPartNumberKey: "pn-100",
      itemDescription: "Hydraulic pump",
      configurationComment: "With seal kit",
      quantity: 10,
      machineModel: "Excavator X1",
      requiredQuotes: 3,
      clientPrice: 1250.5,
    });
  });
});

describe("validateImport — required fields", () => {
  it.each([
    ["Country", "country"],
    ["Client Part Number", "clientPartNumber"],
    ["Item Description", "itemDescription"],
    ["Machine/Model", "machineModel"],
    ["Required Quotes", "requiredQuotes"],
    ["Client Price", "clientPrice"],
  ])("rejects a blank %s as a row error and yields no items", (header, field) => {
    const result = validateImport(gridOf({ [header]: "" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 2, field, message: expect.stringMatching(/required/i) }),
    );
  });
});

describe("validateImport — Country canonicalization", () => {
  it("accepts a case/space variant and stores the canonical name", () => {
    const result = validateImport(gridOf({ Country: "  united   STATES " }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].country).toBe("United States");
  });

  it("rejects a country not in the canonical list (no alias mapping)", () => {
    const result = validateImport(gridOf({ Country: "USA" }, { Country: "Britano" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 2, field: "country", message: expect.stringMatching(/USA/) }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 3, field: "country", message: expect.stringMatching(/Britano/) }),
    );
  });
});

describe("validateImport — all-or-nothing", () => {
  it("collects EVERY error across all rows and fields, and yields no partial items", () => {
    const result = validateImport(
      gridOf(
        {}, // row 2: valid
        { "Client Part Number": "PN-200", Country: "Atlantis", "Client Price": "-5" }, // row 3: two errors
        { "Client Part Number": "PN-300", "Machine/Model": "", "Required Quotes": "2.5" }, // row 4: two errors
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A discriminated union: the failure branch has no `items` at all — there is
    // no way to express a partially-loaded study.
    expect("items" in result).toBe(false);
    expect(result.errors).toHaveLength(4);
    expect(result.errors.map((e) => e.row)).toEqual([3, 3, 4, 4]);
  });
});

describe("validateImport — file structure & headers", () => {
  it("reports a missing REQUIRED header as a file-level error (no row noise)", () => {
    const headers = HEADERS.filter((h) => h !== "Client Price");
    const result = validateImport([headers, headers.map(() => "x")]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: null, message: expect.stringMatching(/Client Price/) }),
    );
    // It must not also emit per-row "required" spam for the absent column.
    expect(result.errors.every((e) => e.row === null)).toBe(true);
  });

  it("ignores column order and unknown extra columns", () => {
    const headers = ["Junk", "Client Price", "Required Quotes", "Machine/Model", "Quantity",
      "Configuration Comment", "Item Description", "Client Part Number", "Country"];
    const row = ["ignore me", "1250.50", "3", "Excavator X1", "10",
      "With seal kit", "Hydraulic pump", "PN-100", "Germany"];
    const result = validateImport([headers, row]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]).toMatchObject({ country: "Germany", clientPrice: 1250.5 });
  });

  it("rejects an empty file", () => {
    const result = validateImport([]);
    expect(result.ok).toBe(false);
  });

  it("rejects a header-only file (no data rows)", () => {
    const result = validateImport([HEADERS]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: null, message: expect.stringMatching(/no data|empty/i) }),
    );
  });
});

describe("validateImport — Required Quotes (integer >= 0)", () => {
  it("accepts zero (an item that needs no quotes)", () => {
    const result = validateImport(gridOf({ "Required Quotes": "0" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].requiredQuotes).toBe(0);
  });

  it.each(["-1", "2.5", "abc"])("rejects %s", (value) => {
    const result = validateImport(gridOf({ "Required Quotes": value }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 2, field: "requiredQuotes" }),
    );
  });
});

describe("validateImport — Client Price (> 0)", () => {
  it.each(["0", "-5", "abc"])("rejects %s", (value) => {
    const result = validateImport(gridOf({ "Client Price": value }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 2, field: "clientPrice" }),
    );
  });
});

describe("validateImport — Quantity (optional, positive integer when present)", () => {
  it.each(["abc", "-3", "2.5"])("rejects a non-positive-integer Quantity %s", (value) => {
    const result = validateImport(gridOf({ Quantity: value }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 2, field: "quantity" }),
    );
  });
});

describe("validateImport — in-file duplicate keys", () => {
  it("rejects the same (part number + country) appearing twice, flagging both rows", () => {
    const result = validateImport(
      gridOf({}, { "Item Description": "Same item again" }), // both Germany / PN-100
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 3, field: "clientPartNumber", message: expect.stringMatching(/row 2/) }),
    );
  });

  it("treats the same part number in DIFFERENT countries as distinct items", () => {
    const result = validateImport(gridOf({ Country: "Germany" }, { Country: "France" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(2);
  });

  it("matches the duplicate key case-insensitively on part number and country", () => {
    const result = validateImport(
      gridOf({ Country: "Germany", "Client Part Number": "PN-100" },
             { Country: "germany", "Client Part Number": "pn-100" }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("validateImport — optional fields", () => {
  it("accepts blank Configuration Comment and Quantity", () => {
    const result = validateImport(gridOf({ "Configuration Comment": "", Quantity: "" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]).toMatchObject({
      configurationComment: null,
      quantity: null,
    });
  });
});
