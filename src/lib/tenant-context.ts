import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Principal } from "@/domains/authz/principal";
import { tenantVisibility, type VisibilitySpec } from "@/domains/authz/visibility";

// The bridge between the app-layer visibility policy and the database RLS
// backstop (ADR-0021). Every repository read/write on a tenant-owned table runs
// inside `withTenant`: it opens an interactive transaction and sets the request's
// tenant context as a SET LOCAL GUC before the work runs. Under Neon's PgBouncer
// transaction-mode pooling, the interactive transaction pins one server
// connection, so the GUC holds for the queries inside and is discarded at commit.
//
// The context is derived from the SAME `tenantVisibility(principal)` spec the
// app-layer `where` filter uses — RLS mirrors the app layer, it does not invent a
// second rule. RLS sits BENEATH the app-layer policy and does not replace it
// (ADR-0008): callers still apply their visibility `where`; this is the net that
// catches a query which slips past it.

/** The transaction-scoped Prisma client handed to the callback. */
export type TenantClient = Prisma.TransactionClient;

// The currently-open tenant transaction, if any. Lets `withTenant` be RE-ENTRANT:
// a repository that calls another (e.g. assignResearchers → getStudy) composes
// into ONE transaction with ONE GUC, instead of nesting interactive transactions
// (which Prisma does not support). The principal is identical across such nested
// calls — it threads through from the one request — so reuse is correct; a
// mismatch is a bug and throws (ADR-0021).
const activeContext = new AsyncLocalStorage<{
  readonly tx: TenantClient;
  readonly spec: VisibilitySpec;
}>();

function sameScope(a: VisibilitySpec, b: VisibilitySpec): boolean {
  if (a.scope !== b.scope) return false;
  if (a.scope === "tenant" && b.scope === "tenant") return a.tenantId === b.tenantId;
  return true;
}

/**
 * Run `fn` with the principal's tenant context established on the connection.
 *
 * Fail-closed by construction: a client principal sets `app.tenant_id`; internal
 * staff set `app.is_internal='on'`. Any code path that does NOT go through here
 * leaves both GUCs unset, and `current_setting(name, true)` then returns NULL, so
 * RLS matches no rows (reads) and rejects writes — never opens the table up.
 *
 * Re-entrant: when already inside a `withTenant` for the same principal, the open
 * transaction is reused (the GUC is already set) rather than nesting a new one.
 */
export function withTenant<T>(
  principal: Principal,
  fn: (tx: TenantClient) => Promise<T>,
): Promise<T> {
  const spec = tenantVisibility(principal);

  const existing = activeContext.getStore();
  if (existing !== undefined) {
    if (!sameScope(existing.spec, spec)) {
      // Reusing the outer transaction would silently run this work under the
      // outer tenant's scope — a tenant-isolation bug, not a convenience.
      throw new Error(
        "withTenant: nested call with a different tenant scope than the enclosing context",
      );
    }
    return fn(existing.tx);
  }

  return prisma.$transaction(async (tx) => {
    switch (spec.scope) {
      case "all":
        await tx.$executeRaw`SELECT set_config('app.is_internal', 'on', true)`;
        break;
      case "tenant":
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${spec.tenantId}, true)`;
        break;
      case "assigned":
        // `tenantVisibility` never yields `assigned` — the country axis (ADR-0025)
        // is a SEPARATE layer resolved by `countryVisibility`, AND-ed into the
        // query `where`, and is never used to set the RLS GUC (the tenant wall
        // stays the RLS backstop). Handled only for exhaustiveness; sets nothing,
        // so RLS fails closed exactly as the default does.
        break;
      default: {
        // A future scope variant added without a handler is a compile error; at
        // runtime we set nothing, so RLS fails closed to zero rows (ADR-0021).
        const _exhaustive: never = spec;
        void _exhaustive;
      }
    }
    return activeContext.run({ tx, spec }, () => fn(tx));
  });
}
