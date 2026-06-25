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
import { landedCostApplies } from "./landed-cost";

/** Every state a Quote can occupy (CONTEXT.md: Quote Lifecycle). */
export type QuoteState = "Draft" | "Submitted" | "Approved" | "Rejected";

/**
 * The events that drive a single line's verdict/revise transitions, each carrying
 * its own guard inputs. Submit is NOT here — it is the document-level bulk
 * transition (`submitDocument`), the only bulk move (ADR-0026). approve needs the
 * conversion status plus whether the line is flagged and justified; reject needs a
 * reason; revise needs nothing the core decides on.
 */
export type QuoteEvent =
  | {
      readonly kind: "approve";
      readonly conversionStatus: ConversionStatus | null;
      readonly flagged: boolean;
      readonly hasJustification: boolean;
    }
  | { readonly kind: "reject"; readonly reason: string | null }
  | { readonly kind: "revise" };

// --- Bulk submit over a Market Quote document (ADR-0026) ---------------------
//
// Submit is the ONE bulk transition: a researcher submits a whole document and
// all its Draft lines move together, ALL-OR-NOTHING (CONTEXT.md: Quote Lifecycle).
// The guard splits required-to-submit into the document's shared facts (validated
// ONCE — a missing currency fails every line) and each line's own facts.

/** The Market Quote's shared facts every line inherits at submit. */
export interface DocumentHeader {
  readonly sourceName: string | null;
  readonly sourceCountry: string | null;
  readonly sourceLocality: string | null;
  readonly currency: string | null;
  readonly dateQuoteReceived: Date | null;
}

/** A line the bulk submit considers: its state plus its own required-to-submit
 *  facts, plus the value+unit pairs and the landed-cost flag. Most optional context
 *  never gates, but three things conditionally do: a warranty pair (ADR-0034) and the
 *  shipping lead time pair (ADR-0035) gate on coherence — a value with no unit, or a
 *  unit with no value, blocks submit; and Landed Cost's Included? flag is required
 *  when the document is cross-border (Dealer Country differs from market Country,
 *  ADR-0035). Presence is never forced — a line with none of these submits fine. */
export interface SubmittableLine {
  readonly lineId: string;
  readonly state: QuoteState;
  readonly competitorBrand: string | null;
  readonly price: number | null;
  readonly quantityQuoted: number | null;
  readonly warranty1Value: number | null;
  readonly warranty1Unit: string | null;
  readonly warranty2Value: number | null;
  readonly warranty2Unit: string | null;
  // Shipping Lead Time is a value + unit pair, gated on coherence like warranty
  // (ADR-0035). Landed Cost's Included? flag is conditionally required (cross-border).
  readonly leadTimeValue: number | null;
  readonly leadTimeUnit: string | null;
  readonly landedCostIncluded: boolean | null;
}

/** The value+unit pairs gated on coherence, each [value field, unit field]: the two
 *  warranties (ADR-0034) and the shipping lead time (ADR-0035). A pair is incoherent
 *  when exactly one half is set; the absent half is reported as missing. */
const VALUE_UNIT_PAIRS = [
  ["warranty1Value", "warranty1Unit"],
  ["warranty2Value", "warranty2Unit"],
  ["leadTimeValue", "leadTimeUnit"],
] as const;

export type PairField = (typeof VALUE_UNIT_PAIRS)[number][number];

/** Document-level required-to-submit fields (validated once for the whole doc). */
export const DOC_REQUIRED_TO_SUBMIT = [
  "sourceName",
  "sourceCountry",
  "sourceLocality",
  "currency",
  "dateQuoteReceived",
] as const;

/** Per-line required-to-submit fields. */
export const LINE_REQUIRED_TO_SUBMIT = ["competitorBrand", "price", "quantityQuoted"] as const;

export type DocRequiredField = (typeof DOC_REQUIRED_TO_SUBMIT)[number];
export type LineRequiredField = (typeof LINE_REQUIRED_TO_SUBMIT)[number];
export type BulkRequiredField = DocRequiredField | LineRequiredField;

