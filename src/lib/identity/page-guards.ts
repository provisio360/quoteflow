import { redirect } from "next/navigation";
import { getCurrentPrincipal } from "./current-principal";
import {
  canViewClientDashboard,
  isInternal,
  type InternalPrincipal,
  type Principal,
} from "@/domains/authz/principal";

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

/**
 * Gate a page to the Admin (tenant + identity administration). A non-Admin —
 * authenticated or not — redirects to /login, never a 403 (ADR-0008: we don't
 * confirm what lies beyond).
 */
export async function requireAdminPage(): Promise<InternalPrincipal> {
  const principal = await getCurrentPrincipal();
  if (principal === null || !isInternal(principal) || principal.role !== "Admin") {
    redirect("/login");
  }
  return principal;
}

/**
 * Gate a page to any authenticated principal — internal staff OR a Client User.
 * Unauthenticated redirects to /login. Used by the client-facing dashboards
 * (#14), where the actual tenant scoping is enforced downstream by the read
 * (a Client User only ever resolves their own tenant's data, ADR-0008).
 */
export async function requirePage(): Promise<Principal> {
  const principal = await getCurrentPrincipal();
  if (principal === null) {
    redirect("/login");
  }
  return principal;
}

/**
 * Gate the client study dashboard (#14). Admits Client Users and internal
 * non-Researcher staff; blocks the internal Researcher (#63) — a redirect to
 * /login, never a 403/404 (ADR-0008: we don't confirm what lies beyond). The
 * Researcher block is the load-bearing wall: the dashboard is the aggregated
 * released "answer" view the platform keeps from researchers (ADR-0003
 * anti-anchoring), and a side door around their assigned-country read boundary
 * (ADR-0025). The admit/block decision is `canViewClientDashboard`, shared with
 * the study-detail link so the two cannot drift.
 */
export async function requireDashboardPage(): Promise<Principal> {
  const principal = await getCurrentPrincipal();
  if (principal === null || !canViewClientDashboard(principal)) {
    redirect("/login");
  }
  return principal;
}
