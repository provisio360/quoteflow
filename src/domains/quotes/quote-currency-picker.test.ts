import { describe, it, expect } from "vitest";
import { currencyOptions, defaultCurrencyOnCountryChange } from "./quote-currency-picker";
import { ISO_4217_CURRENCIES } from "./currencies";

describe("currencyOptions", () => {
  it("lists every active ISO 4217 code when there is no prefilled value", () => {
    const opts = currencyOptions(null);
    expect(opts).toHaveLength(ISO_4217_CURRENCIES.length);
    expect(opts.map((o) => o.value)).toEqual(ISO_4217_CURRENCIES.map((c) => c.code));
  });

  it("does not inject a duplicate when the prefilled value is a known code", () => {
    const opts = currencyOptions("EUR");
    expect(opts).toHaveLength(ISO_4217_CURRENCIES.length);
    expect(opts.filter((o) => o.value === "EUR")).toHaveLength(1);
  });

  it("prepends a legacy free-text value as a selectable option so it round-trips", () => {
    const opts = currencyOptions("Swiss Francs");
    expect(opts[0]).toEqual({ value: "Swiss Francs", label: "Swiss Francs" });
    expect(opts).toHaveLength(ISO_4217_CURRENCIES.length + 1);
  });
});

describe("defaultCurrencyOnCountryChange", () => {
  it("returns the chosen country's default currency", () => {
    expect(defaultCurrencyOnCountryChange("France")).toBe("EUR");
  });

  it("tolerates case/spacing variants of a canonical name", () => {
    expect(defaultCurrencyOnCountryChange("  france ")).toBe("EUR");
  });

  it("returns null for the blank placeholder so the caller leaves currency untouched", () => {
    expect(defaultCurrencyOnCountryChange("")).toBeNull();
  });

  it("returns null for a value that is not a canonical country name", () => {
    expect(defaultCurrencyOnCountryChange("Narnia")).toBeNull();
  });
});
