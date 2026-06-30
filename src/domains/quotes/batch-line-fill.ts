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

// The raw form values for all six batch groups, held in the entry session's
// transient UI state (ADR-0038). Shared by the Drafts-surface panel and the Quote
// Group Collect dealer step so the two surfaces present one field shape.
export interface BatchGroupValues {
  competitorBrand: string;
  stockStatus: string;
  leadTimeValue: string;
  leadTimeUnit: string;
  warrantyOffered: string;
  warranty1Value: string;
  warranty1Unit: string;
  warranty2Value: string;
  warranty2Unit: string;
  landedCostIncluded: string;
  landedCostNote: string;
  discountAvailable: string;
  discountType: string;
  discountApplied: string;
  discountValue: string;
}

/** A pristine batch-group form state — every group empty. Both batch surfaces
 *  (the Drafts panel and the Collect dealer step) start their UI state from this. */
export const emptyBatchGroupValues: BatchGroupValues = {
  competitorBrand: "",
  stockStatus: "",
  leadTimeValue: "",
  leadTimeUnit: "",
  warrantyOffered: "",
  warranty1Value: "",
  warranty1Unit: "",
  warranty2Value: "",
  warranty2Unit: "",
  landedCostIncluded: "",
  landedCostNote: "",
  discountAvailable: "",
  discountType: "",
  discountApplied: "",
  discountValue: "",
};

// Merge all six groups into the single QuoteLineFields the Collect dealer step
// stamps onto EACH line at creation (ADR-0038, #141). Spreads the same per-group
// builders the Drafts panel uses, so a create-time stamp can never diverge from a
// per-group apply. The Landed Cost group is included ONLY when the document is
// cross-border (`showLandedCost`) — domestically the field is absent, exactly as the
// entry form unmounts it (ADR-0035); its value is then never stamped. Empty fields
// stamp `null` (empty-is-clear, ADR-0036), harmless on a fresh blank line.
export function batchStampFields(v: BatchGroupValues, showLandedCost: boolean): QuoteLineFields {
  return {
    ...brandGroup(v.competitorBrand),
    ...stockStatusGroup(v.stockStatus),
    ...leadTimeGroup(v.leadTimeValue, v.leadTimeUnit),
    ...warrantyGroup(v.warrantyOffered, v.warranty1Value, v.warranty1Unit, v.warranty2Value, v.warranty2Unit),
    ...(showLandedCost ? landedCostGroup(v.landedCostIncluded, v.landedCostNote) : {}),
    ...discountGroup(v.discountAvailable, v.discountType, v.discountApplied, v.discountValue),
  };
}

// The Competitor brand group (ADR-0039): the one competitor field uniform across a
// document (CONTEXT), so it batches; `competitorPartNumber`/`competitorPartDescription`
// stay per-line identity and are never batched. A free-text value, mapped like the
// other text groups (discountType/landedCostNote) — empty ⇒ null (clear-all), no trim.
export function brandGroup(value: string): QuoteLineFields {
  return { competitorBrand: value === "" ? null : value };
}

/** The stock-status group: a single nullable select. Empty ⇒ clear-all. */
export function stockStatusGroup(value: string): QuoteLineFields {
  return { stockStatus: value === "" ? null : value };
}

// A value+unit pair group (lead time, and each warranty pair under warrantyGroup —
// #129/ADR-0036). Each half is independent: empty ⇒ null (clear that half), so a
// half-filled pair can be stamped and is caught by the existing document-submit gate
// (ADR-0034/0035), not by batch. The value groups at rest unit-agnostically like a
// warranty value, so strip the thousands commas before the bare number is stored
// (matching the single-line `warrantyValue` parser in quote-line-form.ts).
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

// The Warranty chain (ADR-0037): one Yes/No Offered? gate over BOTH value+unit pairs,
// mirroring the discount chain's gate-owns-coherence shape. When Offered is not Yes,
// the builder clears the gate (null when blank, else false) AND nulls all four pair
// fields, so a "No" line can never carry a stale warranty — ignoring whatever the
// panel inputs still held. Under Yes it stamps the gate true and each pair through
// `pairGroup` (a half pair is stampable, caught by the submit gate, not here). The
// editor and panel render this same single gate, so the two surfaces never diverge.
export function warrantyGroup(
  offered: string,
  w1Value: string,
  w1Unit: string,
  w2Value: string,
  w2Unit: string,
): QuoteLineFields {
  if (offered !== "true") {
    return {
      warrantyOffered: offered === "" ? null : false,
      warranty1Value: null,
      warranty1Unit: null,
      warranty2Value: null,
      warranty2Unit: null,
    };
  }
  return {
    warrantyOffered: true,
    ...pairGroup("warranty1Value", "warranty1Unit", w1Value, w1Unit),
    ...pairGroup("warranty2Value", "warranty2Unit", w2Value, w2Unit),
  };
}

// The Landed Cost chain (#130 / ADR-0035): a tri-state Included? gating an optional
// Note. The builder owns chain coherence so a stamped chain is always valid — the
// Note rides along ONLY when Included? = Yes, and is cleared for No/blank, ignoring
// any note text the panel still held. Empty Included? clears the whole group (null),
// per ADR-0036's empty-is-clear contract; the submit gate catches a now-blank
// required field, not batch. `included` is the form tri-state ("" / "true" / "false").
export function landedCostGroup(included: string, note: string): QuoteLineFields {
  if (included !== "true") {
    return {
      landedCostIncluded: included === "" ? null : false,
      landedCostNote: null,
    };
  }
  return { landedCostIncluded: true, landedCostNote: note === "" ? null : note };
}

// The Discount chain (#131 / ADR-0036): Available? gates the free-text Type + the
// Applied? flag; Applied? gates the % value. The builder owns chain coherence so a
// stamped chain is always valid: Type rides under Available (kept even when not
// applied — CONTEXT captures the kind of discount on offer regardless), the % rides
// under Applied, and any child below a non-Yes parent is cleared (null), ignoring
// stale panel text. A blank Available clears the whole chain (empty-is-clear,
// ADR-0036). `available`/`applied` are the form tri-states ("" / "true" / "false");
// the % is recorded as typed (15 = 15%), never applied to the price (ADR-0026).
export function discountGroup(
  available: string,
  type: string,
  applied: string,
  value: string,
): QuoteLineFields {
  if (available !== "true") {
    return {
      discountAvailable: available === "" ? null : false,
      discountType: null,
      discountApplied: null,
      discountValue: null,
    };
  }
  return {
    discountAvailable: true,
    discountType: type === "" ? null : type,
    discountApplied: applied === "" ? null : applied === "true",
    discountValue: applied === "true" && value !== "" ? Number(value) : null,
  };
}
