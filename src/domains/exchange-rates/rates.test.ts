import { describe, it, expect } from "vitest";
import { validateRateInput, currencyForCountry, rateValidationMessage } from "./rates";

describe("validateRateInput — Study Exchange Rate entry (#160, ADR-0041)", () => {
  it("accepts a well-formed non-USD rate, normalising the currency code", () => {
    const result = validateRateInput({ currency: "eur", rateDate: "2026-01-15", rate: "1.23456789" });
    expect(result).toEqual({
      ok: true,
      value: { currency: "EUR", rateDate: "2026-01-15", rate: "1.23456789" },
    });
  });

  it("refuses USD — it converts 1:1 and needs no row (grilling Q4)", () => {
    const result = validateRateInput({ currency: "usd", rateDate: "2026-01-15", rate: "1" });
    expect(result).toEqual({ ok: false, error: "usd-not-allowed" });
  });

  it("refuses a currency code outside ISO 4217", () => {
    const result = validateRateInput({ currency: "XYZ", rateDate: "2026-01-15", rate: "1.5" });
    expect(result).toEqual({ ok: false, error: "invalid-currency" });
  });

  it.each([
    ["zero", "0"],
    ["negative", "-1.5"],
    ["non-numeric", "abc"],
    ["blank", ""],
    ["more than 8 fractional digits", "1.123456789"],
    ["more than 10 integer digits", "12345678901"],
  ])("refuses a rate that is %s", (_label, rate) => {
    const result = validateRateInput({ currency: "EUR", rateDate: "2026-01-15", rate });
    expect(result).toEqual({ ok: false, error: "invalid-rate" });
  });

  it("accepts and normalises a rate at the Decimal(18,8) bounds", () => {
    const result = validateRateInput({ currency: "COP", rateDate: "2026-01-15", rate: "9999999999.99999999" });
    expect(result).toEqual({
      ok: true,
      value: { currency: "COP", rateDate: "2026-01-15", rate: "9999999999.99999999" },
    });
  });

  it.each([
    ["not a date", "nope"],
    ["wrong shape", "15/01/2026"],
    ["impossible month", "2026-13-01"],
    ["impossible day", "2026-02-30"],
    ["blank", ""],
  ])("refuses a rateDate that is %s", (_label, rateDate) => {
    const result = validateRateInput({ currency: "EUR", rateDate, rate: "1.5" });
    expect(result).toEqual({ ok: false, error: "invalid-date" });
  });

  it("accepts any well-formed date with no window bounds (grilling Q5)", () => {
    const future = validateRateInput({ currency: "EUR", rateDate: "2099-12-31", rate: "1.5" });
    expect(future.ok).toBe(true);
  });

  it("normalises surrounding whitespace and a leading plus on the rate", () => {
    const result = validateRateInput({ currency: "EUR", rateDate: "2026-01-15", rate: "  +2.5  " });
    expect(result).toEqual({
      ok: true,
      value: { currency: "EUR", rateDate: "2026-01-15", rate: "2.5" },
    });
  });
});

describe("currencyForCountry — country-first entry autopopulate (#160, ADR-0041)", () => {
  it("returns the local currency for a canonical country", () => {
    expect(currencyForCountry("France")).toBe("EUR");
    expect(currencyForCountry("Colombia")).toBe("COP");
  });

  it("canonicalises loosely-typed country input", () => {
    expect(currencyForCountry("  france ")).toBe("EUR");
  });

  it("returns null for anything that is not a country", () => {
    expect(currencyForCountry("Nowhere")).toBeNull();
    expect(currencyForCountry("")).toBeNull();
  });
});

describe("rateValidationMessage — human text for each refusal", () => {
  it("gives a distinct, non-empty message per error code", () => {
    const codes = ["usd-not-allowed", "invalid-currency", "invalid-date", "invalid-rate"] as const;
    const messages = codes.map(rateValidationMessage);
    expect(messages.every((m) => m.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(codes.length);
    expect(rateValidationMessage("usd-not-allowed")).toMatch(/USD/);
  });
});
