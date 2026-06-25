import { describe, expect, it } from "vitest";
import { formatMoney } from "./format-money";

describe("formatMoney", () => {
  it("renders a USD amount with symbol, grouping, and 2 decimals", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
  });

  it("renders a null amount as an em-dash (no USD yet / unpriced / not-comparable)", () => {
    expect(formatMoney(null, "USD")).toBe("—");
  });

  it("honors a zero-minor-unit currency (JPY) from a stored string price", () => {
    expect(formatMoney("1234.5", "JPY")).toBe("¥1,235");
  });

  it("honors a three-minor-unit currency (BHD)", () => {
    // Intl separates a code-style symbol with a non-breaking space (U+00A0).
    expect(formatMoney(1.2, "BHD")).toBe("BHD 1.200");
  });
});
