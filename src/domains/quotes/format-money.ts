// Minor-unit-aware money display (ADR-0033). One shared formatter for every
// in-app monetary amount: Intl already knows each ISO 4217 code's minor units
// (USD 2, JPY 0, BHD 3), so no lookup table is needed. Exports are deliberately
// excluded — they mirror the legacy artifact's whole-number `#,##0` shape
// (ADR-0029). No framework, DB, or network imports.

import { isValidCurrency } from "./currencies";

/** Em-dash shown for a null/absent monetary amount (ADR-0033). */
export const NO_AMOUNT = "—";

/**
 * A draft document may not have a currency set yet (the header picker offers a
 * blank option), so every formatter here can be reached with an empty/absent
 * code. `Intl.NumberFormat({ style: "currency" })` throws a RangeError on a
 * blank or non-ISO-4217 code, so callers screen the code first and fall back to
 * a symbol-less decimal. We reuse the canonical ISO 4217 check so the formatter
 * accepts exactly the codes the picker and repository validate against.
 */
function isCurrencyCode(currency: string | null | undefined): currency is string {
  return typeof currency === "string" && isValidCurrency(currency);
}

/**
 * Group an editable money input at rest (ADR-0033 amendment): thousands separators
 * and the currency's ISO 4217 minor units, but **no symbol** — an input box holds a
 * bare number, not a currency string (`28,911.32`, not `$28,911.32`). Used at the
 * input's initial value and on blur; a null/absent amount renders blank, never the
 * read-only em-dash. The minor-unit count is read off a currency formatter so it
 * tracks USD 2 / JPY 0 / BHD 3 without a lookup table.
 */
export function formatMoneyInput(
  amount: number | string | null | undefined,
  currency: string,
): string {
  if (amount === null || amount === undefined || amount === "") return "";
  const value = typeof amount === "string" ? Number(amount) : amount;
  // No currency yet → group as a plain decimal; minor units are unknowable
  // without a code, so let Intl pick (mirrors the read-only bare-number fallback).
  if (!isCurrencyCode(currency)) {
    return new Intl.NumberFormat("en-US", { style: "decimal" }).format(value);
  }
  const dp =
    new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(value);
}

/**
 * Strip thousands separators from an editable money input before it is
 * `Number()`-parsed (ADR-0033 amendment). The app pins `en-US` everywhere, so a
 * comma is unambiguously a thousands separator, never a decimal — stripping every
 * comma can't corrupt the value. Lenient: mis-grouped input is left for the
 * caller's numeric validation to reject, not validated for grouping shape.
 */
export function parseMoneyInput(raw: string): string {
  return raw.replace(/,/g, "");
}

export function formatMoney(
  amount: number | string | null | undefined,
  currency: string,
): string {
  if (amount === null || amount === undefined || amount === "") return NO_AMOUNT;
  const value = typeof amount === "string" ? Number(amount) : amount;
  // No currency yet → show the bare grouped number rather than throwing.
  if (!isCurrencyCode(currency)) {
    return new Intl.NumberFormat("en-US", { style: "decimal" }).format(value);
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}
