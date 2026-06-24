import { describe, it, expect } from "vitest";
import { composeSourceLocation } from "./cells";

// The single legacy "Source Location" cell is composed from the split dealer
// locality + Dealer Country (ADR-0032, #110): the model stores the two fields
// separately (#108) but the artifact keeps one column (ADR-0029).
describe("composeSourceLocation", () => {
  it("joins locality and country as 'locality, Country' when both present", () => {
    expect(composeSourceLocation("Sao Paulo", "Brazil")).toBe("Sao Paulo, Brazil");
  });

  it("falls back to locality alone when country is absent", () => {
    expect(composeSourceLocation("Sao Paulo", null)).toBe("Sao Paulo");
  });

  it("falls back to country alone when locality is absent", () => {
    expect(composeSourceLocation(null, "Brazil")).toBe("Brazil");
  });

  it("is blank (null) when neither is present — legacy rows with neither", () => {
    expect(composeSourceLocation(null, null)).toBeNull();
  });

  it("treats blank-after-trim as absent, never a stray comma", () => {
    expect(composeSourceLocation("   ", "Brazil")).toBe("Brazil");
    expect(composeSourceLocation("Sao Paulo", "  ")).toBe("Sao Paulo");
    expect(composeSourceLocation("  ", "  ")).toBeNull();
  });

  it("trims each part before joining", () => {
    expect(composeSourceLocation("  Sao Paulo ", " Brazil ")).toBe("Sao Paulo, Brazil");
  });
});
