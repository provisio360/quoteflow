import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyInput, parseMoneyInput } from "./format-money";

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
    // eslint-disable-next-line no-irregular-whitespace
    expect(formatMoney(1.2, "BHD")).toBe("BHD 1.200");
  });
});

describe("parseMoneyInput", () => {
  it("strips thousands commas so a grouped input parses to its number", () => {
    expect(parseMoneyInput("28,911.32")).toBe("28911.32");
  });

  it("is lenient — mis-grouped input still strips to a parseable number", () => {
    expect(parseMoneyInput("2,8,911.32")).toBe("28911.32");
  });

  it("passes a blank input through untouched (the core treats it as a clear)", () => {
    expect(parseMoneyInput("")).toBe("");
  });
});

describe("formatMoneyInput", () => {
  it("groups a USD amount to 2 decimals with no currency symbol", () => {
    expect(formatMoneyInput(28911.32, "USD")).toBe("28,911.32");
  });

  it("honors a zero-minor-unit currency (JPY): grouping, no decimals, no symbol", () => {
    expect(formatMoneyInput(28911, "JPY")).toBe("28,911");
  });

  it("renders a null amount as blank (not the read-only em-dash)", () => {
    expect(formatMoneyInput(null, "USD")).toBe("");
  });
});
