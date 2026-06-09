# Postgres RLS is the tenant-isolation backstop: a non-owner app role, per-transaction GUCs, and a denormalized `clientId` on every tenant table

Issue #21 lands the database-level net ADR-0005 committed to and ADR-0008
deliberately deferred: PostgreSQL Row-Level Security beneath the app-layer
Authorization & Visibility policy, as a backstop and **never the only layer**.
The shaping decisions here are load-bearing and expensive to walk back — a new
Postgres role the whole app authenticates as, a denormalized tenant column on
every tenant-owned table, a session-GUC protocol that must hold under Neon's
PgBouncer transaction pooler, and a deliberate set of tables left *out* — so they
are recorded together. The guiding constraint from ADR-0008 is that RLS **sits
beneath the app-layer policy and does not change it**: it mirrors the existing
`tenantVisibility()` spec rather than inventing a second isolation rule.

## A non-owner app role; the owner keeps migrations and the worker

The app stops connecting as the table owner (the owner bypasses RLS). A migration
creates a NOLOGIN group role `quoteflow_app`, guarded by a `DO / IF NOT EXISTS`
block because Postgres roles are cluster-scoped and a bare `CREATE ROLE` breaks
Prisma's shadow-database reset. That migration owns the whole security structure —
the CRUD grants, `ALTER DEFAULT PRIVILEGES`, `ENABLE ROW LEVEL SECURITY`, and the
policies — so the net is version-controlled and portable alongside the schema it
protects. The real LOGIN credential is provisioned out-of-band (Neon) and granted
membership in `quoteflow_app`; `APP_DATABASE_URL` (pooled) points at it and the
runtime client in `src/lib/prisma.ts` uses it. Secrets stay out of git.

Migrations keep running as the owner via `DIRECT_URL`, and the background worker
keeps connecting as the owner too — both therefore bypass RLS. The worker is a
trusted **system actor** (the cross-study FX sweep, notification emailing); its
tenant-crossing is by design, it takes no untrusted tenant-selection input, and
graphile-worker needs the elevated role for its own schema regardless. The
backstop covers the request-serving app path, which is the actual attack surface.

## Tenant context travels as per-transaction GUCs set in the repository

Tenant context reaches Postgres through `withTenant(principal, fn)` in the
data-access layer — the same chokepoint ADR-0008 already routes every read
through. It opens an interactive `prisma.$transaction` whose first statement is
`set_config('app.tenant_id', <id>, true)` for a client user, or
`set_config('app.is_internal', 'on', true)` for internal staff (`scope:"all"`).
The `is_local = true` (`SET LOCAL`) scoping is what makes this safe under
PgBouncer **transaction mode**: the interactive transaction pins one server
connection for its lifetime, so the GUC holds for the queries inside and is
discarded at commit — no leakage to the next request sharing the pooled backend.
The two GUCs are derived from the *same* `tenantVisibility()` spec the app layer
produces, so there is one isolation rule, mirrored, not two.

## Denormalized, immutable `clientId` on every tenant table

Every RLS-covered table carries its own immutable `clientId`, set at insert,
rather than the policy joining back to `study`. The policy is then uniform and
join-free everywhere:

```sql
CREATE POLICY tenant_isolation ON "quote"
  FOR ALL
  USING      (current_setting('app.is_internal', true) = 'on'
              OR "clientId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.is_internal', true) = 'on'
              OR "clientId" = current_setting('app.tenant_id', true));
```

(The column is `"clientId"`, camelCase per the project's Prisma column convention,
not `client_id`; the `client` table policy compares its own `"id"` instead.)

`FOR ALL` with identical `USING` and `WITH CHECK` means the net catches **write**
bugs too: an INSERT/UPDATE that puts a row in a foreign tenant is rejected unless
the actor is internal. This matches the project's existing denormalize-for-locality
precedent (`audit_event.studyId`, `export_audit.clientId`) and keeps the policy
obviously correct at a glance, at the cost of a column + backfill migration and
the discipline of setting `clientId` on insert (which `WITH CHECK` then verifies).

## Fail-closed by construction

`current_setting(name, true)` returns `NULL` when the GUC is unset (the
`missing_ok` form), so a query that never went through `withTenant` — the raw
bypass the AC is about — matches **no rows**: `"clientId" = NULL` is `NULL`, and
`NULL = 'on'` is `NULL`, neither of which is `true`. The only route to seeing
across tenants is the explicit `is_internal = 'on'` set from a verified internal
principal. Absent or invalid context is always match-nothing, never match-all —
the same asymmetry ADR-0008 built into the app layer, now enforced a second time
by the database.

## Considered options

- **Nested-RLS subquery policies** (no denormalized column; children filtered by
  membership in the already-RLS-filtered parent set). Elegant and single-source,
  but per-row subqueries and nested-RLS reasoning; rejected for the uniform,
  join-free `clientId` policy given the established denormalization precedent.
- **A separate `BYPASSRLS` role for staff.** Cleanest in theory, but per-request
  role switching is impractical under transaction-mode pooling. The `is_internal`
  GUC achieves the same from a single pooled role.
- **A sentinel `app.tenant_id = '*'` for staff.** Overloads one value with two
  meanings and risks collision; a dedicated boolean GUC is clearer.

## Consequences

- Every repository entry point runs its Prisma work **inside** `withTenant`
  (global `prisma` → the transaction's `tx`); a query left outside it fails closed
  to zero rows rather than leaking. All request-serving repositories
  (`studies`, `quotes`, `release`, `benchmark-items`, `assignments`, `analytics`,
  `export`) are wired. The notification inbox is deliberately not — `notification`
  is recipient-scoped at the app layer and carries no RLS policy. The two
  worker-only paths (`quotes/conversion-fill`, `notifications/send`) deliberately
  stay on the owner connection (the worker bypasses RLS as a system actor); they
  must not run with `APP_DATABASE_URL` set — see `docs/runbooks/0021-rls-app-role.md`.
- The retrofit hazard — several repositories call `getStudy` (itself a
  `withTenant` transaction) and then do their own work — is resolved by making
  `withTenant` **re-entrant**: an `AsyncLocalStorage` holds the open transaction,
  so a nested call for the same principal reuses it (one transaction, one GUC)
  instead of nesting interactive transactions, which Prisma forbids. A nested call
  with a *different* tenant scope throws, rather than silently running under the
  outer scope.
- **What is deliberately left out of RLS:** the auth/identity substrate
  (`user`, `session`, `account`, `verification`, `invite`) — Better Auth reads it
  during login, *before* any principal or GUC exists, so tenant RLS there would
  make login itself return zero rows. And the internal trails
  (`audit_event`, `export_audit`, `notification`) are internal- or
  recipient-scoped, not the client's readable data; a pure `clientId` policy
  models them wrong (e.g. it would expose a `quoteRejected` notification — whose
  `clientId` is the study's tenant but whose recipient is an internal
  researcher — to that tenant's client users). Their access stays app-layer-first.
  "All tenant-owned tables" here means the client's readable data:
  `study`, `benchmark_item`, `quote`, `country_assignment`, `country_release`,
  and `client` itself.
- A future engineer must not "tidy" the worker onto the app role, drop the
  denormalized `clientId` in favour of a join, or add tenant RLS to the auth
  tables — each is a deliberate decision recorded here.
