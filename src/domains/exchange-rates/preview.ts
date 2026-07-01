// Pure entry-time preview view-model over the shared study-rate lookup (#162,
// ADR-0041) — no framework, DB, or network imports. Wraps `decideStudyRatePin`
// (never duplicates the rule) so the entry preview the researcher sees is decided
// exactly as the submit-time pin, keeping preview == pinned. The live price×rate
// math is NOT here — the server resolves this view-model once per document
// (currency + Date Quote Received are fixed while entering lines) and the client
// multiplies by the live price/quantity via `convert()`.

import { decideStudyRatePin, type StudyRateRow } from "./lookup";

const MS_PER_DAY = 86_400_000;

/**
 * What the entry form shows for a document's conversion, before any pin:
 * - `hit`  — a table row covers the currency/date; show live USD-per-unit plus
 *            the picked row's rate, `rateDate`, and whole-day age (staleness is
 *            visible, not blocking — ADR-0041).
 * - `usd`  — a USD document (rate ≡ 1): show live USD-per-unit, no warning, no
 *            row (USD is never a table hit — ADR-0041).
 * - `miss` — non-USD currency the table doesn't cover: warn, show no number.
 */
export type StudyRatePreview =
  | { readonly kind: "hit"; readonly rate: string; readonly rateDate: Date; readonly ageDays: number }
  | { readonly kind: "usd" }
  | { readonly kind: "miss" };

/**
 * Decide the entry-time preview for a document. `rowsForCurrency` are this study's
 * rows already filtered to the document's currency; `now` supplies the clock for
 * the age (injected so the pure fn stays deterministic under test). Age is whole
 * calendar days floored from the `rateDate → now` span.
 */
export function studyRatePreview(
  currency: string,
  dateQuoteReceived: Date,
  rowsForCurrency: readonly StudyRateRow[],
  now: Date,
): StudyRatePreview {
  if (currency.trim().toUpperCase() === "USD") return { kind: "usd" };

  const pin = decideStudyRatePin(currency, dateQuoteReceived, rowsForCurrency);
  if (!pin.hit) return { kind: "miss" };

  const ageDays = Math.floor((now.getTime() - pin.rateDate.getTime()) / MS_PER_DAY);
  return { kind: "hit", rate: pin.rate, rateDate: pin.rateDate, ageDays };
}
