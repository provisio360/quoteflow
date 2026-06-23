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