/** One incomplete line and what it still lacks: required doc/line fields plus, for
 *  a half-filled value+unit pair, the absent half's field (ADR-0034/0035). */
/** The conditionally-required Landed Cost Included? flag (ADR-0035), reported like a
 *  missing field when a cross-border document leaves it unanswered. */
export type LandedCostField = "landedCostIncluded";

export interface IncompleteLine {
  readonly lineId: string;
  readonly missing: readonly (BulkRequiredField | PairField | LandedCostField)[];
}

export type SubmitDocumentResult =
  | { readonly ok: true; readonly toSubmit: readonly string[] }
  | { readonly ok: false; readonly reason: "no-draft-lines" }
  | { readonly ok: false; readonly reason: "lines-incomplete"; readonly perLine: readonly IncompleteLine[] };

function missingValue(value: string | number | Date | null): boolean {
  if (value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

/** The absent half of any half-filled value+unit pair on a line. A pair is coherent
 *  when both halves are present or both absent; when exactly one is set, the other
 *  is reported missing (ADR-0034/0035). A whole-empty pair contributes nothing. */
function incompletePairHalves(line: SubmittableLine): PairField[] {
  const out: PairField[] = [];
  for (const [valueField, unitField] of VALUE_UNIT_PAIRS) {
    const hasValue = !missingValue(line[valueField]);
    const hasUnit = !missingValue(line[unitField]);
    if (hasValue && !hasUnit) out.push(unitField);
    else if (hasUnit && !hasValue) out.push(valueField);
  }
  return out;
}

/**
 * Decide a Market Quote's bulk submit. Targets only the document's Draft lines;
 * non-Draft siblings (a Submitted/Approved/Rejected line from a prior revise loop)
 * are untouched. ALL-OR-NOTHING: if any Draft line is missing a required-to-submit
 * field (its own OR an inherited document field), nothing submits and every
 * incomplete line is reported with what it lacks. A document with no Draft lines
 * yields `no-draft-lines` rather than a silent no-op.
 */
export function submitDocument(input: {
  readonly header: DocumentHeader;
  // The market Country the document prices. Optional: when given and it differs from
  // the Dealer Country, Landed Cost becomes required on every line (ADR-0035).
  readonly marketCountry?: string | null;
  readonly lines: readonly SubmittableLine[];
}): SubmitDocumentResult {
  const drafts = input.lines.filter((line) => line.state === "Draft");
  if (drafts.length === 0) return { ok: false, reason: "no-draft-lines" };

  // The shared document fields are missing for every line at once.
  const docMissing = DOC_REQUIRED_TO_SUBMIT.filter((field) => missingValue(input.header[field]));

  // Landed Cost is a cross-border conditional (ADR-0035): only when the part crosses
  // a border (Dealer Country differs from market Country) must every line answer
  // Included? (Yes/No) — a document-level condition enforced per line.
  const landedCostRequired = landedCostApplies(input.header.sourceCountry, input.marketCountry);

  const perLine: IncompleteLine[] = [];
  for (const line of drafts) {
    const lineMissing = LINE_REQUIRED_TO_SUBMIT.filter((field) => missingValue(line[field]));
    const landedCostMissing: LandedCostField[] =
      landedCostRequired && line.landedCostIncluded === null ? ["landedCostIncluded"] : [];
    const missing = [...docMissing, ...lineMissing, ...incompletePairHalves(line), ...landedCostMissing];
    if (missing.length > 0) perLine.push({ lineId: line.lineId, missing });
  }
  if (perLine.length > 0) return { ok: false, reason: "lines-incomplete", perLine };

  return { ok: true, toSubmit: drafts.map((line) => line.lineId) };
}

export type TransitionResult =
  | { readonly ok: true; readonly state: QuoteState }
  | { readonly ok: false; readonly reason: "illegal-transition" }
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
