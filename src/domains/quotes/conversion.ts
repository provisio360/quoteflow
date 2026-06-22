// Pure currency-conversion core (#9) — no framework, DB, or network imports.
//
// Three layers, smallest to largest (ADR-0004):
//   1. convert()              — pure sync money math: local price × pinned rate.
//   2. resolveExchangeRate()  — async nearest-prior walk-back over a RateProvider
//                               port. No I/O of its own; testable with the fake.
//   3. computeConversion()    — composes (1) and (2) into the shape the submit
//                               wiring (#11) will persist on a Quote.
//
// What this slice does NOT do: touch the real provider (#10) or wire conversion
// into the submit transition (#11). It defines the seam and pins the rules.

import type { RateProvider } from "./rate-provider";

/**
 * Where a Quote's conversion stands (CONTEXT.md: Conversion Status). `pending`
 * carries no USD figures and blocks analyst approval (#11); `auto`/`manual` both
 * carry pinned figures and differ only in provenance. The fourth state,
 * "unconverted" (a Draft), is represented by a null status column, not here.
 */
export type ConversionStatus = "pending" | "auto" | "manual";

/** How many calendar days back resolveExchangeRate probes before giving up. A
 *  closed market (weekend + holiday run) is covered well inside this; a currency
 *  the provider genuinely doesn't cover falls through to `pending` → manual. */
export const MAX_LOOKBACK_DAYS = 7;

/**
 * Round a money figure to 4 decimal places, half-up. The SINGLE rounding point
 * in the core: every USD figure passes through here, so the codebase's
 * number-for-money convention (repository surfaces Decimal as Number) stays
 * consistent and is swappable to a decimal library later if precision bites.
 * `Number.EPSILON` nudges the classic 1.005-style float wart toward the intended
 * half-up result.
 */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4;
}

/** The two derived USD figures on a Quote (CONTEXT.md: Converted USD Price). */
export interface ConvertedUsd {
  readonly convertedUsdPrice: number;
  /** Null when quantity is missing or non-positive (divide-by-zero guard). */
  readonly convertedUsdPricePerUnit: number | null;
}

/**
 * Pure money math: local price × pinned rate → USD, and that total ÷ quantity →
 * per-unit. Status-agnostic — both the auto and manual paths call it. Per-unit
 * is derived from the ROUNDED total so the two stored figures stay internally
 * consistent (perUnit × qty ≈ total). Quantity ≤ 0 (or null) yields a null
 * per-unit rather than dividing by zero.
 */
export function convert(
  price: number,
  quantityQuoted: number | null,
  rate: number,
): ConvertedUsd {
  const convertedUsdPrice = roundMoney(price * rate);
  const convertedUsdPricePerUnit =
    quantityQuoted !== null && quantityQuoted > 0
      ? roundMoney(convertedUsdPrice / quantityQuoted)
      : null;
  return { convertedUsdPrice, convertedUsdPricePerUnit };
}

/** The found rate and the date it is actually FOR (the prior business day on
 *  closures), or a signal that nothing exists within the look-back window. */
export type RateResolution =
  | { readonly ok: true; readonly rate: number; readonly rateDate: Date }
  | { readonly ok: false; readonly reason: "no-rate-in-window" };

/** Step one calendar day back from `date` (UTC), without mutating the input. */
function priorDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/**
 * Resolve the historical rate for `targetDate`, walking back to the nearest
 * prior date the provider has data for (ADR-0004: nearest-prior-business-day on
 * closures, storing the date used). "Closed" is data-driven — a null from the
 * port — so no holiday calendar is needed (ADR-0012). Bounded by MAX_LOOKBACK_DAYS.
 *
 * USD short-circuits to rate 1 on `targetDate` WITHOUT calling the provider.
 * A thrown provider error is NOT caught here — it propagates so the caller can
 * distinguish outage (pending) from "no rate in a reachable window".
 */
export async function resolveExchangeRate(
  provider: RateProvider,
  currency: string,
  targetDate: Date,
  maxLookbackDays: number = MAX_LOOKBACK_DAYS,
): Promise<RateResolution> {
  const code = currency.trim().toUpperCase();
  if (code === "USD") {
    return { ok: true, rate: 1, rateDate: targetDate };
  }

  let date = targetDate;
  // Probe targetDate plus up to maxLookbackDays prior days (inclusive).
  for (let i = 0; i <= maxLookbackDays; i++) {
    const rate = await provider.rateFor(code, date);
    if (rate !== null) {
      return { ok: true, rate, rateDate: date };
    }
    date = priorDay(date);
  }
  return { ok: false, reason: "no-rate-in-window" };
}

/** The fields a converted Quote pins; `status` distinguishes provenance. */
export interface PinnedConversion extends ConvertedUsd {
  readonly status: "auto" | "manual";
  readonly exchangeRate: number;
  readonly rateDate: Date;
}

/** What computeConversion returns: a pinned conversion, or pending (no USD). */
export type ConversionResult =
  | { readonly status: "pending" }
  | PinnedConversion;

