// Pure decision core — no framework, DB, or network imports.
//
// The Quote Lifecycle state machine (issue #8). The four states a Quote moves
// through — Draft → Submitted → Approved/Rejected — are modeled here, but only
// the move a researcher makes, Draft → Submitted, is a legal transition in v1
// (CONTEXT.md: Quote Lifecycle). The analyst verdicts (Approved/Rejected) are
// the same machine's later edges (#11), not yet wired.
//
// Submit is a GUARDED transition: a Draft can only become Submitted once every
// required-to-submit field is present. That validation lives here (the issue's
// "submit-time validation"), so the rules are exhaustively unit-testable with no
// row and no database.

/** Every state a Quote can occupy (CONTEXT.md: Quote Lifecycle). */
export type QuoteState = "Draft" | "Submitted" | "Approved" | "Rejected";

/** The events that drive transitions. Only `submit` exists in v1. */
export type QuoteEvent = "submit";

/** The fields the submit guard inspects — primitives only, so the core never
 *  imports Prisma. The repository maps a Quote row to this shape. Optional Quote
 *  fields are omitted: they never gate submit. */
export interface SubmittableQuote {
  readonly competitorBrand: string | null;
  readonly dealerName: string | null;
  readonly dealerLocation: string | null;
  readonly price: number | null;
  readonly currency: string | null;
  readonly quantityQuoted: number | null;
  readonly dateQuoteReceived: Date | null;
}

/** The fields that must be present to leave Draft (grilling for #8). Optional
 *  competitive context (dealerUrl, stockStatus, leadTime, warranty, discount,
 *  notes) is deliberately not here — it never gates submit. */
export const REQUIRED_TO_SUBMIT = [
  "competitorBrand",
  "dealerName",
  "dealerLocation",
  "price",
  "currency",
  "quantityQuoted",
  "dateQuoteReceived",
] as const;

export type RequiredField = (typeof REQUIRED_TO_SUBMIT)[number];

/**
 * The required-to-submit fields a Quote is still missing, in declaration order.
 * Exported standalone so a UI can preview "what's left" without attempting a
 * transition. A field is "missing" when null; a string field is also missing
 * when blank or whitespace-only.
 */
export function missingRequiredFields(quote: SubmittableQuote): RequiredField[] {
  return REQUIRED_TO_SUBMIT.filter((field) => {
    const value = quote[field];
    if (value === null) return true;
    if (typeof value === "string") return value.trim() === "";
    return false;
  });
}

export type TransitionResult =
  | { readonly ok: true; readonly state: QuoteState }
  | { readonly ok: false; readonly reason: "illegal-transition" }
  | {
      readonly ok: false;
      readonly reason: "missing-fields";
      readonly missing: readonly RequiredField[];
    };

/**
 * Apply an event to a Quote's state. The only legal edge in v1 is
 * Draft —submit→ Submitted, and it is GUARDED: the Draft must carry every
 * required-to-submit field. Every other (state, event) pair is rejected as an
 * illegal transition.
 */
export function transition(
  from: QuoteState,
  event: QuoteEvent,
  quote: SubmittableQuote,
): TransitionResult {
  // The whole v1 transition table: exactly one legal edge. New edges (the
  // analyst's approve/reject) are added here in #11, not by loosening the guard.
  if (from === "Draft" && event === "submit") {
    const missing = missingRequiredFields(quote);
    if (missing.length > 0) return { ok: false, reason: "missing-fields", missing };
    return { ok: true, state: "Submitted" };
  }
  return { ok: false, reason: "illegal-transition" };
}
