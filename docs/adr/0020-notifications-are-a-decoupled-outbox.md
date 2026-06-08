# Notifications are a decoupled outbox: the in-app row is written in-transaction, email is deferred to the worker

Issue #17 adds the only two push events in v1 — a [[Quote]] rejected notifies its
**author**, and a [[Country]] released notifies the tenant's [[Client User]]s —
each over two channels, email and an in-app inbox. The shaping decisions here are
load-bearing and awkward to walk back (a new table, a new worker job, a schema
column on `CountryRelease`, and a coupling rule for *where* each channel fires), so
they are recorded together. The guiding constraint from the AC is that dispatch is
"a thin adapter, decoupled from the domain cores": the reject/release cores learn
nothing about email.

## One `Notification` table; email and in-app are two channels off one event

A new `Notification` model is the single source event. In-app *is* a row; email is
a delivery of that same row. There is no separate "email log" and no derived
"compute your rejected quotes" badge — those were both considered (see below) and
rejected. Each row carries: recipient `userId`, a `kind` (`quoteRejected` |
`countryReleased`), `subjectType`/`subjectId` for linking back, a **snapshot** of
the human-readable payload, `createdAt`, a nullable `readAt` (in-app read state),
and a nullable `emailedAt` (delivery provenance — *not* a polling cursor).

## The in-app row is written in-transaction; email is deferred via transactional `addJob`

This mirrors the split the codebase already draws between [[Audit Event]]s
(ADR-0019, written atomically inside the transition) and conversion (ADR-0013,
deferred to the background worker):

- The **in-app `Notification` row** is written **inside the same
  `prisma.$transaction`** as the reject/release it announces — recipient
  resolution and the payload snapshot happen there. A committed rejection therefore
  *always* has its notification; the two cannot drift.
- **Email** is **never** sent inside the transaction (you cannot roll back a sent
  email, and a slow/failed Resend call must not fail a `reject`). Instead the same
  transaction enqueues a graphile-worker job (`send_notification_email`, carrying
  the `notificationId`) via a transactional `addJob`. The job is committed
  atomically with the transition and the row; the worker task loads the row and
  delivers via Resend behind the existing `sendEmail` port
  (`src/lib/notifications.ts`). graphile owns retries/backoff.

Delivery is **at-least-once**: a crash between a successful Resend call and the
job ack re-runs the job, so a recipient may rarely get a duplicate email — the
standard, accepted trade-off. The in-app side has no duplicate risk (one in-txn
write). All Resend/vendor coupling lives in the worker; the domain cores only write
a row and enqueue a job.

## The payload is snapshotted, because the rejection reason is ephemeral

The rejection reason is **cleared on resubmit** (CONTEXT.md: [[Justification]]).
If a notification only referenced `quoteId` and resolved the reason at render time,
the reason would vanish the moment the author revises — breaking both the in-app
view and any late-running email, and violating the AC's "with reason". So the
reason text (and, for a release, the study + country name) is **copied into the
row** at write time. The row is self-contained; the email job re-queries no mutable
domain state.

## A release notifies once per (study, country), tracked by a new `clientNotifiedAt`

Release is per (study, country) and re-releasable after a reopen (ADR-0016), which
**re-stamps** `releasedAt` — so the row cannot tell first release from re-release.
A nullable **`clientNotifiedAt`** column is added to `CountryRelease`, set once
inside the first release transaction and **never cleared** by a reopen or
re-release. Its presence is the in-transaction guard: set ⇒ no notification. A
reopen never notifies (a pure visibility lever). This keeps re-release quiet
without bending the [[Audit Event]] log into a control-flow input.

## Recipients are active users only

Notifications target only `active` users. A rejection whose author has since been
deactivated, and deactivated [[Client User]]s on a release, are skipped on **both**
channels — no in-app row, no email job. A release to a tenant with zero active
Client Users is a clean no-op. This avoids emailing offboarded people and avoids
writing in-app rows nobody can ever read.

## Recipient correction vs the issue text

The issue says rejection notifies the "primary researcher". That is loose wording:
the domain routes a rejection to the quote's **author** (`createdById`), the one
who can actually revise it — the [[Primary Researcher]] is only the item *lead* and
may be a different person (CONTEXT.md: [[Approved / Rejected]], ADR-0014). The
build follows the model, not the issue's phrasing.

## Scope

#17 ships the `Notification` table, the `clientNotifiedAt` column, in-transaction
writes on the reject and first-release paths, the transactional email enqueue, the
worker `send_notification_email` task delivering via the existing `sendEmail` port,
and a **minimal pull-based in-app surface**: a `/notifications` list (newest-first,
unread-styled) and a nav unread count, marked read on open. No realtime/websockets
(v1 is pull everywhere else), no per-notification read toggle, no digest batching.

## Considered and rejected

- **Email inline, fire-and-forget after commit.** Simpler (no worker job), but
  couples request latency to Resend, has no retry, and re-couples a core path to
  the vendor — against the "thin adapter, decoupled" AC.
- **Email inside the transition's transaction.** A slow/failed vendor call would
  block or roll back a domain transition. Never.
- **A derived in-app badge, no table** ("compute your rejected quotes / newly
  released countries"). No schema, but no real read/unread semantics and it largely
  duplicates the review queue / dashboard, which already show that state.
- **Reference-only payload** (store `subjectId`, resolve text at render). Smaller
  rows, but the rejection reason is cleared on resubmit, so "with reason" breaks.
- **Notify on every release, including re-release.** Simpler rule, but noisier; the
  team chose first-release-only as the honest "this is now visible" signal, with
  noise reduction (digests) left to v2.
- **Notify the Primary Researcher** (literal issue text). The primary may not be
  the author and cannot revise the quote — contradicts the lifecycle.
