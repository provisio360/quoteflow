# Line ordering is document-major and alphabetical, overriding artifact row order

Quote Lines are ordered **`study → country → Market Quote Number (asc) → Client
Source Unit (A→Z, nulls last) → Client Item Number (A→Z)`** on the
Internal Export, the Client Export, and the researcher Draft/document line
surfaces. This **supersedes the row-order clause of ADR-0029** (which sorted
`Market → Client Item Number → Quote Line Number`) and **deliberately deviates
from the legacy artifact's own row order**, which is document-major but preserves
the *brief's authored order* within each document, not an alphabetical sort.

## Why this is surprising

ADR-0029's whole premise is "fidelity to the legacy `pricing_study_example1_*`
artifact beats internal tidiness." A future reader will see the exports no longer
reproducing the artifact's row sequence and reasonably ask why we broke that
contract. This ADR is the answer: we kept the artifact's **column** fidelity
(ADR-0029 stands for the column superset, cell rendering, and `(Market, Row Id)`
keying) but chose a **deterministic, schema-derivable row order** over the
artifact's brief-order sequence.

## What the artifact actually showed

Inspecting `pricing_study_example1_analyst_tracker.xlsx`, the real row order is
document-major: `Market → Market Quote Number → Client Source Unit (clustered) →
items`. Within a Market Quote the source units and items appear in the **brief's
authored order**, not alphabetically (e.g. source units `BRC8T450X, BRC8T220S,
BRC8T180F, ITR336490G` — not A→Z; items within a source unit in no numeric
order). ADR-0029's stated `Client Item Number → Quote Line Number` sort already
did not match this — it was a pragmatic reconstruction, since `quoteLineNumber`
is assigned at line-creation time, not in brief order.

## Considered options

- **Reproduce brief/import order (full artifact fidelity).** Rejected: there is
  no persisted import ordinal on `BenchmarkItem` (only `createdAt` and a cuid
  `id`), and re-import upserts on `(study, country, clientItemNumberKey)`, so
  brief order is not recoverable. Honoring it would require adding and maintaining
  an import-ordinal column captured at import and preserved across re-imports —
  cost not justified by byte-for-byte sequence fidelity.
- **Alphabetical, overriding the artifact (chosen).** Source Unit A→Z then Client
  Item Number A→Z is fully derivable from existing fields, deterministic, and
  more navigable for humans scanning a document's lines. Within one Market Quote
  there is exactly one line per Benchmark Item, so `(Market Quote Number, Client
  Item Number)` is already unique per country — the order is total, no tiebreaker
  needed.

## Scope and consequences

- **"Quote group" in the ordering means the Market Quote**, keyed on its stored,
  monotonic-per-`(study, country)` **Market Quote Number** — *not* the transient
  Quote-Group collection lens (CONTEXT.md), which is never persisted and cannot
  be sorted on.
- **Document-major means items repeat.** A Benchmark Item priced by N dealers
  appears once under each of its N Market Quotes. This is the line-level shape,
  distinct from the old item-major iteration.
- **Part-only surfaces degrade gracefully.** The researcher collection surface
  lists Benchmark Items *before* any Market Quote exists, so it has no Market
  Quote Number to sort on; it orders by `Client Source Unit (A→Z, nulls last) →
  Client Item Number (A→Z)`.
- **The review queue is exempt.** It stays FIFO by `submittedAt` (oldest-first),
  a fairness/SLA work-queue ordering, not a catalog view.
- **Client Item Number sorts as a string** (A→Z / 0→9), not by numeric value —
  the numbers are alphanumeric (e.g. `BRC8T450X`) with no numeric interpretation.
- ADR-0029 remains in force for everything except the row-order clause it
  defined; this ADR narrows it.
