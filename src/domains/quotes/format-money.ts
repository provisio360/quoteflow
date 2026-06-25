// Minor-unit-aware money display (ADR-0033). One shared formatter for every
// in-app monetary amount: Intl already knows each ISO 4217 code's minor units
// (USD 2, JPY 0, BHD 3), so no lookup table is needed. Exports are deliberately
// excluded — they mirror the legacy artifact's whole-number `#,##0` shape
// (ADR-0029). No framework, DB, or network imports.

/** Em-dash shown for a null/absent monetary amount (ADR-0033). */
export const NO_AMOUNT = "—";

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
  const dp =
    new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(typeof amount === "string" ? Number(amount) : amount);
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
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    typeof amount === "string" ? Number(amount) : amount,
  );
}
