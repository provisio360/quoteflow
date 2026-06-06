# Analytics is a post-release lens

The dashboards over a [[Pricing Study]] — the client **range view** and
**by-competitor breakdown**, and the internal **benchmark comparison** against
[[Client Price]] — all aggregate over exactly one population: **released +
approved** [[Quote]]s (Approved quotes whose Country is currently [[Released]]),
within a single study (issue #14, see [[Competitor Price Range]] in CONTEXT.md).
The internal view is *not* an exception: it ranges over the same released set the
client sees, never over all-approved-regardless-of-release. Analytics is
therefore a strictly **post-release** lens, with no pre-release aggregation path
in the system.

## Why the internal view doesn't see pre-release data

The surprising part is the internal **benchmark comparison** (View D). An analyst
QC tool that you'd expect to see everything is instead pinned to the same
released subset as the client. That is deliberate:

- **Pre-release QC already exists, and it is per-quote.** The [[Price Flag]]
  (ADR-0014) compares each individual converted Quote to its item's
  [[Client Price]] the moment it is reviewed, and gates approval. By the time a
  Country is released, every approved quote in it has already passed that gate.
  An aggregate "all approved" view would add a second, weaker QC signal
  (range-vs-benchmark) over data the per-quote flag has already vetted.
- **One population means one tested function.** All three views fold the same
  released-quote read into the same pure range core. A separate all-approved
  population for the internal view would mean a second read path, a second set of
  edge cases, and a divergence between "what the analyst's range says" and "what
  the client's range says" for the same item.
- **The internal view answers a post-release question.** Its value is "now that
  this is what the client sees, how does the released spread sit against our
  benchmark?" — not "how is collection going?" Progress and pre-release QC are
  served elsewhere (the review queue, the release-eligibility view).

The only thing the internal view adds over the client views is the
[[Client Price]] column itself (hidden from clients per ADR-0003) and its
comparison to the range — *not comparable* when the item has no Client Price,
reusing the [[Price Flag]]'s vocabulary.

## Considered and rejected

- **Internal view ranges over all approved (a pre-release lens).** Rejected: it
  duplicates the per-quote [[Price Flag]] as a weaker aggregate signal, forks the
  read population, and lets the internal range disagree with the client range for
  the same item. Pre-release QC stays per-quote.
- **Tenant-wide / cross-study roll-ups.** Rejected for v1: release is a
  per-(study, country) act, so "released + approved" only has meaning inside a
  study; mixing independently-released studies muddies the spread. Dashboards are
  per-study.

## Consequences

- **Two read paths share one pure core.** A tenant-gated client read folds
  `listReleasedQuotesForStudy` output (no Client Price) into the range view and
  by-competitor breakdown; a separate **internal-only** read joins each item's
  `clientPrice` for the benchmark comparison. Both feed the same pure aggregation
  in `src/domains/analytics`, unit-tested over the awkward inputs (empty
  population, even-sized median, null competitor, unset Client Price).
- **The internal view is gated to internal staff, never tenant-scoped.** A Client
  User can never reach the Client-Price-bearing read; internal staff are
  cross-tenant (ADR-0001).
- **No pre-release analytics surface exists by design.** Building one later is a
  new read path and a deliberate reversal of this decision, not a tweak.
