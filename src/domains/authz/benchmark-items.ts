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
