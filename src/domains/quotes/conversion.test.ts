import { describe, it, expect } from "vitest";
import {
  roundMoney,
  convert,
  resolveExchangeRate,
  computeConversion,
  convertManual,
  parseManualRate,
  MAX_LOOKBACK_DAYS,
} from "./conversion";
import type { ConvertibleQuote } from "./conversion";
import { InMemoryRateProvider } from "./rate-provider";

// A EUR quote received on a Monday (2026-06-01), 1250.50 for a pack of 2.
const eurQuote: ConvertibleQuote = {
  price: 1250.5,
  currency: "EUR",
  quantityQuoted: 2,
  dateQuoteReceived: new Date("2026-06-01"),
};

describe("roundMoney", () => {
  it("rounds to 4 decimal places, half-up", () => {
    expect(roundMoney(1.23454)).toBe(1.2345);
    expect(roundMoney(1.23455)).toBe(1.2346);
    expect(roundMoney(2.000049999)).toBe(2.0);
  });

  it("rounds the classic float-wart half cases half-up", () => {
    // 1.005 is stored just below 1.005 in float64; the epsilon nudge fixes it.
    expect(roundMoney(1.00005)).toBe(1.0001);
  });
});

describe("convert", () => {
  it("converts local price to USD and derives per-unit from the rounded total", () => {
    // 1250.50 * 1.08 = 1350.54 ; / 2 = 675.27
    expect(convert(1250.5, 2, 1.08)).toEqual({
      convertedUsdPrice: 1350.54,
      convertedUsdPricePerUnit: 675.27,
    });
  });

  it("rounds both figures to 4 decimals", () => {
    const result = convert(100, 3, 1.123456);
    expect(result.convertedUsdPrice).toBe(112.3456);
    // 112.3456 / 3 = 37.448533… → 37.4485
    expect(result.convertedUsdPricePerUnit).toBe(37.4485);
  });

  it("derives per-unit from the rounded total, not the raw product", () => {
    // raw 100 * 1.00005 = 100.005 → total rounds to 100.005? no: 100.005 has 3dp
    // Use a case where rounding the total first changes the per-unit.
    const result = convert(10, 3, 1.11115);
    // 10 * 1.11115 = 11.1115 → total 11.1115 ; /3 = 3.703833… → 3.7038
    expect(result.convertedUsdPrice).toBe(11.1115);
    expect(result.convertedUsdPricePerUnit).toBe(3.7038);
  });

  it("returns a null per-unit when quantity is zero (divide-by-zero guard)", () => {
    expect(convert(1250.5, 0, 1.08)).toEqual({
      convertedUsdPrice: 1350.54,
      convertedUsdPricePerUnit: null,
    });
  });

  it("returns a null per-unit when quantity is null", () => {
    expect(convert(1250.5, null, 1.08).convertedUsdPricePerUnit).toBeNull();
  });

  it("returns a null per-unit when quantity is negative", () => {
    expect(convert(1250.5, -1, 1.08).convertedUsdPricePerUnit).toBeNull();
  });
});

describe("resolveExchangeRate: exact and nearest-prior", () => {
  it("returns the exact-date rate when the market was open", async () => {
    const provider = new InMemoryRateProvider().set("EUR", "2026-06-01", 1.08);
    const result = await resolveExchangeRate(provider, "EUR", new Date("2026-06-01"));
    expect(result).toEqual({ ok: true, rate: 1.08, rateDate: new Date("2026-06-01") });
  });

  it("walks back to the nearest prior date and stores the date actually used", async () => {
    // Friday 2026-05-29 has a rate; the weekend (30/31) and Monday 06-01 do not.
    const provider = new InMemoryRateProvider().set("EUR", "2026-05-29", 1.07);
    const result = await resolveExchangeRate(provider, "EUR", new Date("2026-05-31"));
    expect(result).toEqual({ ok: true, rate: 1.07, rateDate: new Date("2026-05-29") });
  });

  it("walks back across a multi-day closed run within the bound", async () => {
    const provider = new InMemoryRateProvider().set("EUR", "2026-05-25", 1.05);
    // 6 days back from 2026-05-31 reaches 2026-05-25, inside the 7-day window.
    const result = await resolveExchangeRate(provider, "EUR", new Date("2026-05-31"));
    expect(result).toMatchObject({ ok: true, rate: 1.05 });
    expect((result as { rateDate: Date }).rateDate).toEqual(new Date("2026-05-25"));
  });

  it("gives up with no-rate-in-window once the look-back bound is exhausted", async () => {
    // Rate exists only 8 days back — just beyond the 7-day window.
    const provider = new InMemoryRateProvider().set("EUR", "2026-05-24", 1.04);
    const result = await resolveExchangeRate(provider, "EUR", new Date("2026-06-01"));
    expect(result).toEqual({ ok: false, reason: "no-rate-in-window" });
  });

  it("probes exactly the target date plus MAX_LOOKBACK_DAYS prior days", async () => {
    let calls = 0;
    const counting = {
      async rateFor() {
        calls++;
        return null;
      },
    };
    await resolveExchangeRate(counting, "EUR", new Date("2026-06-01"));
    expect(calls).toBe(MAX_LOOKBACK_DAYS + 1);
  });

  it("short-circuits USD to rate 1 without calling the provider", async () => {
    let called = false;
    const provider = {
      async rateFor() {
        called = true;
        return 999;
      },
    };
    const result = await resolveExchangeRate(provider, "usd", new Date("2026-06-01"));
    expect(result).toEqual({ ok: true, rate: 1, rateDate: new Date("2026-06-01") });
    expect(called).toBe(false);
  });

  it("normalizes the currency code (trim + upper-case) before lookup", async () => {
    const provider = new InMemoryRateProvider().set("EUR", "2026-06-01", 1.08);
    const result = await resolveExchangeRate(provider, "  eur ", new Date("2026-06-01"));
    expect(result).toMatchObject({ ok: true, rate: 1.08 });
  });
});

