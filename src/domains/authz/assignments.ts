// Pure decision core — no framework, DB, or network imports.
//
// Country-assignment authorization (issue #6). Assigning researchers to a
// Country is part of *running* a study, which CONTEXT.md reserves for the
// Engagement Manager — deliberately NARROWER than the adjacent setup rules
// (`canCreateStudy`, `canImportBenchmarkItems`), which are shared EM+Analyst.
// CONTEXT.md draws exactly this line: study *creation/setup* is shared, but
// *running* a study stays the EM's job. The Admin is user-administration only,
// and a client user is viewer-only and can never assign. Like every write rule
// it is role-gated, not tenant-filtered: internal staff have no tenant, so the
// target study is an explicit input resolved through the tenant-scoped repo.

import type { Principal } from "./principal";

export function canAssignResearchers(principal: Principal): boolean {
  return principal.kind === "internal" && principal.role === "EngagementManager";
}
