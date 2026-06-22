# Resubmitting a revised line re-derives USD from the pinned rate

Amends **ADR-0026**.

A [[Quote Line]] that is rejected, revised back to Draft, and resubmitted into a
document whose conversion is already `auto`/`manual` does **not** re-pin the
document's [[Exchange Rate]] (the date lives on the document and cannot change
under a line). But "no re-conversion" governs the **rate**, not the line's stored
USD figure: at resubmit we **re-derive** that line's `convertedUsdPrice` /
`convertedUsdPricePerUnit` from the document's already-pinned rate, in the same
transaction as the Draft → Submitted move.

## Why

The background sweep (ADR-0013) only scans `pending` documents, so it never
revisits a line whose document is already converted. If the analyst rejected the
line because its **price** was wrong and the researcher fixed it, freezing the old
USD figure would let the corrected line be approved carrying a USD derived from the
rejected price — a silent correctness bug. Re-deriving from the pinned rate keeps
the figure honest while still honouring the "one rate per document, pinned once"
invariant.

A resubmit into a still-`pending` document needs no re-derivation: the worker fills
every line's USD when it pins the rate.

## Considered and rejected

- **Freeze the figure** (leave whatever USD was last computed): the obvious reading
  of "no re-conversion", but it reintroduces the stale-USD-on-corrected-price bug.
- **Re-pin / re-fetch on resubmit**: violates ADR-0026's one-rate-per-document rule
  and would let a line silently move the document rate.
