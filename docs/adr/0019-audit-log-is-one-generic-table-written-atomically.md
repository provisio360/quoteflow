# The audit log is one generic append-only table, written atomically inside each transition

Issue #16 needs an internal [[Audit Event]] trail over eight transitions — submit,
approve, reject, release, reopen, import, [[Client Price]] change, and assignment —
capturing actor + timestamp, plus before/after on monetary values. Two shaping
decisions here are load-bearing and hard to walk back, so they are recorded
together: **what the table is**, and **how the write relates to the transition it
records**.

## One generic `AuditEvent` table — not per-transition tables, not folded into `ExportAudit`

A single append-only `AuditEvent` model carries every action:

- `action` (`AuditAction` enum), `actorId` (FK → User, `Restrict`), `studyId`
  (denormalized — every audited transition resolves to one study, so a study's
  timeline is one indexed query, mirroring how `ExportAudit` denormalizes
  `clientId`), `subjectType`/`subjectId` (polymorphic, plain-string id — no FK,
  consistent with the app-layer-first integrity of ADR-0008), and a nullable
  `beforeValue`/`afterValue` `Decimal(14,4)` pair.
- **No JSON.** Once before/after is the only non-uniform payload (see "v1 wires
  only Client Price" below), two Decimal columns carry it. This keeps the typed,
  no-blob style the rest of the schema holds to.
- The pure shape lives in `src/domains/audit` as a typed discriminated union with
  per-action builder functions; the table is its persisted mirror.

This is **generic on purpose**, against the codebase's usual typed-per-thing
instinct, because the eight actions share exactly the queryable axes (actor, time,
action, subject) and nothing else — a price delta and an assignment have no common
columns worth typing separately. It is a single chronological stream because that
is what "audit log" *means* as a domain concept: one thing you read per study or
per entity.

It deliberately does **not** absorb the existing `ExportAudit` (ADR-0018).
`ExportAudit` records data *access*; `AuditEvent` records entity *change*. ADR-0018
anticipated a future engineer wanting to consolidate the two — that remains a
defensible future move, but it is out of scope here and the two coexist for now.

## The audit write is atomic with the transition; a failed audit write fails the transition

Each event is written **inside the same `prisma.$transaction` as the mutation it
records**, via a `recordAuditEvents(tx, events)` helper in `src/lib/audit` whose
signature takes a transaction client (`tx`), never the bare `prisma` — so it is
structurally impossible to log outside the transition. If the audit write fails,
the transition rolls back.

This is the same principle ADR-0018 set for the export audit ("the access must not
be silently unlogged"), generalised: an audit log that can silently miss events is
not an audit log.

The consequence is that #16 is **not purely additive**. Three mutations that today
run as bare single statements — quote approve/reject (`quote.updateMany`),
Client Price change (`benchmarkItem.updateMany`), and assignment
(`countryAssignment.createMany`) — are wrapped in `$transaction` to gain a `tx`.
And the `updateMany`-by-count patterns are restructured to **read the prior row
first**, both to compute before/after and to fire one event **per affected row**
that actually changed (a no-op re-import or idempotent re-assign emits nothing).
The three already-transactional paths (release/reopen, quote-create, import) only
add steps.

## v1 wires only Client Price's before/after

The before/after pair is generic in the model but, in v1, written by exactly one
action: `clientPriceChange`. None of the other seven audited transitions change a
tracked monetary value. The Quote's local Price is changed only by Draft editing
(not an audited action — Drafts are private, ADR-0011) and by a possible future
**manual rate override**, which is deferred. So the pair stays null for every v1
action but `clientPriceChange`, and the column is left in place for that future
price-bearing action.

Known debt: `conversion.ts` and CONTEXT's Exchange Rate term both say the manual
rate override is "audited (#16)". With `rate-override` deferred, that reference is
not yet satisfied — it lands with the rate-override slice, not here.

## Scope: recording substrate only

#16 ships the table, the pure builders, the `tx`-only writer, the wiring into all
eight transitions, and integration tests proving each one records. It ships **no
read path** — "no client-facing path exposes it" is easiest to guarantee when
there is no read path at all. A read/timeline view is a separate product slice.

## Considered and rejected

- **Per-transition typed tables** (`QuoteTransition`, `ReleaseEvent`, …). More FK
  integrity, but multiplies tables and write/query paths for axes that are
  identical across actions; the per-action specificity that matters lives fine in
  the pure core's union.
- **A loose JSON before/after payload.** Justified only while the actions looked
  heterogeneous; once before/after is the sole variable data, two Decimal columns
  beat an untyped blob and match the schema's no-JSON norm.
- **Prisma middleware / extension that auto-logs writes.** Rejected: it can't see
  domain intent (a state-flipping `updateMany` and a Draft field edit look
  identical at the ORM layer), can't compute a clean before/after, and hides the
  audit write from the code that reads it — against the explicit, app-layer-first
  style of ADR-0008.
- **Best-effort audit write after commit.** Simpler, no transaction refactor, but
  a crash between mutation and log leaves an unaudited transition — defeating the
  log's purpose.

## Consequences

- Every audited write path is transactional after #16; reviewers touching
  quote/release/assignment writes will find the audit step inside the transaction
  and should keep it there.
- The log is high-cardinality by design (per-affected-row on bulk ops); a large
  re-import writes one audit row per changed item, inside the import transaction.
- `AuditEvent` and `ExportAudit` are two separate audit tables on purpose; a future
  consolidation is allowed but is its own decision.
