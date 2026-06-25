// Pure decision core — no framework, DB, or network imports.
//
// The analyst's in-app Client Price edit (issue #12 / ADR-0015). Client Price is
// seeded by the brief but owned by the analyst thereafter; this validates the
// value the analyst types. A blank input CLEARS it (null) — returning the item
// to "unpriced" and therefore not comparable for the Price Flag (ADR-0014). A
// present value must be a number > 0, mirroring the brief import's rule so the
// two entry paths can never disagree.

import { parseMoneyInput } from "../quotes/format-money";

export type ClientPriceParse =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly message: string };

/** Validate raw form input into a Client Price: a positive number, or null to clear. */
export function parseClientPrice(raw: string): ClientPriceParse {
  const trimmed = parseMoneyInput(raw.trim());
  if (trimmed === "") return { ok: true, value: null };

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, message: "Client Price must be a number greater than 0" };
  }
  return { ok: true, value };
}
