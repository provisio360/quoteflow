import { describe, it, expect } from "vitest";
import { benchmarkItemKey, resolveUpserts } from "./resolve";
import type { ValidatedBenchmarkItem } from "./import";

const item = (over: Partial<ValidatedBenchmarkItem>): ValidatedBenchmarkItem => ({
  country: "Germany",
  clientItemNumber: "PN-100",
  clientItemNumberKey: "pn-100",
  itemDescription: "Hydraulic pump",
  configurationComment: null,
  quantity: null,
  clientSourceUnit: "Excavator X1",
  sourceUnitIdentifier: null,
  clientCategory: null,
  clientItemOffering: null,
  itemSecondaryDescription: null,
  clientSecondaryItemNumber: null,
  requiredQuotes: 3,
  qcThreshold: null,
  requiredCompetitors: [],
  clientPrice: 1000,
  clientItemPrice: null,
  clientItemPriceCurrency: null,
  clientItemPriceQuantity: null,
  ...over,
});

describe("resolveUpserts — partition by existing key (ADR-0009 upsert)", () => {
  it("routes items whose key already exists to updates, the rest to inserts", () => {
    const a = item({ country: "Germany", clientItemNumberKey: "pn-100" }); // exists
    const b = item({ country: "France", clientItemNumberKey: "pn-100" }); // new (diff country)
    const c = item({ country: "Germany", clientItemNumberKey: "pn-200" }); // new

    const existing = new Set([benchmarkItemKey(a)]);
    const { inserts, updates } = resolveUpserts([a, b, c], existing);

    expect(updates).toEqual([a]);
    expect(inserts).toEqual([b, c]);
  });

  it("treats everything as an insert when the study has no existing items", () => {
    const a = item({ clientItemNumberKey: "pn-100" });
    const { inserts, updates } = resolveUpserts([a], new Set());
    expect(inserts).toEqual([a]);
    expect(updates).toEqual([]);
  });
});
