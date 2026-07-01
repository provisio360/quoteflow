# A flagged provider-disabled mode: the worker degrades gracefully and still pins USD

ADR-0041 added the [[Study Exchange Rate]] table "ahead of the provider" as an
add-on **until the provider plan is fully in use**, with USD and every table
**miss** deliberately routed to the existing `pending → auto` sweep (ADR-0013).
That routing assumes the sweep can run. Today it cannot when the provider is off:
the worker task builds the adapter first — `exchangerateApiProviderFromEnv()` —
which **throws when `EXCHANGERATE_API_KEY` is unset**, *before* `computeConversion`'s
USD short-circuit ever executes. So in the provider gap, **every** document on the
fallback path — including USD, whose rate is a deterministic `1` — is stuck
`pending` and therefore **unapprovable** (the ADR-0013 gate). This ADR makes
"provider off" a **first-class, explicitly-flagged operating mode** in which the
sweep degrades gracefully instead of failing shut.

## Decision

Introduce an explicit **`FX_PROVIDER_DISABLED`** flag that puts the deferred sweep
into a supported **provider-disabled mode**:

- **The sweep runs; it does not throw.** With the flag set, the worker constructs a
  **null provider** (`rateFor` always returns `null`) instead of calling
  `exchangerateApiProviderFromEnv()`. Every run still scans and processes the
  pending set.
- **USD resolves to `auto`; non-USD stays `pending`.** `computeConversion`'s USD
  short-circuit returns rate `1` **without** consulting the provider, so USD
  documents pin `auto` exactly as they always would have. A non-USD currency sees
  `null` on every probe, exhausts the walk-back (ADR-0012) and remains `pending`,
  identical to today's "uncovered currency" outcome — it waits for a per-document
  [[Conversion Status|`manual`]] override (ADR-0023) or for the provider to be
  switched on.
- **Logging is intent-aware.** In provider-disabled mode the "scanned but none
  resolved" case logs at **info** ("provider disabled — N USD resolved, M awaiting
  rate"), *not* the ADR-0013 error. The existing **error** log
  ("...check `EXCHANGERATE_API_KEY`, quota, and account status") is kept for the
  case where a key **is** present but nothing resolved — a real misconfiguration.

Nothing else changes: the researcher's entry preview/miss warning (ADR-0041) and
the analyst's review-queue inline manual override (already built) work unchanged,
because provider-disabled mode only alters the fallback sweep, not the domain.

## Considered options

- **Pin USD at submit as its own provenance (rejected).** Would remove USD from the
  `pending` gate instantly, but reopens ADR-0041's settled "USD is not a submit-time
  pin / `auto` ⇐ worker only" and touches the submit path and the Conversion Status
  machine — a large change for a rate a sub-hour sweep already handles within
  ADR-0013's accepted latency.
- **Seed USD=1 rows in the study table (rejected).** ADR-0041 already rejected this
  as provenance misattribution, and it is ongoing operational toil.
- **Infer the gap from a missing key, no flag (rejected).** Simpler, but then a
  genuine production mistake — forgetting the key once the provider is *live* —
  degrades **silently** into "USD works, everything else quietly stuck" behind an
  info log. An explicit flag keeps the intended state loud and the accidental state
  an error.
- **A dedicated "missing rates" EM worklist (deferred, not rejected).** A nice
  affordance for seeing which currencies a study still needs seeded, but a new
  surface for a **transient** condition; the analyst already discovers stuck
  documents in the review queue. Revisit if the gap proves long-lived.

## Consequences

- **Switching the provider on is a pure superset — no corner painted.** Clearing
  `FX_PROVIDER_DISABLED` and setting the key makes the very next sweep resolve the
  non-USD documents that were waiting; already-`auto` USD documents and any
  gap-era `manual` overrides are sticky and untouched (ADR-0004/0041).
- **The provider gap has a complete conversion story without the provider.** USD →
  `auto` (sweep), study-table hits → `study-rate` (submit, ADR-0041), everything
  else → analyst `manual` override in the review queue. No document is a dead end.
- **The manual override is the load-bearing in-gap unblock for non-USD misses**, so
  its availability in the review queue (`{pending, study-rate} → manual`, ADR-0041)
  is a hard dependency of this mode, not an optional nicety.
- **This is a deployment/operations concept, not a domain term** — it changes *when*
  the sweep can resolve, not the meaning of any Conversion Status, so CONTEXT.md is
  unchanged.
