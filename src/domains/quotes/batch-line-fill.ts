import type { QuoteLineFields } from "@/lib/quotes/repository";
import { parseMoneyInput } from "@/domains/quotes/format-money";

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

// A value+unit pair group (lead time, warranty 1, warranty 2 — #129/ADR-0036).
// Each half is independent: empty ⇒ null (clear that half), so a half-filled pair
// can be stamped and is caught by the existing document-submit gate (ADR-0034/0035),
// not by batch. The value groups at rest unit-agnostically like a warranty value, so
// strip the thousands commas before the bare number is stored (matching the single-
// line `warrantyValue` parser in quote-line-form.ts).
function pairGroup(
  valueKey: keyof QuoteLineFields,
  unitKey: keyof QuoteLineFields,
  rawValue: string,
  rawUnit: string,
): QuoteLineFields {
  const stripped = parseMoneyInput(rawValue.trim());
  return {
    [valueKey]: stripped === "" ? null : Number(stripped),
    [unitKey]: rawUnit === "" ? null : rawUnit,
  };
}

/** The Shipping Lead Time pair (ADR-0035). */
export function leadTimeGroup(value: string, unit: string): QuoteLineFields {
  return pairGroup("leadTimeValue", "leadTimeUnit", value, unit);
}

/** The Warranty 1 pair (ADR-0034). */
export function warranty1Group(value: string, unit: string): QuoteLineFields {
  return pairGroup("warranty1Value", "warranty1Unit", value, unit);
}

/** The Warranty 2 pair (ADR-0034). */
export function warranty2Group(value: string, unit: string): QuoteLineFields {
  return pairGroup("warranty2Value", "warranty2Unit", value, unit);
}
