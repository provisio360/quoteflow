// Pure view-logic core for the Quote entry/edit pickers (ADR-0032, ADR-0022).
// Components stay thin; the picker decisions live here where they can be tested.

import { ISO_4217_CURRENCIES, isValidCurrency, defaultCurrencyForCountry } from "./currencies";
import { canonicalCountry } from "../benchmark-items/countries";

export interface PickerOption {
  readonly value: string;
  readonly label: string;
}

const CURRENCY_OPTIONS: readonly PickerOption[] = ISO_4217_CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} — ${c.name}`,
}));

/**
 * The `<option>`s for the currency picker. Always the full ISO 4217 list; a
 * non-empty prefilled value that isn't a known code is prepended as a selectable
 * option so a legacy free-text currency round-trips (ADR-0032 forward-only
 * tolerance — tolerated, not rejected, until the researcher changes it).
 */
export function currencyOptions(prefilled: string | null | undefined): PickerOption[] {
  const raw = (prefilled ?? "").trim();
  if (raw !== "" && !isValidCurrency(raw)) {
    return [{ value: raw, label: raw }, ...CURRENCY_OPTIONS];
  }
  return [...CURRENCY_OPTIONS];
}

/**
 * The currency to apply when the Dealer Country changes: that country's default,
 * always (the override is a deliberate post-selection act — ADR-0032). A blank
 * placeholder or any value that isn't a canonical country name yields `null`, so
 * the caller leaves the current currency untouched.
 */
export function defaultCurrencyOnCountryChange(country: string): string | null {
  const canonical = canonicalCountry(country);
  return canonical === null ? null : defaultCurrencyForCountry(canonical);
}
