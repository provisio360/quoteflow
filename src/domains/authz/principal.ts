// Pure decision core — no framework, DB, or network imports.
//
// The Principal is the shared seam between identity (#3, which establishes it)
// and authorization (#4, which consumes it). It is a discriminated union on
// `kind` so the illegal states are unrepresentable in the type system:
//   - an internal staff member NEVER carries a tenant
//   - a client user NEVER carries a staff role
// The database mirrors this with a CHECK constraint (role XOR tenant); this
// type is the in-memory counterpart the domain layer reasons over.
//
// See ADR-0006 (sessions resolve a live Principal per request) and ADR-0007
// (role/tenant/status live on the principal, never on the credential).

/** The four internal staff roles. Admin is user-administration only. */
export const INTERNAL_ROLES = [
  "Admin",
  "EngagementManager",
  "Researcher",
  "Analyst",
] as const;

export type InternalRole = (typeof INTERNAL_ROLES)[number];

/** Internal staff: carry a single role, work across all tenants, never tenant-scoped. */
export interface InternalPrincipal {
  readonly kind: "internal";
  readonly userId: string;
  readonly role: InternalRole;
}

/** Client User: a human bound to exactly one Client (tenant), viewer-only. */
export interface ClientPrincipal {
  readonly kind: "client";
  readonly userId: string;
  readonly tenantId: string;
}

/**
 * The authenticated identity resolved from a session. Every read path in #4
 * takes a Principal and decides what it may see; #3 only establishes it.
 */
export type Principal = InternalPrincipal | ClientPrincipal;

export function isInternal(p: Principal): p is InternalPrincipal {
  return p.kind === "internal";
}

export function isClient(p: Principal): p is ClientPrincipal {
  return p.kind === "client";
}

export function isRole(p: Principal, role: InternalRole): boolean {
  return p.kind === "internal" && p.role === role;
}

/**
 * May this principal view a Client study dashboard (the client-facing released
 * Competitor Price Range, #14)? Admits Client Users and every internal role
 * EXCEPT the Researcher.
 *
 * The Researcher block is the load-bearing rule (#63). It is NOT a Client-Price
 * leak — the dashboard carries no Client Price (ADR-0003) — and NOT an ADR-0025
 * pair-set scoping; it is a *total* block (every study, every country),
 * extending ADR-0003's anti-anchoring ethos beyond Client Price to the
 * aggregated released "answer" view a Researcher must not be anchored by.
 * EM/Analyst/Admin previewing the client's output is a deliberate, retained
 * affordance. The single source of truth for both the page guard
 * (requireDashboardPage) and the study-detail link's visibility, so they cannot
 * drift.
 */
export function canViewClientDashboard(p: Principal): boolean {
  return isClient(p) || (isInternal(p) && p.role !== "Researcher");
}

export function isInternalRole(value: unknown): value is InternalRole {
  return (
    typeof value === "string" &&
    (INTERNAL_ROLES as readonly string[]).includes(value)
  );
}

/**
 * The raw account shape as it comes out of persistence: a flat row where
 * `role` and `tenantId` are independently nullable. This is exactly the shape
 * that CAN express illegal states — so it is funnelled through `toPrincipal`,
 * which is the single place those states are rejected.
 */
export interface PrincipalRow {
  userId: string;
  kind: "internal" | "client";
  role: string | null;
  tenantId: string | null;
}

export type PrincipalError =
  | "internal-requires-role"
  | "internal-forbids-tenant"
  | "internal-invalid-role"
  | "client-requires-tenant"
  | "client-forbids-role"
  | "unknown-kind";

export type PrincipalResult =
  | { ok: true; principal: Principal }
  | { ok: false; error: PrincipalError };

/**
 * Validate a persisted row into a Principal, enforcing the role-XOR-tenant
 * invariant. The DB CHECK constraint is the first line of defence; this is the
 * second, so a malformed row never silently becomes an over-privileged
 * principal. Returns a result rather than throwing so callers decide how to
 * fail (a bad principal is an auth failure, not a 500).
 */
export function toPrincipal(row: PrincipalRow): PrincipalResult {
  if (row.kind === "internal") {
    if (row.tenantId !== null) return { ok: false, error: "internal-forbids-tenant" };
    if (row.role === null) return { ok: false, error: "internal-requires-role" };
    if (!isInternalRole(row.role)) return { ok: false, error: "internal-invalid-role" };
    return {
      ok: true,
      principal: { kind: "internal", userId: row.userId, role: row.role },
    };
  }

  if (row.kind === "client") {
    if (row.role !== null) return { ok: false, error: "client-forbids-role" };
    if (row.tenantId === null) return { ok: false, error: "client-requires-tenant" };
    return {
      ok: true,
      principal: { kind: "client", userId: row.userId, tenantId: row.tenantId },
    };
  }

  return { ok: false, error: "unknown-kind" };
}
