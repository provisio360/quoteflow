// Pure decision core — no framework, DB, or network imports.
//
// Benchmark Item authorization. Importing items into a study is an internal
// SETUP capability, held by the same roles that may create a study — Engagement
// Managers and Analysts (CONTEXT.md; grilling for issue #5). The Admin is
// user-administration only, and a client user is viewer-only and can never
// write. Like all write rules, this is role-gated, not tenant-filtered: internal
// staff have no tenant, so the target study is an explicit input resolved
// through the tenant-scoped repository (ADR-0008).

import type { Principal } from "./principal";

export function canImportBenchmarkItems(principal: Principal): boolean {
  return (
    principal.kind === "internal" &&
    (principal.role === "EngagementManager" || principal.role === "Analyst")
  );
}

// Self-assigning a Benchmark Item (becoming its Primary Researcher; issue #7) is
// a Researcher act — narrower than import, which is EM+Analyst setup. The role is
// gated explicitly even though only Researchers are ever in a Country pool (the
// repository's membership check would imply it): defense-in-depth, so a future
// loosening of the pool invariant can't silently let other roles claim a lead.
// Per CONTEXT.md, the Primary Researcher of an item is always a Researcher.
export function canSelfAssignBenchmarkItem(principal: Principal): boolean {
  return principal.kind === "internal" && principal.role === "Researcher";
}

// Maintaining a Benchmark Item's Client Price (issue #12) is an Analyst-only QC
// act — narrower than import (EM+Analyst). The brief only *seeds* the value;
// thereafter the Analyst, who runs quality checks and reads the resulting Price
// Flag, owns it (ADR-0015). It is deliberately NOT given to the EM (who runs the
// study) and never to a Researcher, from whom Client Price is hidden to avoid
// biasing their quotes (ADR-0003). Role-gated, not tenant-filtered: the target
// item is resolved through the tenant-scoped repository (ADR-0008).
export function canMaintainClientPrice(principal: Principal): boolean {
  return principal.kind === "internal" && principal.role === "Analyst";
}
