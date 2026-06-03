import { redirect } from "next/navigation";
import { getCurrentPrincipal } from "./current-principal";
import { isInternal, type InternalPrincipal } from "@/domains/authz/principal";

// Page-level auth guards for Server Components (issue #24). Distinct from the
// *throwing* `require*` helpers in current-principal.ts (which suit server
// actions / route handlers): a page wants a redirect, not a 500. Following
// ADR-0008's ethos, an authenticated-but-unauthorised principal is bounced to
// login rather than shown a 403 — we never confirm "this exists but isn't yours".

/**
 * Gate a page to internal staff. Unauthenticated *or* a Client User both
 * redirect to /login (no leak about what lies beyond). Returns the
 * InternalPrincipal for the page to use; role-specific affordances (e.g. the
 * Import control) are decided per-screen from the returned role.
 */
export async function requireInternalPage(): Promise<InternalPrincipal> {
  const principal = await getCurrentPrincipal();
  if (principal === null || !isInternal(principal)) {
    redirect("/login");
  }
  return principal;
}
