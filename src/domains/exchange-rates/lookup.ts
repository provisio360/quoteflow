// Pure decision core for the study-rate lookup (#161, ADR-0041) — no framework,
// DB, or network imports. The SINGLE shared rule used both at entry (live USD
// preview) and at submit (the `study-rate` pin), so preview always equals pinned.
//
// Given a document's currency and its Date Quote Received, take this study's row
// for that currency with the greatest `rateDate ≤ Date Quote Received` — the
// nearest prior seeded row, however old. No rolling window and no study-start
// floor (the Study has no start date; the earliest seeded row is the effective
// floor). Never reach forward to a later row. USD is never a hit — it converts
// 1:1 and routes to the provider/`pending` path (grilling Q6). The `rate` stays
// a decimal STRING end-to-end (Decimal(18,8) exceeds float-safe precision).

/** One study rate row projected for the lookup — its calendar day and value. */
export interface StudyRateRow {
  readonly rateDate: Date;
  readonly rate: string;
}

/** A table hit (a row to pin) or a miss (route to the provider/`pending` path). */
export type StudyRatePin =
  | { readonly hit: true; readonly rate: string; readonly rateDate: Date }
  | { readonly hit: false };

/**
 * Decide whether a document pins from the study table at submit. `rowsForCurrency`
 * are this study's rows already filtered to the document's currency; the function
 * is a pure nearest-prior search over them. USD short-circuits to a miss (rate ≡ 1,
 * never a table row). Staleness never changes the verdict — an old winning row is
 * still a hit; its age is surfaced elsewhere, not blocking here.
 */
export function decideStudyRatePin(
  currency: string,
  dateQuoteReceived: Date,
  rowsForCurrency: readonly StudyRateRow[],
): StudyRatePin {
  if (currency.trim().toUpperCase() === "USD") return { hit: false };

  let best: StudyRateRow | null = null;
  for (const row of rowsForCurrency) {
    if (row.rateDate.getTime() > dateQuoteReceived.getTime()) continue; // never forward.
    if (best === null || row.rateDate.getTime() > best.rateDate.getTime()) best = row;
  }
  if (best === null) return { hit: false };
  return { hit: true, rate: best.rate, rateDate: best.rateDate };
}
