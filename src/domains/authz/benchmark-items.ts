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

// Whether a principal may use the researcher collection surfaces (Collect / Drafts
// / Needs attention; ADR-0038) — a Researcher act, narrower than import (EM+Analyst
// setup). Claiming a Benchmark Item is no longer a distinct user action: a lead is
// established implicitly on first line-filing (ADR-0038), so this gate names the
// researcher capability itself, not a self-assign step. Per CONTEXT.md, the Primary
// Researcher of an item is always a Researcher.
export function canResearch(principal: Principal): boolean {
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

// VIEWING Client Price is broader than maintaining it (issue #72 / ADR-0024).
// The Engagement Manager may *see* Client Price (it appears in the Internal
// Export they may run) but may not *edit* it — only the Analyst owns the value
// (ADR-0015). This predicate names that read boundary, used to gate the
// audit-log view (whose clientPriceChange events carry the value) and its link.
// Never a Researcher (Client Price is hidden from them to avoid biasing quotes,
// ADR-0003) and never the Admin (user-administration only) or a client user.
export function canViewClientPrice(principal: Principal): boolean {
  return (
    principal.kind === "internal" &&
    (principal.role === "Analyst" || principal.role === "EngagementManager")
  );
}
