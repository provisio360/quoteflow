// Pure view-logic core for the Quote entry/edit Stock Status picker (ADR-0022:
// thin components, decisions live here where they can be tested). Mirrors the
// currency picker's forward-only tolerance — a legacy free-text value is offered
// as-is rather than rejected, until the researcher changes it.

import type { PickerOption } from "./quote-currency-picker";

/** The canonical Stock Status values a Researcher records, stored verbatim. */
export const STOCK_STATUS_VALUES = ["In stock", "Out of stock"] as const;

const STOCK_STATUS_OPTIONS: readonly PickerOption[] = STOCK_STATUS_VALUES.map((v) => ({
  value: v,
  label: v,
}));

/**
 * The `<option>`s for the Stock Status picker. Always the two canonical values; a
 * non-empty prefilled value that isn't one of them is prepended as a selectable
 * option so a legacy free-text status round-trips an edit untouched. The value is
 * trimmed before matching, so `"In stock "` is treated as canonical (no duplicate).
 */
export function stockStatusOptions(prefilled: string | null | undefined): PickerOption[] {
  const raw = (prefilled ?? "").trim();
  if (raw !== "" && !STOCK_STATUS_VALUES.includes(raw as (typeof STOCK_STATUS_VALUES)[number])) {
    return [{ value: raw, label: raw }, ...STOCK_STATUS_OPTIONS];
  }
  return [...STOCK_STATUS_OPTIONS];
}
