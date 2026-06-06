# A Country's release state is a persistent `(study, country)` row, mutated in place

A [[Country]] has no row of its own — it is a string on `BenchmarkItem` and
`CountryAssignment`. To carry its [[Released]] state (issue #13) we add a
**`CountryRelease`** model, one row per **`(studyId, country)`**, created on first
release and thereafter **mutated in place** through reopen/re-release cycles —
never deleted. "Currently released" is `state = released`; reopen flips the same
row to `reopened` (keeping the release timestamps); re-release flips it back and
re-stamps. No row ⇒ never released.

Release is keyed on `(study, country)`, not a bare country name, because the same
country string recurs across studies and ADR-0002 releases "every Benchmark Item
*in the Country*" of **one** study — each study's country is released
independently.

## Why a persistent, stateful row (not presence-only)

The simpler design — a row exists iff currently released, deleted on reopen — was
rejected. It collapses "released, then reopened" and "never released" into the
same absence, throwing away the provenance the **audit slice (#16/#42)** will want
(who released/reopened, when; `release` and `reopen` are named audit events in
PRD #42) and the re-release distinction. Mutating one row in place keeps that
history on the row itself and makes re-release a state flip rather than a
re-insert. This mirrors how the [[Quote]] lifecycle keeps verdict provenance
(`reviewedById/At`) on the quote rather than deleting and recreating.

## Consequences

- **Read paths compose three filters.** A client's released-quote read (the first
  client-facing read in the codebase) is the fail-closed conjunction of tenant
  isolation (ADR-0008), `CountryRelease.state = released` for the quote's
  `(study, country)`, and `Quote.state = Approved`. Built per ADR-0008 so a
  non-client / wrong-tenant principal collapses to match-no-rows.
- **The gate is pure; the adapter is atomic.** The releasable judgement
  ([[Release Eligibility]]) lives in a pure evaluator in `src/domains/release`
  over per-item counts (`requiredQuotes`, `approvedCount`, in-flight count),
  returning *why* it is blocked — not a bare boolean — like `evaluatePriceFlag`
  and the lifecycle `transition`. `releaseCountry` re-evaluates and upserts the
  row **inside one `$transaction`**, re-reading counts, so a quote submitted
  between check and write can't slip a no-longer-eligible Country out the door.
- **Reopen is ungated and quote-inert.** First release and every re-release run
  the full precondition; **reopen** does not (it is always allowed on a released
  Country) and never touches any quote's state — it is purely a visibility lever,
  so re-release needs no re-approval.
- **Release/reopen are Analyst acts**, not tenant-scoped (`canReleaseCountry` =
  internal + Analyst, mirroring `canReviewQuote`).
- An unknown `(study, country)` (no Benchmark Items) is **not** releasable, not a
  silent no-op row — consistent with empty-country eligibility being `false`.
- A full audit trail of releases is **out of scope** for #13 and deferred to the
  audit slice (#16/#42); the row's `releasedById/At` + `reopenedById/At` are the
  only provenance v1 keeps until then.
