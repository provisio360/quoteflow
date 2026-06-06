import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ExchangerateApiProvider,
  exchangerateApiProviderFromEnv,
} from "./exchangerate-api-provider";

// A canned exchangerate-api v6 /history success body: conversion_rates are
// "units of X per 1 USD" (base USD), so EUR 0.92 means 0.92 EUR per 1 USD.
function successResponse(rates: Record<string, number>): Response {
  return new Response(
    JSON.stringify({ result: "success", base_code: "USD", conversion_rates: rates }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

// A canned exchangerate-api v6 error body. The vendor returns these as JSON;
// status varies (e.g. 404 for no-data, 403 for auth), so the adapter keys off
// `error-type`, not the HTTP code.
function errorResponse(errorType: string, status = 404): Response {
  return new Response(JSON.stringify({ result: "error", "error-type": errorType }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function provider(fetch: ReturnType<typeof vi.fn>): ExchangerateApiProvider {
  return new ExchangerateApiProvider({
    apiKey: "test-key",
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
}

describe("ExchangerateApiProvider.rateFor", () => {
  it("calls the /history endpoint for the exact UTC date and returns USD-per-unit (inverted)", async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse({ EUR: 0.92, USD: 1 }));
    const provider = new ExchangerateApiProvider({
      apiKey: "test-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const rate = await provider.rateFor("EUR", new Date("2026-06-01T00:00:00Z"));

    // 0.92 EUR per USD → 1/0.92 USD per EUR.
    expect(rate).toBeCloseTo(1 / 0.92, 10);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = String(fetch.mock.calls[0][0]);
    expect(url).toBe(
      "https://v6.exchangerate-api.com/v6/test-key/history/USD/2026/6/1",
    );
  });

  it("returns null when the provider has no data for the date (walk back)", async () => {
    const fetch = vi.fn().mockResolvedValue(errorResponse("no-data-available"));

    const rate = await provider(fetch).rateFor("EUR", new Date("2026-06-01T00:00:00Z"));

    expect(rate).toBeNull();
  });

  it("returns null when the currency is absent from a successful table (uncovered → manual)", async () => {
    // A successful response that simply doesn't list the requested currency.
    const fetch = vi.fn().mockResolvedValue(successResponse({ EUR: 0.92, USD: 1 }));

    const rate = await provider(fetch).rateFor("XYZ", new Date("2026-06-01T00:00:00Z"));

    expect(rate).toBeNull();
  });

  it.each(["invalid-key", "inactive-account", "quota-reached", "plan-upgrade-required"])(
    "throws on the operational error-type %s (stays pending, retried next sweep)",
    async (errorType) => {
      const fetch = vi.fn().mockResolvedValue(errorResponse(errorType, 403));

      await expect(
        provider(fetch).rateFor("EUR", new Date("2026-06-01T00:00:00Z")),
      ).rejects.toThrow(errorType);
    },
  );

  it("throws on a 5xx with a non-JSON body (server outage → pending)", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response("Service Unavailable", { status: 503 }),
    );

    await expect(
      provider(fetch).rateFor("EUR", new Date("2026-06-01T00:00:00Z")),
    ).rejects.toThrow(/503/);
  });

  it("propagates a network failure as a throw (unreachable → pending)", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      provider(fetch).rateFor("EUR", new Date("2026-06-01T00:00:00Z")),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("aborts and throws when the request exceeds the timeout", async () => {
    vi.useFakeTimers();
    try {
      // A fetch that never settles on its own, but rejects when its signal aborts.
      const fetch = vi.fn(
        (_url: string, opts?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            opts?.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }),
      );
      const pending = new ExchangerateApiProvider({
        apiKey: "test-key",
        fetch: fetch as unknown as typeof globalThis.fetch,
        timeoutMs: 5000,
      }).rateFor("EUR", new Date("2026-06-01T00:00:00Z"));

      const assertion = expect(pending).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches one /history table per date, serving every currency from it", async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse({ EUR: 0.92, GBP: 0.79, USD: 1 }));
    const p = provider(fetch);
    const date = new Date("2026-06-01T00:00:00Z");

    const eur = await p.rateFor("EUR", date);
    const gbp = await p.rateFor("GBP", date);

    expect(eur).toBeCloseTo(1 / 0.92, 10);
    expect(gbp).toBeCloseTo(1 / 0.79, 10);
    // Both currencies came from a single date-keyed call (base USD covers all).
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed fetch — a later sweep can retry the same date", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(successResponse({ EUR: 0.92, USD: 1 }));
    const p = provider(fetch);
    const date = new Date("2026-06-01T00:00:00Z");

    await expect(p.rateFor("EUR", date)).rejects.toThrow("ECONNREFUSED");
    const retry = await p.rateFor("EUR", date);

    expect(retry).toBeCloseTo(1 / 0.92, 10);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("exchangerateApiProviderFromEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws a clear error when EXCHANGERATE_API_KEY is unset", () => {
    vi.stubEnv("EXCHANGERATE_API_KEY", "");
    expect(() => exchangerateApiProviderFromEnv()).toThrow(/EXCHANGERATE_API_KEY/);
  });

  it("builds a provider from the environment key", () => {
    vi.stubEnv("EXCHANGERATE_API_KEY", "live-key");
    expect(exchangerateApiProviderFromEnv()).toBeInstanceOf(ExchangerateApiProvider);
  });
});
