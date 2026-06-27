import type { QuoteLineFields } from "@/lib/quotes/repository";

// Pure per-group builders for batch line-fill (#128 / ADR-0036). Each turns a
// group's raw form value(s) into the partial QuoteLineFields the batch writer
// stamps onto every Draft line. Kept separate from the client component so the
// empty-is-blank contract can be unit-tested without React.
//
// A per-group apply is TOTAL (overwrite-all): an empty value CLEARS the field on
// every line, so empty maps to `null` (stamp blank). This diverges on purpose from
// the single-line entry parser (`str()` in quote-line-form.ts), where an empty
// field is `undefined` (omit — a partial edit leaves untouched fields alone).

/** The stock-status group: a single nullable select. Empty ⇒ clear-all. */
export function stockStatusGroup(value: string): QuoteLineFields {
  return { stockStatus: value === "" ? null : value };
}