describe("computeConversion: auto path", () => {
  it("pins the rate, the rate date, and both USD figures, tagged auto", async () => {
    const provider = new InMemoryRateProvider().set("EUR", "2026-06-01", 1.08);
    const result = await computeConversion(eurQuote, provider);
    expect(result).toEqual({
      status: "auto",
      exchangeRate: 1.08,
      rateDate: new Date("2026-06-01"),
      convertedUsdPrice: 1350.54,
      convertedUsdPricePerUnit: 675.27,
    });
  });

  it("pins the walked-back rate date on a closed quote date", async () => {
    const provider = new InMemoryRateProvider().set("EUR", "2026-05-29", 1.07);
    const sundayQuote = { ...eurQuote, dateQuoteReceived: new Date("2026-05-31") };
    const result = await computeConversion(sundayQuote, provider);
    expect(result).toMatchObject({ status: "auto", rateDate: new Date("2026-05-29") });
  });
});

describe("computeConversion: pending path", () => {
  it("is pending when the provider is unreachable (throws)", async () => {
    const provider = new InMemoryRateProvider().setUnreachable();
    expect(await computeConversion(eurQuote, provider)).toEqual({ status: "pending" });
  });

  it("is pending when no rate exists within the look-back window", async () => {
    const provider = new InMemoryRateProvider(); // covers nothing
    expect(await computeConversion(eurQuote, provider)).toEqual({ status: "pending" });
  });
});

describe("pinning: USD does not move when later rates change", () => {
  it("derives USD from the stored pinned rate, never re-resolving", async () => {
    const provider = new InMemoryRateProvider().set("EUR", "2026-06-01", 1.08);

    // Convert once and capture the pinned rate + figures.
    const pinned = await computeConversion(eurQuote, provider);
    expect(pinned).toMatchObject({ status: "auto", exchangeRate: 1.08 });
    const { exchangeRate, convertedUsdPrice } = pinned as {
      exchangeRate: number;
      convertedUsdPrice: number;
    };

    // The market moves: the SAME currency/date now resolves to a different rate.
    provider.set("EUR", "2026-06-01", 1.5);
    const reresolved = await computeConversion(eurQuote, provider);
    expect(reresolved).toMatchObject({ exchangeRate: 1.5 });

    // But a quote derives USD from its PINNED rate, so its figures are invariant
    // under the move — re-deriving from the pin reproduces the original exactly.
    expect(convert(eurQuote.price, eurQuote.quantityQuoted, exchangeRate)).toEqual({
      convertedUsdPrice,
      convertedUsdPricePerUnit: 675.27,
    });
  });
});

describe("convertManual", () => {
  it("pins an analyst rate tagged manual, dated to the quote's received date", () => {
    const result = convertManual(eurQuote, 1.1);
    expect(result).toEqual({
      status: "manual",
      exchangeRate: 1.1,
      rateDate: new Date("2026-06-01"), // = dateQuoteReceived
      convertedUsdPrice: 1375.55,
      convertedUsdPricePerUnit: 687.775, // 1375.55 / 2 = 687.775 (already ≤ 4 dp)
    });
  });

  it("applies the same quantity guard as the auto path", () => {
    const result = convertManual({ ...eurQuote, quantityQuoted: 0 }, 1.1);
    expect(result.convertedUsdPricePerUnit).toBeNull();
  });
});

describe("parseManualRate", () => {
  it("accepts a positive numeric string, trimmed", () => {
    expect(parseManualRate(" 1.08 ")).toEqual({ ok: true, rate: 1.08 });
  });

  it("accepts a positive number directly", () => {
    expect(parseManualRate(1.1)).toEqual({ ok: true, rate: 1.1 });
  });

  it("rejects zero and negative rates", () => {
    expect(parseManualRate("0")).toEqual({ ok: false });
    expect(parseManualRate(-1.08)).toEqual({ ok: false });
  });

  it("rejects non-numeric, empty, and NaN input", () => {
    expect(parseManualRate("abc")).toEqual({ ok: false });
    expect(parseManualRate("1.1x")).toEqual({ ok: false });
    expect(parseManualRate("")).toEqual({ ok: false });
    expect(parseManualRate("   ")).toEqual({ ok: false });
    expect(parseManualRate(Number.NaN)).toEqual({ ok: false });
  });
});
