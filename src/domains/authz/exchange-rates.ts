// Pure decision core — no framework, DB, or network imports.
//
// Study Exchange Rate authorization (#160, ADR-0041). Edit authority is the
// study-setup pair — Engagement Manager + Analyst — for BOTH read and write:
// Researchers are read-only and reach this data only through later conversion
// slices, and the Admin (user-administration only) and Client Users never touch
// it. The same predicate guards the page, the reads and the writes, so they
// cannot drift.

import type { Principal } from "./principal";

/** Who may read or write a study's Study Exchange Rate table. */
export function canManageStudyRates(principal: Principal): boolean {
  return (
    principal.kind === "internal" &&
    (principal.role === "EngagementManager" || principal.role === "Analyst")
  );
}