/** The Quote fields conversion reads — primitives only, so the core never
 *  imports Prisma. The repository maps a Quote row to this shape. */
export interface ConvertibleQuote {
  readonly price: number;
  readonly currency: string;
  readonly quantityQuoted: number | null;
  readonly dateQuoteReceived: Date;
}

/**
 * Compose resolve + convert into the shape the submit wiring (#11) persists.
 * The auto path: resolve the rate, then derive USD and tag `auto`. Both failure
 * modes collapse to `pending` (ADR-0004 / CONTEXT.md: Conversion Status):
 *   - provider unreachable (rateFor throws) → pending, retried by #10's job
 *   - no rate within the look-back window  → pending, resolved by manual override
 * USD figures are absent while pending, so #11's approval gate has nothing to
 * approve until the rate lands.
 */
export async function computeConversion(
  quote: ConvertibleQuote,
  provider: RateProvider,
): Promise<ConversionResult> {
  let resolution: RateResolution;
  try {
    resolution = await resolveExchangeRate(
      provider,
      quote.currency,
      quote.dateQuoteReceived,
    );
  } catch {
    return { status: "pending" };
  }
  if (!resolution.ok) {
    return { status: "pending" };
  }
  return {
    status: "auto",
    exchangeRate: resolution.rate,
    rateDate: resolution.rateDate,
    ...convert(quote.price, quote.quantityQuoted, resolution.rate),
  };
}

/**
 * The events that move a Market Quote's Conversion Status (CONTEXT.md: Conversion
 * Status). `submit` is the bulk Draft→Submitted move; `autoResolved` is the worker
 * pinning a provider rate; `manualSet` is the analyst's override.
 */
export type ConversionEvent =
  | { readonly kind: "submit" }
  | { readonly kind: "autoResolved" }
  | { readonly kind: "manualSet" };

/** The status of a Market Quote's conversion, including the unconverted (null) state. */
export type ConversionStatusState = ConversionStatus | null;

/** What `nextConversionStatus` returns: the resulting status and whether it changed
 *  (so a caller can skip a no-op write), or an illegal transition. */
export type ConversionStatusResult =
  | { readonly ok: true; readonly status: ConversionStatus; readonly changed: boolean }
  | { readonly ok: false; readonly reason: "illegal-transition" };

/**
 * The Conversion Status machine (CONTEXT.md: Conversion Status, ADR-0026). One
 * place owns the invariant **null ⇔ not-yet-submitted; once submitted, pending →
 * auto/manual**, and the stickiness of a resolved rate.
 *
 *   - submit:       null → pending. Already pending/auto/manual ⇒ sticky no-op
 *                   (a revised line resubmitted into a converted document never
 *                   re-pins — ADR-0028), so the status is kept and `changed` is false.
 *   - autoResolved: pending → auto. Anything else is illegal (the worker only acts
 *                   on a pending document, and never overwrites a manual rate).
 *   - manualSet:    pending → manual. Anything else is illegal (a non-pending
 *                   document is not awaiting an override — #70's `not-pending`).
 */
export function nextConversionStatus(
  current: ConversionStatusState,
  event: ConversionEvent,
): ConversionStatusResult {
  switch (event.kind) {
    case "submit":
      if (current === null) return { ok: true, status: "pending", changed: true };
      return { ok: true, status: current, changed: false };
    case "autoResolved":
      if (current === "pending") return { ok: true, status: "auto", changed: true };
      return { ok: false, reason: "illegal-transition" };
    case "manualSet":
      if (current === "pending") return { ok: true, status: "manual", changed: true };
      return { ok: false, reason: "illegal-transition" };
  }
}

/** A validated manual rate, or a rejection (non-numeric / non-positive input). */
export type ParsedManualRate =
  | { readonly ok: true; readonly rate: number }
  | { readonly ok: false };

/**
 * Validate an analyst-entered exchange rate (#70) before it reaches convertManual.
 * Accepts a number or a numeric string (trimmed); rejects anything non-finite or
 * non-positive — a rate must be a real, strictly-positive multiplier. Pure, so the
 * rule is unit-testable without the DB; the repository composes parse → convert.
 */
export function parseManualRate(input: string | number): ParsedManualRate {
  const rate = typeof input === "string" ? Number(input.trim()) : input;
  if (!Number.isFinite(rate) || rate <= 0) return { ok: false };
  return { ok: true, rate };
}

/**
 * The analyst's manual override for a currency the provider doesn't cover
 * (ADR-0004). Pure: same math as the auto path, tagged `manual`, pinned with
 * `rateDate = the Quote's dateQuoteReceived` — the rate is still "as of the
 * quote's date", just hand-sourced. Override provenance (who/when) lives in the
 * audit log (#16), not here.
 */
export function convertManual(
  quote: ConvertibleQuote,
  rate: number,
): PinnedConversion {
  return {
    status: "manual",
    exchangeRate: rate,
    rateDate: quote.dateQuoteReceived,
    ...convert(quote.price, quote.quantityQuoted, rate),
  };
}
