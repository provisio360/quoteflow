// The seam between the currency-conversion core and the outside world (#9).
//
// `RateProvider` is the port ADR-0004 promised: the FX vendor lives behind it so
// it can be swapped without touching domain code. The port speaks only in EXACT
// dates and a single direction convention; the bounded nearest-prior walk-back
// lives ABOVE it (resolveExchangeRate in ./conversion), not inside it.
//
// The real exchangerate-api.com adapter arrives in #10. Here we ship only the
// interface and an in-memory fake, so the whole conversion core is unit-testable
// with no network. The fake lives in this (non-test) module on purpose, so #10's
// real adapter imports the interface and #9/#11 tests import the fake.

/**
 * Historical FX rates behind a swappable vendor (ADR-0004).
 *
 * Direction convention (load-bearing — an inversion here is silent and corrupts
 * every figure): the returned number is **USD per 1 unit of `currency`**, so a
 * caller computes `usd = price * rate`. The real adapter (#10) normalizes the
 * vendor's base→target response to this convention.
 *
 * Granularity: `rateFor` answers for one EXACT `date` only. `null` means the
 * provider has no rate for that date (market closed / no data) — the caller
 * walks back to the nearest prior date. A thrown error means the provider was
 * unreachable, which the caller maps to a pending conversion.
 */
export interface RateProvider {
  rateFor(currency: string, date: Date): Promise<number | null>;
}

/** A calendar date as `YYYY-MM-DD` in UTC — the key the fake stores rates under. */
function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `currency|YYYY-MM-DD` — the composite lookup key for the in-memory fake. */
function rateKey(currency: string, date: Date): string {
  return `${currency.trim().toUpperCase()}|${dateKey(date)}`;
}

/**
 * In-memory RateProvider for tests (#9) and later slices (#11) — no network.
 * Seed exact (currency, date) rates; unseeded dates return null (market closed),
 * exercising the nearest-prior walk-back. `setUnreachable()` makes every call
 * throw, exercising the pending-on-outage path.
 */
export class InMemoryRateProvider implements RateProvider {
  private readonly rates = new Map<string, number>();
  private unreachable = false;

  /** Pin a rate for an exact (currency, date). Returns `this` for chaining. */
  set(currency: string, date: Date | string, rate: number): this {
    const d = typeof date === "string" ? new Date(date) : date;
    this.rates.set(rateKey(currency, d), rate);
    return this;
  }

  /** Make every subsequent call throw, simulating provider outage. */
  setUnreachable(value = true): this {
    this.unreachable = value;
    return this;
  }

  async rateFor(currency: string, date: Date): Promise<number | null> {
    if (this.unreachable) {
      throw new Error("RateProvider unreachable");
    }
    return this.rates.get(rateKey(currency, date)) ?? null;
  }
}
