# Quote numbering: a per-item monotonic counter, gaps are intended

> **Superseded by ADR-0026.** Quotes are no longer flat per-item rows: a
> **Market Quote** (dealer document) has many **Quote Lines**. Numbering moves to
> two per-(study, country) counters — Market Quote Number and a stable Quote Line
> Number — and `BenchmarkItem.quoteSeq` is removed. The gap-is-the-feature
> reasoning below still holds, one level up.

Each Quote carries a **Quote Number** that is unique *within its Benchmark Item*,
assigned the moment the Draft is created, and **never reused** — an abandoned or
rejected quote leaves a permanent gap rather than renumbering, so "Item 12, Quote
3" always denotes the same quote (CONTEXT.md: Quote Number).

## The mechanism

A `quoteSeq` counter column lives on **`BenchmarkItem`**. Creating a Quote
increments it atomically in the same transaction as the insert
(`UPDATE benchmark_item SET quoteSeq = quoteSeq + 1 ... RETURNING quoteSeq`) and
uses the returned value as the new Quote's number. A
`@@unique([benchmarkItemId, quoteNumber])` constraint is the backstop.

The atomic increment takes a row lock on the item, so two researchers creating a
Draft against the same item at the same instant **serialize** and receive
distinct consecutive numbers — with no `MAX`-race and no optimistic retry loop.
This is the same single-statement-atomic-write idiom the codebase already uses
for the first-come Primary Researcher claim (`selfAssignBenchmarkItem`'s
conditional `updateMany`), not a new concurrency strategy.

## Why a counter, not `MAX(quoteNumber) + 1`

The number is assigned at **Draft creation** (CONTEXT.md says an *abandoned*
quote leaves a gap — only something already numbered can be abandoned), and an
abandoned Draft is **hard-deleted** (a Draft is disposable working state; we do
not want an `Abandoned` state polluting the four-state lifecycle).

Those two facts are exactly what breaks `MAX(quoteNumber) + 1`: once the row that
held the highest number is deleted, `MAX` of the survivors drops, and the next
insert would **reuse** a number that has already meant a specific quote —
violating the never-reused contract. A counter that only ever moves forward is
immune: delete whatever you like, the next number is still `lastIssued + 1`. The
gap is the feature.

We rejected the alternatives:

- **`MAX + 1` + unique constraint + retry-on-conflict** — needs either a retry
  loop or a guarantee that rows are never hard-deleted (i.e. a soft-delete /
  `Abandoned` flag, adding a fifth lifecycle state we deliberately avoided). It is
  also more fragile under Neon's pooled (PgBouncer transaction-mode) connection,
  which ADR-0008 already flags for transaction-scoped plumbing.
- **A Postgres sequence per item** — sequences are not row-scoped data; creating
  and dropping one per Benchmark Item is heavyweight and awkward to keep in step
  with item lifecycle.

## Consequences

- Quote Numbers within an item are monotonic with **intentional gaps**. A future
  engineer who sees "Item 12 has quotes 1, 2, 4" is looking at an abandoned Draft
  3, working as designed — do not "repair" the sequence.
- A future engineer tempted to drop the `quoteSeq` counter and compute the next
  number with `MAX(quoteNumber) + 1` is reintroducing number reuse the moment a
  Draft is deleted — don't.
- The counter only ever increases and is never reset, including if every quote on
  an item is deleted; the next number continues from where it left off.
