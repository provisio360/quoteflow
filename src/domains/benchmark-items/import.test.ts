import { describe, it, expect } from "vitest";
import { validateImport } from "./import";

// The canonical header row a brief spreadsheet must carry (order-independent;
// matched case/whitespace-insensitively by the validator). Extended for #86: the
// identity column is "Client Item Number", the machine/model is "Client Source
// Unit", Client Price arrives as a raw trio, and per-item QC Threshold +
// Required Competitors ride in too.
const HEADERS = [
  "Country",
  "Client Item Number",
  "Item Description",
  "Configuration Comment",
  "Quantity",
  "Client Source Unit",
  "Source Unit Identifier",
  "Client Category",
  "Client Item Offering",
  "Item Secondary Description",
  "Client Secondary Item Number",
  "Required Quotes",
  "Price Difference Threshold",
  "Required Competitor 1",
  "Required Competitor 2",
  "Client Item Price",
  "Client Item Price Currency",
  "Client Item Price Quantity",
];

const base: Record<string, string> = {
  Country: "Germany",
  "Client Item Number": "PN-100",
  "Item Description": "Hydraulic pump",
  "Configuration Comment": "With seal kit",
  Quantity: "10",
  "Client Source Unit": "BRC8T450X",
  "Source Unit Identifier": "Rev-2",
  "Client Category": "Pumps",
  "Client Item Offering": "Standard",
  "Item Secondary Description": "Secondary desc",
  "Client Secondary Item Number": "SEC-100",
  "Required Quotes": "3",
  "Price Difference Threshold": "0.8",
  "Required Competitor 1": "Bosch",
  "Required Competitor 2": "Denso",
  "Client Item Price": "100",
  "Client Item Price Currency": "USD",
  "Client Item Price Quantity": "4",
};

// Build a grid from rows expressed as field→value maps, so each test states
// only what it cares about and stays readable.
function gridOf(...rows: Partial<Record<string, string>>[]): string[][] {
  return [HEADERS, ...rows.map((r) => HEADERS.map((h) => ({ ...base, ...r })[h] ?? ""))];
}

describe("validateImport — a single valid row (tracer)", () => {
  it("normalizes one valid row into one Benchmark Item record", () => {
    const result = validateImport(gridOf({}));

    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow for the type checker
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      country: "Germany",
      clientItemNumber: "PN-100",
      clientItemNumberKey: "pn-100",
      itemDescription: "Hydraulic pump",
      configurationComment: "With seal kit",
      quantity: 10,
      clientSourceUnit: "BRC8T450X",
      sourceUnitIdentifier: "Rev-2",
      clientCategory: "Pumps",
      clientItemOffering: "Standard",
      itemSecondaryDescription: "Secondary desc",
      clientSecondaryItemNumber: "SEC-100",
      requiredQuotes: 3,
      qcThreshold: 0.8,
      requiredCompetitors: ["Bosch", "Denso"],
      clientPrice: 25,
      clientItemPrice: 100,
      clientItemPriceCurrency: "USD",
      clientItemPriceQuantity: 4,
    });
  });
});

