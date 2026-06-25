// Minor-unit-aware money display (ADR-0033). One shared formatter for every
// in-app monetary amount: Intl already knows each ISO 4217 code's minor units
// (USD 2, JPY 0, BHD 3), so no lookup table is needed. Exports are deliberately
// excluded — they mirror the legacy artifact's whole-number `#,##0` shape
// (ADR-0029). No framework, DB, or network imports.

/** Em-dash shown for a null/absent monetary amount (ADR-0033). */
export const NO_AMOUNT = "—";

export function formatMoney(
  amount: number | string | null | undefined,
  currency: string,
): string {
  if (amount === null || amount === undefined || amount === "") return NO_AMOUNT;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    typeof amount === "string" ? Number(amount) : amount,
  );
}
