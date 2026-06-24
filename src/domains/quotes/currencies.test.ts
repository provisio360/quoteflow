import { describe, it, expect } from "vitest";
import {
  defaultCurrencyForCountry,
  isValidCurrency,
  ISO_4217_CURRENCIES,
} from "./currencies";
import { ISO_3166_COUNTRY_NAMES } from "../benchmark-items/countries";

describe("defaultCurrencyForCountry", () => {
  it("maps the United States to USD", () => {
    expect(defaultCurrencyForCountry("United States")).toBe("USD");
  });

  it("maps spot-check countries to their currency", () => {
    expect(defaultCurrencyForCountry("Brazil")).toBe("BRL");
    expect(defaultCurrencyForCountry("Japan")).toBe("JPY");
  });

  it("resolves every canonical country to a valid ISO 4217 currency (no gaps)", () => {
    for (const country of ISO_3166_COUNTRY_NAMES) {
      const code = defaultCurrencyForCountry(country);
      expect(isValidCurrency(code), `${country} → ${code}`).toBe(true);
    }
  });

  it("maps every Eurozone member to EUR", () => {
    const eurozone = [
      "Austria",
      "Belgium",
      "Croatia",
      "Cyprus",
      "Estonia",
      "Finland",
      "France",
      "Germany",
      "Greece",
      "Ireland",
      "Italy",
      "Latvia",
      "Lithuania",
      "Luxembourg",
      "Malta",
      "Netherlands",
      "Portugal",
      "Slovakia",
      "Slovenia",
      "Spain",
    ] as const;
    for (const country of eurozone) {
      expect(defaultCurrencyForCountry(country), country).toBe("EUR");
    }
  });
});

describe("isValidCurrency", () => {
  it("accepts a known ISO 4217 code", () => {
    expect(isValidCurrency("USD")).toBe(true);
  });

  it("rejects an unknown code", () => {
    expect(isValidCurrency("ZZZ")).toBe(false);
  });

  it("rejects blank input", () => {
    expect(isValidCurrency("")).toBe(false);
    expect(isValidCurrency("   ")).toBe(false);
  });

  it("normalises case and surrounding whitespace", () => {
    expect(isValidCurrency("usd")).toBe(true);
    expect(isValidCurrency("  Eur ")).toBe(true);
  });
});

describe("ISO_4217_CURRENCIES", () => {
  it("lists codes with display names", () => {
    const usd = ISO_4217_CURRENCIES.find((c) => c.code === "USD");
    expect(usd).toEqual({ code: "USD", name: "US Dollar" });
  });

  it("only contains codes isValidCurrency accepts", () => {
    for (const { code } of ISO_4217_CURRENCIES) {
      expect(isValidCurrency(code), code).toBe(true);
    }
  });
});
