import { prisma } from "@/lib/prisma";
import type { RateProvider } from "@/domains/quotes/rate-provider";
import {
  computeConversion,
  type ConvertibleQuote,
} from "@/domains/quotes/conversion";

// The deferred-conversion sweep (#10, ADR-0013). Submit leaves every Quote
// `pending`; this fills the USD figures once the quote's date has closed. Thin
// glue: the decision logic (resolve + convert, or stay pending) lives in the
// pure core's computeConversion — here we only select, call, and persist.

export interface FillSummary {
  /** Pending quotes whose date had closed and were attempted this run. */
  readonly scanned: number;
  /** How many were resolved to a pinned `auto` conversion. */
  readonly resolved: number;
  /** How many remain pending (no rate yet, provider down, or uncovered currency). */
  readonly stillPending: number;
}

/** UTC midnight of `now`'s date — the cutoff a quote's date must be strictly before. */
function utcStartOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Resolve every pending conversion whose Date Quote Received has fully closed.
 *
 * Selection (ADR-0013): only `Submitted` + `pending` quotes dated strictly before
 * today (UTC) — a same-day quote's historical rate isn't published yet, and
 * attempting it would wrongly pin the prior day's rate via the walk-back. `auto`
 * and `manual` rows are never touched (a manual override is sticky). The
 * per-quote update is guarded on `conversionStatus = pending` so a manual
 * override that races in during the sweep is not clobbered.
 *
 * `computeConversion` collapses every failure (provider down, no rate in window,
 * uncovered currency) to `pending`, so those quotes are simply left for the next
 * sweep — this function never throws on a single quote's FX outcome.
 */
export async function fillPendingConversions(
  provider: RateProvider,
  now: Date = new Date(),
): Promise<FillSummary> {
  const cutoff = utcStartOfDay(now);
  const quotes = await prisma.quote.findMany({
    where: {
      state: "Submitted",
      conversionStatus: "pending",
      dateQuoteReceived: { lt: cutoff },
    },
    select: {
      id: true,
      price: true,
      currency: true,
      quantityQuoted: true,
      dateQuoteReceived: true,
    },
  });

  let resolved = 0;
  for (const q of quotes) {
    // Submitted ⇒ price/currency/dateQuoteReceived are present (REQUIRED_TO_SUBMIT).
    const convertible: ConvertibleQuote = {
      price: Number(q.price),
      currency: q.currency as string,
      quantityQuoted: q.quantityQuoted,
      dateQuoteReceived: q.dateQuoteReceived as Date,
    };
    const result = await computeConversion(convertible, provider);
    if (result.status === "pending") {
      continue; // left for the next sweep.
    }
    await prisma.quote.updateMany({
      where: { id: q.id, conversionStatus: "pending" },
      data: {
        conversionStatus: result.status, // "auto"
        exchangeRate: result.exchangeRate,
        rateDate: result.rateDate,
        convertedUsdPrice: result.convertedUsdPrice,
        convertedUsdPricePerUnit: result.convertedUsdPricePerUnit,
      },
    });
    resolved += 1;
  }

  return {
    scanned: quotes.length,
    resolved,
    stillPending: quotes.length - resolved,
  };
}
