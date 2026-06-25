// Pure view-logic core for the Quote entry/edit Shipping Lead Time Unit picker
// (ADR-0022: thin components, decisions live here where they can be tested). Mirrors
// the warranty Unit picker's forward-only tolerance — a legacy free-text unit is
// offered as-is rather than rejected, until the researcher changes it. The unit
// pairs with a numeric lead-time value; pair-completeness gates submit (ADR-0035).

import type { PickerOption } from "./quote-currency-picker";

/** The canonical Shipping Lead Time unit vocabulary a Researcher records, stored
 *  verbatim. Shipping-oriented (days/weeks/months), distinct from the warranty
 *  vocabulary, and exported faithfully. */
export const LEAD_TIME_UNIT_VALUES = ["days", "weeks", "months"] as const;

const LEAD_TIME_UNIT_OPTIONS: readonly PickerOption[] = LEAD_TIME_UNIT_VALUES.map((v) => ({
  value: v,
  label: v,
}));

/**
 * The `<option>`s for a Shipping Lead Time Unit picker. Always the canonical
 * vocabulary; a non-empty prefilled value that isn't one of them is prepended as a
 * selectable option so a legacy free-text unit round-trips an edit untouched. The
 * value is trimmed before matching, so `"days "` is treated as canonical.
 */
export function leadTimeUnitOptions(prefilled: string | null | undefined): PickerOption[] {
  const raw = (prefilled ?? "").trim();
  if (raw !== "" && !LEAD_TIME_UNIT_VALUES.includes(raw as (typeof LEAD_TIME_UNIT_VALUES)[number])) {
    return [{ value: raw, label: raw }, ...LEAD_TIME_UNIT_OPTIONS];
  }
  return [...LEAD_TIME_UNIT_OPTIONS];
}
