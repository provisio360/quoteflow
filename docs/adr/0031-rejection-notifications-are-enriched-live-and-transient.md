# Rejection notifications are enriched-live and transient (amends ADR-0020)

A rejection notification must now place the author *in context* — its [[Pricing
Study]] name, [[Country]], [[Market Quote Number]] and [[Quote Line Number]], with
a deep-link to the rejected line — and must **stop being shown once the rejection
is resolved**. ADR-0020 made every `Notification` a self-contained, push-once
**snapshot** and explicitly *rejected* render-time resolution. This amends that for
the `quoteRejected` kind: the **labels derive live**, the in-app notification is
**transient**, and only the **reason stays snapshotted**. `countryReleased` is
untouched.

## Labels derive live; only the reason stays snapshotted

The study name, country, Market Quote Number and Quote Line Number are **resolved
at inbox render** by joining the subject [[Quote Line]] — not copied onto the row.
These labels are stable identities, so a live join is the single source of truth
and needs no new columns. The **rejection reason stays snapshotted** on the row
(as ADR-0020 set it): it is cleared on resubmit (CONTEXT.md: [[Justification]]) and
the deferred email job may run after the author has already revised, so the email
still needs the frozen text. The "reference-only payload" ADR-0020 rejected is thus
only partly reinstated — for stable labels, never for the ephemeral reason.

## In-app dismissal is a derived predicate, not stored state

"Resolved ⇒ no longer shown" is defined as: an in-app `quoteRejected` notification
is shown iff its subject [[Quote Line]] is **still `Rejected`** *and* the row is the
line's **newest** rejection (the latest `createdAt` among that line's rejection
rows). So it disappears the moment the author **revises** (Rejected → Draft), and a
re-rejection of the same line shows only its own fresh row, never a stale earlier
one. Newest-per-line — not a `createdAt >= reviewedAt` comparison — because the
notification `createdAt` (db `now()`) and the line's `reviewedAt` (app clock) come
from different clocks within the same transaction and must not be ordered against
each other. This is a **derived judgement, never a stored flag** — mirroring
[[Release Eligibility]] — so no `dismissedAt` write on the revise path and no column. The same predicate gates both
the inbox **list** and the unread **badge** count, so a notification dismissed
before it was ever read leaves no phantom unread. The join is kind-specific:
`countryReleased` rows pass through unfiltered (a release is permanent).

## Email is enriched but fire-once

The email body gains the same context (study, country, Market Quote Number, Quote
Line Number, an absolute deep-link), still **never a [[Client Price]]** (ADR-0003;
the reason states only divergence *direction*). Dismissal is **in-app only** — a
sent email cannot be unsent, so it remains the push-once record ADR-0020 describes.

## Considered and rejected

- **Stored `dismissedAt`, stamped on revise.** Trivial latest-only semantics, but
  re-introduces stored control state on a *different* transition than the one that
  wrote the row, plus a column — against the derived-judgement grain.
- **Snapshot the labels too** (consistent with the reason). Self-contained and
  survives a hard-deleted line, but the dismissal join is unavoidable anyway, so
  snapshotting pays twice and lets labels drift from current truth.
- **Dismiss only on resubmit or re-approval.** Keeps a stale "rejected" banner up
  while the author is actively fixing the line; revise is the honest "picked up"
  moment, and the line then lives in the author's Drafts surface.