describe("validateImport — required fields", () => {
  it.each([
    ["Country", "country"],
    ["Client Item Number", "clientItemNumber"],
    ["Item Description", "itemDescription"],
    ["Required Quotes", "requiredQuotes"],
  ])("rejects a blank %s as a row error and yields no items", (header, field) => {
    const result = validateImport(gridOf({ [header]: "" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 2, field, message: expect.stringMatching(/required/i) }),
    );
  });

  it("accepts a blank Client Source Unit (now nullable, #86)", () => {
    const result = validateImport(gridOf({ "Client Source Unit": "" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].clientSourceUnit).toBeNull();
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
    const result = validateImport(
      gridOf({ Country: "USA", "Client Item Number": "PN-1" }, { Country: "Britano", "Client Item Number": "PN-2" }),
    );
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
  it("collects EVERY error across all rows and yields no partial items", () => {
    const result = validateImport(
      gridOf(
        {}, // row 2: valid
        { "Client Item Number": "PN-200", Country: "Atlantis", "Client Item Price": "-5" }, // row 3: two errors
        { "Client Item Number": "PN-300", "Required Quotes": "2.5", Quantity: "0" }, // row 4: two errors
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect("items" in result).toBe(false);
    expect(result.errors.map((e) => e.row)).toEqual([3, 3, 4, 4]);
  });
});

describe("validateImport — file structure & headers", () => {
  it("reports a missing REQUIRED header as a file-level error (no row noise)", () => {
    const headers = HEADERS.filter((h) => h !== "Required Quotes");
    const result = validateImport([headers, headers.map(() => "x")]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: null, message: expect.stringMatching(/Required Quotes/) }),
    );
    expect(result.errors.every((e) => e.row === null)).toBe(true);
  });

  it("accepts a file with no Client Price columns at all (unpriced study, ADR-0015)", () => {
    const priceCols = ["Client Item Price", "Client Item Price Currency", "Client Item Price Quantity"];
    const keep = (h: string) => !priceCols.includes(h);
    const headers = HEADERS.filter(keep);
    const row = headers.map((h) => base[h] ?? "");
    const result = validateImport([headers, row]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].clientPrice).toBeNull();
    expect(result.items[0].clientItemPrice).toBeNull();
  });

  it("ignores unknown extra columns", () => {
    const result = validateImport(gridOf({}).map((row, i) => (i === 0 ? ["Junk", ...row] : ["x", ...row])));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]).toMatchObject({ country: "Germany", clientPrice: 25 });
  });

  it("rejects an empty file", () => {
    expect(validateImport([]).ok).toBe(false);
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

describe("validateImport — client artifact header aliases", () => {
  // The labels a real client brief carries: Country is "Market", most item
  // columns are "Client"-prefixed, and Required Competitors are unspaced. Each
  // must resolve to the same field as its canonical label.
  const ALIAS_OF: Record<string, string> = {
    Country: "Market",
    "Item Description": "Client Item Description",
    "Configuration Comment": "Client Item Configuration Comment",
    Quantity: "Client Item Quantity",
    "Source Unit Identifier": "Client Source Unit Identifier",
    "Item Secondary Description": "Client Item Secondary Description",
    "Required Competitor 1": "Required Competitor1",
    "Required Competitor 2": "Required Competitor2",
  };
  const aliasHeaders = HEADERS.map((h) => ALIAS_OF[h] ?? h);
  const aliasRow = HEADERS.map((h) => base[h] ?? "");

  it("accepts a brief that uses the client aliases, mapping every aliased column", () => {
    const result = validateImport([aliasHeaders, aliasRow]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      country: "Germany",
      itemDescription: "Hydraulic pump",
      configurationComment: "With seal kit",
      quantity: 10,
      sourceUnitIdentifier: "Rev-2",
      itemSecondaryDescription: "Secondary desc",
      requiredCompetitors: ["Bosch", "Denso"],
    });
  });
});

describe("validateImport — Required Quotes (integer >= 0)", () => {
  it("accepts zero", () => {
    const result = validateImport(gridOf({ "Required Quotes": "0" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].requiredQuotes).toBe(0);
  });

  it.each(["-1", "2.5", "abc"])("rejects %s", (value) => {
    const result = validateImport(gridOf({ "Required Quotes": value }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ row: 2, field: "requiredQuotes" }));
  });
});

describe("validateImport — Client Price trio (#86, ADR-0027)", () => {
  it("derives USD/unit and retains the raw trio as seed", () => {
    const result = validateImport(gridOf({ "Client Item Price": "250", "Client Item Price Quantity": "5" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]).toMatchObject({ clientPrice: 50, clientItemPrice: 250, clientItemPriceQuantity: 5 });
  });

  it("rejects a non-USD currency", () => {
    const result = validateImport(gridOf({ "Client Item Price Currency": "EUR" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 2, field: "clientItemPrice", message: expect.stringMatching(/USD/) }),
    );
  });

  it("rejects a partial trio (price without quantity)", () => {
    const result = validateImport(gridOf({ "Client Item Price Quantity": "" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ row: 2, field: "clientItemPrice" }));
  });

  it("treats a fully blank trio as an unpriced item (null, no seed)", () => {
    const result = validateImport(
      gridOf({ "Client Item Price": "", "Client Item Price Currency": "", "Client Item Price Quantity": "" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]).toMatchObject({ clientPrice: null, clientItemPrice: null, clientItemPriceCurrency: null });
  });
});

describe("validateImport — per-item QC Threshold (fraction, optional)", () => {
  it("stores the threshold as a fraction, exactly as given", () => {
    const result = validateImport(gridOf({ "Price Difference Threshold": "0.25" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].qcThreshold).toBe(0.25);
  });

  it("is null when blank (falls back to the study default downstream)", () => {
    const result = validateImport(gridOf({ "Price Difference Threshold": "" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].qcThreshold).toBeNull();
  });

  it.each(["0", "-0.1", "abc"])("rejects a non-positive / non-numeric threshold %s", (value) => {
    const result = validateImport(gridOf({ "Price Difference Threshold": value }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ row: 2, field: "qcThreshold" }));
  });
});

describe("validateImport — Required Competitors (advisory, up to 10)", () => {
  it("collects the competitor columns in order, dropping blanks", () => {
    const result = validateImport(gridOf({ "Required Competitor 1": "Bosch", "Required Competitor 2": "" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].requiredCompetitors).toEqual(["Bosch"]);
  });

  it("yields an empty list when no competitor columns are filled", () => {
    const result = validateImport(gridOf({ "Required Competitor 1": "", "Required Competitor 2": "" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].requiredCompetitors).toEqual([]);
  });

  it("preserves duplicates (advisory, no dedupe)", () => {
    const result = validateImport(gridOf({ "Required Competitor 1": "Bosch", "Required Competitor 2": "Bosch" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].requiredCompetitors).toEqual(["Bosch", "Bosch"]);
  });
});

describe("validateImport — Client Item Offering (free-form)", () => {
  it.each([
    "Standard",
    "Premium",
    "Gold",
    "Standard (Premium dunkle)",
  ])("keeps any non-blank offering verbatim: %s", (input) => {
    const result = validateImport(gridOf({ "Client Item Offering": input }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].clientItemOffering).toBe(input);
  });

  it("trims surrounding whitespace", () => {
    const result = validateImport(gridOf({ "Client Item Offering": "  Premium " }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].clientItemOffering).toBe("Premium");
  });

  it("is null when blank", () => {
    const result = validateImport(gridOf({ "Client Item Offering": "" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].clientItemOffering).toBeNull();
  });
});

describe("validateImport — Quantity (optional, positive integer when present)", () => {
  it.each(["abc", "-3", "2.5"])("rejects a non-positive-integer Quantity %s", (value) => {
    const result = validateImport(gridOf({ Quantity: value }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ row: 2, field: "quantity" }));
  });
});

describe("validateImport — in-file duplicate keys", () => {
  it("rejects the same (Client Item Number + country) appearing twice, flagging both rows", () => {
    const result = validateImport(gridOf({}, { "Item Description": "Same item again" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 3, field: "clientItemNumber", message: expect.stringMatching(/row 2/) }),
    );
  });

  it("treats the same item number in DIFFERENT countries as distinct items", () => {
    const result = validateImport(gridOf({ Country: "Germany" }, { Country: "France" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(2);
  });
});

describe("validateImport — optional descriptive fields", () => {
  it("nulls blank optional fields", () => {
    const result = validateImport(
      gridOf({
        "Configuration Comment": "",
        Quantity: "",
        "Source Unit Identifier": "",
        "Client Category": "",
        "Item Secondary Description": "",
        "Client Secondary Item Number": "",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]).toMatchObject({
      configurationComment: null,
      quantity: null,
      sourceUnitIdentifier: null,
      clientCategory: null,
      itemSecondaryDescription: null,
      clientSecondaryItemNumber: null,
    });
  });
});
