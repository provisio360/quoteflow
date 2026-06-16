// Pure decision core — no framework, DB, or network imports.
//
// The Authorization & Visibility policy (issue #4). There is exactly ONE
// tenant-isolation rule, reused by every tenant-owned resource's read path —
// not one rule per table (ADR-0008). It takes a Principal (#3) and decides what
// that principal may see.
//
// The core deals only in abstract tenant ids; it never names a persistence
// column. The thin adapter (src/lib/studies) translates a VisibilitySpec into
// an actual query `where`. That keeps this file exhaustively unit-testable with
// no database.

import type { Principal } from "./principal";
import { isRole } from "./principal";

/** One (study, country) pair a Researcher holds a Country Assignment in. The unit
 *  of the country-visibility axis (ADR-0025) — a Country is never a bare name. */
export interface AssignedPair {
  readonly studyId: string;
  readonly country: string;
}

/**
 * What a principal is allowed to see, as plain data (never a query):
 *   - `all`      — internal staff see across every tenant (ADR-0001).
 *   - `tenant`   — a client user sees only their own tenant's rows.
 *   - `assigned` — a Researcher sees only the (study, country) pairs they hold a
 *                  Country Assignment in (ADR-0025). A SECOND, orthogonal axis,
 *                  AND-ed on top of the tenant axis for the Researcher role only.
 *
 * The ONLY variant that produces an unfiltered query downstream is `all`, and
 * it is reached only from a verified internal Principal. Everything else scopes —
 * `assigned` with an empty pair-set fails closed to zero rows, never `all`.
 */
export type VisibilitySpec =
  | { readonly scope: "all" }
  | { readonly scope: "tenant"; readonly tenantId: string }
  | { readonly scope: "assigned"; readonly pairs: readonly AssignedPair[] };

/**
 * The single tenant-isolation primitive. Internal staff are cross-tenant;
 * a client user is pinned to their own tenant. This is the function every
 * tenant-owned read path runs through.
 */
export function tenantVisibility(principal: Principal): VisibilitySpec {
  if (principal.kind === "internal") return { scope: "all" };
  return { scope: "tenant", tenantId: principal.tenantId };
}

/**
 * The country-visibility axis (ADR-0025): a SEPARATE, orthogonal layer that
 * narrows the Researcher role only, AND-ed on top of `tenantVisibility`. Gated on
 * the role first — every other internal role short-circuits to `all` (their
 * assignment data is never even loaded) and a client user is already terminal on
 * the tenant axis, so only a Researcher reaches the `assigned` pair-set. The
 * `pairs` are resolved per-request by a thin adapter; this core stays pure.
 *
 * Kept out of `tenantVisibility` deliberately: folding it in would force that
 * function to take more than a Principal (the assignment rows are a DB read),
 * breaking the purity ADR-0008 depends on.
 */
export function countryVisibility(
  principal: Principal,
  pairs: readonly AssignedPair[],
): VisibilitySpec {
  if (!isRole(principal, "Researcher")) return { scope: "all" };
  return { scope: "assigned", pairs };
}

/**
 * Single-object predicate: may this principal see a resource owned by
 * `resourceTenantId` (the owning Client's id)? Used as a post-load
 * defense-in-depth assertion — never as the primary gate, because by the time a
 * row is loaded bypassing the filter the isolation has already been lost.
 *
 * Fail closed: the only `true`-without-a-tenant-match path is the explicit,
 * validated `all` scope. An unrecognised scope (a future variant added without
 * updating this switch) is a COMPILE error via the `never` check, and still
 * returns `false` at runtime as a belt-and-suspenders guard.
 */
export function canSee(principal: Principal, resourceTenantId: string): boolean {
  const spec = tenantVisibility(principal);
  switch (spec.scope) {
    case "all":
      return true;
    case "tenant":
      return resourceTenantId === spec.tenantId;
    case "assigned":
      // The country axis is not a tenant predicate: `canSee` answers only the
      // tenant question (it runs on `tenantVisibility`, which never yields
      // `assigned`). Handled for exhaustiveness, and denies as belt-and-braces —
      // a (study, country) scope can never grant cross-tenant sight.
      return false;
    default: {
      const _exhaustive: never = spec;
      return false;
    }
  }
}
