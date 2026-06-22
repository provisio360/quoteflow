import { describe, expect, it } from "vitest";
import { foldLegacyText, assignMigrationNumbers } from "./numbering";

// Pure spec for the #87 data migration's free-text carryover (ADR-0026): the flat
// quote's three free-text strings (leadTime, warranty, discount) have no clean
// structured target on the new Quote Line, so they are folded into its SECONDARY
// note, clearly delimited, with the primary `notes` left to map 1:1. The migration
// SQL must reproduce exactly this string; this is its reference.

describe("foldLegacyText", () => {
  it("folds the three legacy free-text fields into one delimited secondary note", () => {
    expect(foldLegacyText({ leadTime: "2 wk", warranty: "1 yr", discount: "5%" })).toBe(
      "Lead time: 2 wk; Warranty: 1 yr; Discount: 5%",
    );
  });

  it("omits absent parts, keeping only the fields that carried text", () => {
    expect(foldLegacyText({ leadTime: "2 wk", warranty: null, discount: "5%" })).toBe(
      "Lead time: 2 wk; Discount: 5%",
    );
  });

  it("returns null when no legacy text was present (no secondary note written)", () => {
    expect(foldLegacyText({ leadTime: null, warranty: null, discount: null })).toBeNull();
  });
});

describe("assignMigrationNumbers", () => {
  it("numbers a market's quotes 1..N by (createdAt, id), regardless of input order", () => {
    const rows = [
      { id: "c", studyId: "s1", country: "Brazil", createdAt: new Date("2026-03-03") },
      { id: "a", studyId: "s1", country: "Brazil", createdAt: new Date("2026-01-01") },
      { id: "b", studyId: "s1", country: "Brazil", createdAt: new Date("2026-02-02") },
    ];
    const numbered = assignMigrationNumbers(rows);
    expect(numbered.map((r) => [r.id, r.marketQuoteNumber, r.quoteLineNumber])).toEqual([
      ["a", 1, 1],
      ["b", 2, 2],
      ["c", 3, 3],
    ]);
  });

  it("restarts numbering per (study, country) market", () => {
    const t = new Date("2026-01-01");
    const rows = [
      { id: "br1", studyId: "s1", country: "Brazil", createdAt: t },
      { id: "de1", studyId: "s1", country: "Germany", createdAt: t },
      { id: "br2", studyId: "s1", country: "Brazil", createdAt: new Date("2026-01-02") },
    ];
    const numbered = assignMigrationNumbers(rows);
    const byId = new Map(numbered.map((r) => [r.id, r.marketQuoteNumber]));
    expect(byId.get("br1")).toBe(1);
    expect(byId.get("br2")).toBe(2);
    expect(byId.get("de1")).toBe(1); // Germany restarts at 1
  });

  it("breaks an equal-createdAt tie by id, deterministically", () => {
    const t = new Date("2026-01-01");
    const rows = [
      { id: "zzz", studyId: "s1", country: "Brazil", createdAt: t },
      { id: "aaa", studyId: "s1", country: "Brazil", createdAt: t },
    ];
    const numbered = assignMigrationNumbers(rows);
    expect(numbered.map((r) => r.id)).toEqual(["aaa", "zzz"]);
  });
});
