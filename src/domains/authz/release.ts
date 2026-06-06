// Pure decision core — no framework, DB, or network imports.
//
// Country release authorization (issue #13). Releasing a Country's approved
// quotes to the client — and reopening one — is the Analyst's act (PRD #25/#27;
// CONTEXT.md: Released). Like reviewing quotes, it is NOT tenant-scoped: an
// Analyst works across every tenant. The Engagement Manager runs the study but
// does not control the release moment; the Admin is user-administration only.

import type { Principal } from "./principal";

/**
 * May this principal release or reopen a Country? Analysts only — mirroring
 * canReviewQuote. The precondition (Release Eligibility) is a separate, data-
 * level gate the repository enforces; this is only the role decision.
 */
export function canReleaseCountry(principal: Principal): boolean {
  return principal.kind === "internal" && principal.role === "Analyst";
}
