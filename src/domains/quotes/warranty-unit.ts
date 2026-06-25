// Pure view-logic core for the Quote entry/edit warranty Unit picker (ADR-0022:
// thin components, decisions live here where they can be tested). Mirrors the
// Stock Status picker's forward-only tolerance — a legacy free-text unit is
// offered as-is rather than rejected, until the researcher changes it. The unit
// pairs with a numeric warranty value; pair-completeness gates submit (ADR-0034).

import type { PickerOption } from "./quote-currency-picker";

/** The canonical warranty unit vocabulary a Researcher records, stored verbatim
 *  (the mixed plural "hours" vs singular "year"/"month"/"day" is intentional and
 *  exported faithfully — ADR-0034). */
export const WARRANTY_UNIT_VALUES = ["hours", "year", "month", "day"] as const;

const WARRANTY_UNIT_OPTIONS: readonly PickerOption[] = WARRANTY_UNIT_VALUES.map((v) => ({
  value: v,
  label: v,
}));

/**
 * The `<option>`s for a warranty Unit picker. Always the canonical vocabulary; a
 * non-empty prefilled value that isn't one of them is prepended as a selectable
 * option so a legacy free-text unit round-trips an edit untouched. The value is
 * trimmed before matching, so `"hours "` is treated as canonical (no duplicate).
 */
export function warrantyUnitOptions(prefilled: string | null | undefined): PickerOption[] {
  const raw = (prefilled ?? "").trim();
  if (raw !== "" && !WARRANTY_UNIT_VALUES.includes(raw as (typeof WARRANTY_UNIT_VALUES)[number])) {
    return [{ value: raw, label: raw }, ...WARRANTY_UNIT_OPTIONS];
  }
  return [...WARRANTY_UNIT_OPTIONS];
}
