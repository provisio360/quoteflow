# Bulk import is the source of truth on re-import (overwrites, never deletes)

Benchmark Items enter a study through an all-or-nothing spreadsheet import that
upserts on the item's identity, **(client part number + country)**. This ADR
records two re-import semantics that are easy to get wrong and surprising after
the fact, and why we chose them.

## The file wins — every column, every time

A re-import **overwrites every column it carries**, including the **Client
Price**. There is no per-field merge and no "leave unchanged if blank" carve-out:
the row in the file is the new truth for that Benchmark Item.

This **deliberately overrides ADR-0003**, which says the Client Price is the
analyst's to enter and maintain. After this decision the Client Price has **two
writers** — the analyst (in-app) and the importer (the spreadsheet) — and on any
re-import the **file wins**. The realistic loss is concrete: an analyst refines a
Client Price in-app, an Engagement Manager later re-imports a brief to fix an
unrelated typo, and the analyst's value is silently reverted to whatever the
spreadsheet's Client Price column still held.

We accepted this over the alternatives — "never overwrite Client Price after
first set" and "overwrite only if the file's value changed since last import" —
because a single, uniform rule ("the file is truth") is far easier to reason
about and to explain to the Engagement Managers who run imports than a
column-by-column ownership model with hidden exceptions. The mitigation is the
append-only **audit log** (story 42), which records Client Price before/after on
every change, import-driven ones included: the overwrite is traceable, not
invisible. Client Price is required and positive in every row, so an import can
only ever set it to a real value — it can never blank one out.

## The file is truth for the rows it contains — not a mirror

Import only ever **inserts or updates**. A Benchmark Item that exists in the
study but is **absent** from the re-imported file is **left exactly as it is**,
with its collected Quotes intact. Import never deletes.

We rejected "the file is the complete authoritative set, prune anything missing"
because a single trimmed or mis-saved spreadsheet would cascade-destroy
researchers' collected Quotes, with no UI to recover them. Removing a Benchmark
Item is therefore a separate, deliberate in-app action (a later slice), never a
side effect of an import. "The file is truth" is scoped to the rows the file
contains, not to the study as a whole.

## Consequences

- An import can change or correct an item, and can add items, but can never
  remove one. The set of Benchmark Items in a study only grows through import.
- Client Price overwrites must be legible after the fact: the audit-log slice is
  load-bearing for this decision, not optional polish.
- A future engineer who sees an analyst's Client Price edit "lost" after a
  re-import, or items lingering that aren't in the latest file, is looking at
  this decision working as designed — do not "fix" it by adding silent merges or
  prune-on-import.
