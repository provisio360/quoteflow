// Pure decision core — no framework, DB, or network imports.
//
// Quote authorization (issue #8). Collecting quotes is a Researcher act
// (CONTEXT.md: Researcher; "A Researcher enters a Quote") — narrower than the
// EM+Analyst setup capabilities. The role is gated here; the further "must be in
// the item's Country pool" rule is a data-membership check the repository runs
// (mirroring self-assign), not a pure role decision. Owner-only editing/submit
// is likewise a per-row runtime check (createdById === userId), not a role.

import type { Principal } from "./principal";

/**
 * May this principal create a Quote at all? Researchers only. Pool membership
 * for the specific item is checked at the data layer. The role gate is kept
 * explicit (defense-in-depth) so a future loosening of the pool invariant can't
 * silently let other roles collect quotes.
 */
export function canCreateQuote(principal: Principal): boolean {
  return principal.kind === "internal" && principal.role === "Researcher";
}
