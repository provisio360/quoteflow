# Tenant isolation: a fail-closed app-layer visibility policy, RLS deferred

Absolute tenant isolation (issue #4) is enforced in v1 by a **single app-layer
Authorization & Visibility policy**, not by the database. Postgres Row-Level
Security — the defense-in-depth backstop ADR-0005 commits to — is **deliberately
deferred** to its own hardening slice. This ADR records how the one layer we ship
is built so it holds on its own, and why shipping it alone (for now) is safe and
intentional rather than an oversight.

## The structure

- **One generic primitive.** `tenantVisibility(principal)` (pure, in
  `src/domains/authz`, no DB/framework imports) returns a plain **visibility
  spec** — `{ scope: "all" }` for internal staff, `{ scope: "tenant", tenantId }`
  for a client user. There is exactly one isolation rule, reused by every
  tenant-owned resource's read path — not one rule per table. A generic
  `canRead(principal, resource)` predicate is its single-object counterpart.
- **The core stays pure; the adapter translates.** The spec is *not* a Prisma
  query. A thin adapter maps it to a `where` fragment (`{scope:"tenant"}` →
  `{ clientId: tenantId }`; `{scope:"all"}` → `{}`). `domains/authz` never imports
  Prisma, so the policy is exhaustively unit-testable with no database.
- **Principal-or-nothing reads.** Tenant-owned resources are readable *only*
  through a data-access module (repository) whose every entry point requires a
  `Principal` argument and applies `tenantVisibility` internally. There is no
  exported raw-query path for these tables. A principal-less read is not a bug to
  catch in review — it is **impossible to express**. The friction is the feature.
- **Out-of-tenant collapses into not-found.** `getStudy(principal, id)` runs the
  same visibility-scoped query a list would, so an other-tenant row simply never
  returns. A client probing IDs cannot distinguish "exists but not yours" from
  "never existed." There is no 403 path that could leak existence; the `canRead`
  predicate is a post-load backstop, never the gate that emits a forbidden.

## Fail closed

The **only** route to an unfiltered query (`where: {}`) is an explicit, validated
`{scope:"all"}` produced from a verified internal `Principal`. Every other
path — including future mistakes — must resolve to **match-no-rows**, never
match-all:

- the spec is a discriminated union switched **exhaustively** with a TypeScript
  `never` check, so adding a scope without handling it is a *compile error*;
- the runtime `default` still returns a match-nothing `where` as a
  belt-and-suspenders guard;
- a unit test asserts an unrecognised scope yields zero rows.

The asymmetry is deliberate: "internal sees all" is the single privileged path,
and it is reached only by validated input.

## Why app-layer-first, and why RLS is deferred (not dropped)

- The app-layer policy is the **primary** layer per ADR-0005; RLS is explicitly a
  backstop, "never the only layer" — but "primary" can stand alone for this
  tracer because principal-or-nothing reads make the boundary structural, not
  conventional.
- RLS is genuinely hard to retrofit *casually*: it touches how every connection
  authenticates to Postgres (a non-superuser app role) and how per-transaction
  tenant context is set. Neon's pooled connection (PgBouncer transaction mode)
  makes session GUCs fiddly — `SET LOCAL` must live inside a transaction. Half-
  implementing that plumbing under a tracer's scope would be worse than a clean,
  dedicated pass.
- Deferring is therefore a **scope** decision, not a security compromise: the app
  layer holds on its own, and RLS lands across all tenant tables at once when the
  connection/role model is designed properly. Tracked as issue #21 so a future
  reader does not mistake the single layer for a forgotten one.

## Cost accepted

Until the RLS slice lands, a bug that bypasses the repository (e.g. a deliberate
raw query that ignores the principal-or-nothing rule) would not be caught by a
second database-level net. We accept this for the tracer because the repository
makes such a bypass loud and intentional rather than accidental, and the backstop
is tracked, not forgotten.

## Consequences

- Every future tenant-owned resource (Benchmark Item, Quote, …) reuses
  `tenantVisibility` and the repository pattern rather than reinventing scoping.
- The RLS follow-up must add policies to *all* tenant tables and wire per-request
  tenant context; it should not change the app-layer policy, only sit beneath it.
- A future engineer tempted to add a convenient principal-less read helper, a
  per-resource visibility function, or a 403 "forbidden" on out-of-tenant access
  is undoing a deliberate decision — don't.
