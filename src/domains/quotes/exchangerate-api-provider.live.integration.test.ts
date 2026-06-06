import { describe, it, expect } from "vitest";
import { exchangerateApiProviderFromEnv } from "./exchangerate-api-provider";

// OPT-IN live smoke against the real exchangerate-api.com /history endpoint (#10).
// Skipped unless EXCHANGERATE_API_KEY is set, so CI and normal integration runs
// never hit the network or burn quota. Run it by hand after setting the key (and
// allow-listing v6.exchangerate-api.com) to confirm the real vendor still speaks
// the shape the adapter parses. The deterministic behaviour is covered by the
// stubbed-fetch unit suite; this only proves the live contract hasn't drifted.

const hasKey = !!process.env.EXCHANGERATE_API_KEY;

describe.skipIf(!hasKey)("ExchangerateApiProvider (live)", () => {
  it("returns a sane USD-per-EUR rate for a known closed date", async () => {
    const provider = exchangerateApiProviderFromEnv();

    // A long-closed weekday well within any paid plan's history range.
    const rate = await provider.rateFor("EUR", new Date("2024-01-02T00:00:00Z"));

    expect(rate).not.toBeNull();
    expect(Number.isFinite(rate)).toBe(true);
    // USD per 1 EUR has sat roughly in [0.9, 1.3] for years — a wide sanity band
    // that still catches an un-inverted rate (which would be ~0.9 the other way).
    expect(rate!).toBeGreaterThan(0.5);
    expect(rate!).toBeLessThan(2);
  });
});
