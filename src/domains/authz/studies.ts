// Pure decision core — no framework, DB, or network imports.
//
// Study-specific authorization rules. Tenant-isolation on READS is the generic
// primitive in ./visibility; this file holds the resource-specific role policy
// for the WRITE path.

import type { Principal } from "./principal";

/**
 * Who may create a Pricing Study. Creation is a shared internal-setup capability
 * held by Engagement Managers and Analysts (CONTEXT.md / grilling Q5) — distinct
 * from *running* a study, which stays the Engagement Manager's job. The Admin is
 * deliberately excluded (user-administration only), and a client user is
 * viewer-only and can never create.
 *
 * Note the asymmetry with reads: creation is role-gated, not tenant-filtered —
 * internal staff have no tenant, so the target Client is an explicit input, not
 * derived from the creator.
 */
export function canCreateStudy(principal: Principal): boolean {
  return (
    principal.kind === "internal" &&
    (principal.role === "EngagementManager" || principal.role === "Analyst")
  );
}
