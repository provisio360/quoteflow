// Provider selection and outcome messaging for the deferred FX sweep, including
// the explicitly-flagged provider-disabled operating mode (ADR-0043).
//
// ADR-0041 routes USD documents and every study-table MISS to the ADR-0013
// `pending → auto` sweep. That assumes the sweep can run — but the live adapter's
// `exchangerateApiProviderFromEnv()` throws when the key is unset, before
// computeConversion's USD short-circuit runs, so the whole fallback (USD included)
// jams. This module makes "provider off" a first-class, flagged mode: the sweep
// still runs against a NullRateProvider, USD resolves to `auto` (its rate is a
// deterministic 1, needing no provider), and non-USD stays `pending` until an
// analyst manual override (ADR-0023) or the provider is switched on.

import type { RateProvider } from "./rate-provider";
import { exchangerateApiProviderFromEnv } from "./exchangerate-api-provider";

/**
 * A RateProvider that has no rate for anything — every probe is a miss. USD still
 * resolves because `resolveExchangeRate` short-circuits it to rate 1 WITHOUT
 * calling the provider; a non-USD currency exhausts the walk-back into `pending`,
 * identical to today's "uncovered currency" outcome (ADR-0043).
 */
export class NullRateProvider implements RateProvider {
  async rateFor(_currency: string, _date: Date): Promise<number | null> {
    return null;
  }
}

/** The provider a sweep run should use, plus whether it is the disabled mode (so
 *  the caller logs the degraded run at info rather than the missing-key error). */
export interface SweepProvider {
  readonly provider: RateProvider;
  readonly disabled: boolean;
}

/**
 * Pick the sweep's provider from the environment (ADR-0043). `FX_PROVIDER_DISABLED
 * = "true"` is the EXPLICIT opt-in to provider-disabled mode: it uses the
 * NullRateProvider and never reads the key, so an intentional gap is silent about
 * a key it doesn't need. Otherwise the live adapter is built, which still throws
 * loudly on a missing key — an accidental misconfiguration stays an error, not a
 * silent degrade.
 */
export function resolveSweepProvider(): SweepProvider {
  if (process.env.FX_PROVIDER_DISABLED === "true") {
    return { provider: new NullRateProvider(), disabled: true };
  }
  return { provider: exchangerateApiProviderFromEnv(), disabled: false };
}

/** A secondary log line describing a sweep run's outcome, or null when the base
 *  scanned/resolved line already says everything worth saying. */
export type SweepAlert = { readonly level: "info" | "error"; readonly message: string };

/**
 * Decide the intent-aware alert for a completed sweep (ADR-0043). In disabled mode
 * a run that touched documents is logged at INFO — non-USD staying `pending` is the
 * designed behaviour, not a fault. In live mode, documents scanned but NONE resolved
 * is the signature of a dead key / blown quota / inactive account, logged at ERROR
 * (ADR-0013: the pending count is the signal; v1 logs only). Everything else — a
 * clean run, an empty scan, or a live partial resolve — needs no extra line.
 */
export function describeSweepAlert(input: {
  readonly disabled: boolean;
  readonly scanned: number;
  readonly resolved: number;
  readonly stillPending: number;
}): SweepAlert | null {
  const { disabled, scanned, resolved, stillPending } = input;
  if (scanned === 0) return null;
  if (disabled) {
    return {
      level: "info",
      message: `fill_pending_conversions: provider disabled — ${resolved} USD resolved, ${stillPending} awaiting rate`,
    };
  }
  if (resolved === 0) {
    return {
      level: "error",
      message: `fill_pending_conversions: ${scanned} pending quote(s) but none resolved — check EXCHANGERATE_API_KEY, quota, and account status`,
    };
  }
  return null;
}
