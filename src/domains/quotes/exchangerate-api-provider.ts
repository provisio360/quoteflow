// The real exchangerate-api.com v6 adapter behind the RateProvider port (#10,
// ADR-0004 / ADR-0013). The bounded nearest-prior walk-back lives ABOVE this in
// resolveExchangeRate; here we answer for ONE exact date, returning USD-per-unit
// of `currency` (the vendor's base→target response normalized to the port's
// convention) or null when the date/currency has no rate.

import type { RateProvider } from "./rate-provider";

const DEFAULT_BASE_URL = "https://v6.exchangerate-api.com/v6";
const DEFAULT_TIMEOUT_MS = 10_000;

/** The vendor's `conversion_rates` for base USD on one date: units of X per 1 USD. */
type RatesTable = Record<string, number>;

/** Config for the live adapter. `fetch` is injected in tests (the HTTP boundary). */
export interface ExchangerateApiConfig {
  readonly apiKey: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export class ExchangerateApiProvider implements RateProvider {
  private readonly apiKey: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  // Per-date memo, keyed YYYY-MM-DD. A `/history/USD` response carries every
  // currency for that date, so one fetch serves a whole sweep's worth of quotes
  // sharing a date (ADR-0013's batching). `null` = the date has no data. Failed
  // fetches are NOT cached, so a later sweep retries. Scoped to this instance —
  // the worker builds a fresh provider per run, so the memo never goes stale.
  private readonly tables = new Map<string, RatesTable | null>();

  constructor(config: ExchangerateApiConfig) {
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async rateFor(currency: string, date: Date): Promise<number | null> {
    const table = await this.tableFor(date);
    if (table === null) {
      return null; // no data for this date → caller walks back to the prior day.
    }
    // A currency absent from a successful table is one the provider doesn't
    // cover: return null (the walk-back exhausts → pending → analyst manual rate),
    // never a NaN from dividing by undefined.
    const perUsd = table[currency.trim().toUpperCase()];
    if (perUsd === undefined || perUsd === 0) {
      return null;
    }
    return 1 / perUsd;
  }

  /** Fetch (and memo) the USD rate table for one date; null = no data; throws on outage. */
  private async tableFor(date: Date): Promise<RatesTable | null> {
    const key = date.toISOString().slice(0, 10);
    const cached = this.tables.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const table = await this.fetchTable(date);
    this.tables.set(key, table);
    return table;
  }

  private async fetchTable(date: Date): Promise<RatesTable | null> {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    const url = `${this.baseUrl}/${this.apiKey}/history/USD/${y}/${m}/${d}`;

    // Bound a hung request so a slow vendor can't stall the sweep — an abort
    // surfaces as a throw → the quote stays pending and the next sweep retries.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    // The vendor signals outcome via the JSON `result`/`error-type`, and the
    // HTTP status only loosely tracks it (no-data-available arrives as 404), so
    // the body is the source of truth. A body that won't parse (a 5xx HTML page,
    // a proxy error) is an outage → throw, surfacing the status.
    let body: {
      result?: string;
      "error-type"?: string;
      conversion_rates?: RatesTable;
    } | null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (body === null) {
      throw new Error(`exchangerate-api request failed: HTTP ${res.status}`);
    }

    if (body.result === "error") {
      // A date the provider has no data for maps to null so the caller walks
      // back to the prior day. Every other error-type (invalid-key, quota-reached,
      // inactive-account, plan-upgrade-required, …) is operational: throw so the
      // quote stays pending and the next sweep retries (ADR-0013).
      if (body["error-type"] === "no-data-available") {
        return null;
      }
      throw new Error(`exchangerate-api error: ${body["error-type"] ?? "unknown"}`);
    }

    return body.conversion_rates ?? {};
  }
}

/**
 * Build the live adapter from the environment (the worker's production wiring).
 * The key is read lazily here — never at module load — so unit tests that import
 * the class never need a key, and a missing key fails loudly at startup rather
 * than silently 401-ing every conversion (ADR-0013: such failures only log).
 */
export function exchangerateApiProviderFromEnv(): ExchangerateApiProvider {
  const apiKey = process.env.EXCHANGERATE_API_KEY;
  if (!apiKey) {
    throw new Error("EXCHANGERATE_API_KEY is not set");
  }
  return new ExchangerateApiProvider({ apiKey });
}
