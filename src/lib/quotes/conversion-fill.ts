import { prisma } from "@/lib/prisma";
import type { RateProvider } from "@/domains/quotes/rate-provider";
import {
  computeConversion,
  convertManual,
  type ConvertibleQuote,
} from "@/domains/quotes/conversion";

// The deferred-conversion sweep (#10, ADR-0013 / ADR-0026). Submit leaves a
// MARKET QUOTE `pending`; this pins ONE rate per document once its Date Quote
// Received has closed, and derives every line's USD from that single rate. Thin
// glue: the decision logic (resolve the rate, or stay pending) lives in the pure
// core's computeConversion; convertManual reuses the same math to spread the one
// document rate across the lines.
//
// Runs in the BACKGROUND WORKER, a cross-tenant system actor on the OWNER
// connection, which bypasses the RLS backstop by design (ADR-0021). It therefore
// uses `prisma` directly with no tenant GUC. IMPORTANT: the worker's environment
// must NOT set APP_DATABASE_URL — connecting as the non-owner role here would
// make this sweep silently see zero documents (fail-closed). See the #21 runbook.

export interface FillSummary {
  /** Pending Market Quotes whose date had closed and were attempted this run. */
  readonly scanned: number;
  /** How many were resolved to a pinned `auto` conversion. */
  readonly resolved: number;
  /** How many remain pending (no rate yet, provider down, or uncovered currency). */
  readonly stillPending: number;
}

/** UTC midnight of `now`'s date — the cutoff a document's date must be strictly before. */
function utcStartOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Resolve every pending Market Quote conversion whose Date Quote Received has fully
 * closed, pinning one rate per document and deriving each line's USD from it.
 *
 * Selection (ADR-0013): only `pending` documents dated strictly before today (UTC)
 * — a same-day document's historical rate isn't published yet. `auto`/`manual`
 * documents are never touched (a manual override is sticky). The per-document
 * update is guarded on `conversionStatus = pending` so a manual override that races
 * in during the sweep is not clobbered.
 *
 * `computeConversion` collapses every failure (provider down, no rate in window,
 * uncovered currency) to `pending`, so those documents are simply left for the next
 * sweep — this function never throws on a single document's FX outcome.
 */
export async function fillPendingConversions(
  provider: RateProvider,
  now: Date = new Date(),
): Promise<FillSummary> {
  const cutoff = utcStartOfDay(now);
  const documents = await prisma.marketQuote.findMany({
    where: {
      conversionStatus: "pending",
      dateQuoteReceived: { lt: cutoff },
    },
    select: {
      id: true,
      currency: true,
      dateQuoteReceived: true,
      quoteLines: { select: { id: true, price: true, quantityQuoted: true } },
    },
  });

  let resolved = 0;
  for (const doc of documents) {
    if (doc.quoteLines.length === 0) continue; // nothing to convert.
    // Resolve the document's one rate via a representative line. Submitted ⇒
    // currency/date are present (REQUIRED_TO_SUBMIT, validated per line at submit).
    const representative: ConvertibleQuote = {
      price: Number(doc.quoteLines[0].price),
      currency: doc.currency as string,
      quantityQuoted: doc.quoteLines[0].quantityQuoted,
      dateQuoteReceived: doc.dateQuoteReceived as Date,
    };
    const result = await computeConversion(representative, provider);
    if (result.status === "pending") {
      continue; // left for the next sweep.
    }

    // Spread the one pinned rate across every line (same math as a manual rate).
    const lineUpdates = doc.quoteLines.map((line) => {
      const pinned = convertManual(
        {
          price: Number(line.price),
          currency: doc.currency as string,
          quantityQuoted: line.quantityQuoted,
          dateQuoteReceived: doc.dateQuoteReceived as Date,
        },
        Number(result.exchangeRate),
      );
      return prisma.quoteLine.update({
        where: { id: line.id },
        data: {
          convertedUsdPrice: pinned.convertedUsdPrice,
          convertedUsdPricePerUnit: pinned.convertedUsdPricePerUnit,
        },
      });
    });

    const applied = await prisma.marketQuote.updateMany({
      where: { id: doc.id, conversionStatus: "pending" },
      data: {
        conversionStatus: result.status, // "auto"
        exchangeRate: result.exchangeRate,
        rateDate: result.rateDate,
      },
    });
    if (applied.count !== 1) continue; // raced with a manual override; skip line writes.
    await Promise.all(lineUpdates);
    resolved += 1;
  }

  return {
    scanned: documents.length,
    resolved,
    stillPending: documents.length - resolved,
  };
}
