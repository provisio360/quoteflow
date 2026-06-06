// Pure decision core — no framework, DB, or network imports.
//
// The Quote Lifecycle state machine (issues #8, #11). The four states a Quote
// moves through — Draft → Submitted → Approved/Rejected — plus the Rejected →
// Draft revise loop are modeled here (CONTEXT.md: Quote Lifecycle). Every legal
// move is one edge in `transition`; an undefined (state, event) pair is rejected
// as an illegal transition, never silently allowed.
//
// The edges:
//   - submit  (Draft → Submitted):     GUARDED by required-to-submit fields (#8).
//   - approve (Submitted → Approved):  GUARDED — blocked while conversion is
//                                       pending, and (if flagged) until a
//                                       Justification is present (ADR-0014).
//   - reject  (Submitted → Rejected):  GUARDED by a non-blank reason.
//   - revise  (Rejected → Draft):      the author's return path; author identity
//                                       is checked at the data layer, not here.
//
// Guard INPUTS are primitives carried on the event, so the core imports no
// Prisma: the repository computes the flag (price-flag.ts) and conversion status
// and hands the booleans in.

import type { ConversionStatus } from "./conversion";

/** Every state a Quote can occupy (CONTEXT.md: Quote Lifecycle). */
export type QuoteState = "Draft" | "Submitted" | "Approved" | "Rejected";

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

/**
 * The events that drive transitions, each carrying its own guard inputs. A
 * discriminated union keeps every edge's data separate instead of one fat
 * context object: submit needs the Draft's fields; approve needs the conversion
 * status plus whether the quote is flagged and justified; reject needs a reason;
 * revise needs nothing the core decides on.
 */
export type QuoteEvent =
  | { readonly kind: "submit"; readonly quote: SubmittableQuote }
  | {
      readonly kind: "approve";
      readonly conversionStatus: ConversionStatus | null;
      readonly flagged: boolean;
      readonly hasJustification: boolean;
    }
  | { readonly kind: "reject"; readonly reason: string | null }
  | { readonly kind: "revise" };

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
    }
  | { readonly ok: false; readonly reason: "conversion-pending" }
  | { readonly ok: false; readonly reason: "needs-justification" }
  | { readonly ok: false; readonly reason: "missing-reason" };

/** A string field counts as present only when it is non-null and not blank. */
function hasText(value: string | null): boolean {
  return value !== null && value.trim() !== "";
}

/**
 * Apply an event to a Quote's state. The whole v1 transition table lives here:
 * each legal edge is one branch with its guard, and every other (state, event)
 * pair falls through to `illegal-transition`.
 */
export function transition(from: QuoteState, event: QuoteEvent): TransitionResult {
  switch (event.kind) {
    case "submit": {
      if (from !== "Draft") return { ok: false, reason: "illegal-transition" };
      const missing = missingRequiredFields(event.quote);
      if (missing.length > 0) return { ok: false, reason: "missing-fields", missing };
      return { ok: true, state: "Submitted" };
    }
    case "approve": {
      if (from !== "Submitted") return { ok: false, reason: "illegal-transition" };
      // No USD figure yet ⇒ cannot approve (ADR-0013). `pending` and the
      // defensive `null` (which should never reach a Submitted quote) both block.
      if (event.conversionStatus === "pending" || event.conversionStatus === null) {
        return { ok: false, reason: "conversion-pending" };
      }
      // A flagged quote needs the author's Justification first (ADR-0014). The
      // flag is advisory otherwise — a justified flagged quote may be approved.
      if (event.flagged && !event.hasJustification) {
        return { ok: false, reason: "needs-justification" };
      }
      return { ok: true, state: "Approved" };
    }
    case "reject": {
      if (from !== "Submitted") return { ok: false, reason: "illegal-transition" };
      if (!hasText(event.reason)) return { ok: false, reason: "missing-reason" };
      return { ok: true, state: "Rejected" };
    }
    case "revise": {
      if (from !== "Rejected") return { ok: false, reason: "illegal-transition" };
      return { ok: true, state: "Draft" };
    }
  }
}
