import { describe, it, expect, afterEach, vi } from "vitest";
import { ExchangerateApiProvider } from "./exchangerate-api-provider";
import { NullRateProvider, resolveSweepProvider, describeSweepAlert } from "./fx-sweep";

describe("NullRateProvider", () => {
  it("returns null for any currency and date (a table miss on every probe)", async () => {
    const provider = new NullRateProvider();

    expect(await provider.rateFor("EUR", new Date("2026-06-01T00:00:00Z"))).toBeNull();
    expect(await provider.rateFor("COP", new Date("2020-01-01T00:00:00Z"))).toBeNull();
  });
});

describe("resolveSweepProvider", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the NullRateProvider in provider-disabled mode, without needing a key", () => {
    vi.stubEnv("FX_PROVIDER_DISABLED", "true");
    vi.stubEnv("EXCHANGERATE_API_KEY", ""); // deliberately absent — must not throw.

    const resolved = resolveSweepProvider();

    expect(resolved.disabled).toBe(true);
    expect(resolved.provider).toBeInstanceOf(NullRateProvider);
  });

  it("builds the live provider when the flag is off and a key is set", () => {
    vi.stubEnv("EXCHANGERATE_API_KEY", "live-key");

    const resolved = resolveSweepProvider();

    expect(resolved.disabled).toBe(false);
    expect(resolved.provider).toBeInstanceOf(ExchangerateApiProvider);
  });

  it("still throws on a missing key when NOT in disabled mode (accidental misconfig)", () => {
    vi.stubEnv("EXCHANGERATE_API_KEY", "");

    expect(() => resolveSweepProvider()).toThrow(/EXCHANGERATE_API_KEY/);
  });
});

describe("describeSweepAlert", () => {
  it("logs an info line in disabled mode, reporting USD resolved vs awaiting", () => {
    const alert = describeSweepAlert({ disabled: true, scanned: 5, resolved: 2, stillPending: 3 });

    expect(alert?.level).toBe("info");
    expect(alert?.message).toContain("provider disabled");
    expect(alert?.message).toContain("2 USD resolved");
    expect(alert?.message).toContain("3 awaiting rate");
  });

  it("logs an error in live mode when documents were scanned but none resolved", () => {
    const alert = describeSweepAlert({ disabled: false, scanned: 4, resolved: 0, stillPending: 4 });

    expect(alert?.level).toBe("error");
    expect(alert?.message).toContain("EXCHANGERATE_API_KEY");
  });

  it("stays silent in live mode on a partial resolve (uncovered currencies are normal)", () => {
    expect(describeSweepAlert({ disabled: false, scanned: 4, resolved: 3, stillPending: 1 })).toBeNull();
  });

  it("stays silent when nothing was scanned (nothing to report)", () => {
    expect(describeSweepAlert({ disabled: true, scanned: 0, resolved: 0, stillPending: 0 })).toBeNull();
    expect(describeSweepAlert({ disabled: false, scanned: 0, resolved: 0, stillPending: 0 })).toBeNull();
  });
});
