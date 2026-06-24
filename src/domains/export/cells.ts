// Pure cell-rendering conventions shared by both export shapes (ADR-0029).
// The example artifacts render booleans as "Yes"/"No" and not-applicable
// dependent fields as the literal "N/A"; these helpers keep that convention in
// one place so the Internal and Client builders agree byte-for-byte with the
// real workbooks. No framework, DB, or library imports.

import type { Cell } from "./workbook";

/** A boolean flag column (e.g. Paper Quote, Discount Available): "Yes"/"No". A
 *  null/absent flag reads "No" — the artifact never leaves these cells blank. */
export function yesNo(flag: boolean | null | undefined): Cell {
  return flag === true ? "Yes" : "No";
}

/** A field that is only applicable when a parent flag is on (e.g. Discount Type
 *  when a discount was applied, the Landed Cost Note when landed cost is
 *  included): the literal "N/A" when the parent is off, else the value. */
export function naWhenOff(parentOn: boolean | null | undefined, value: Cell): Cell {
  return parentOn === true ? value : "N/A";
}

/** The single legacy "Source Location" cell, composed from the split dealer
 *  locality + Dealer Country (ADR-0032): `"locality, Country"` when both present,
 *  the lone part when only one is, blank (null) when neither — legacy rows with
 *  neither. Each part is trimmed and blank-after-trim counts as absent, so a stray
 *  `""`/whitespace never produces a dangling comma. */
export function composeSourceLocation(
  locality: string | null | undefined,
  country: string | null | undefined,
): Cell {
  const parts = [locality, country]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(", ") : null;
}
