# Warranty Offered is a required gate; the pairs ride under it

A [[Quote Line]]'s [[Warranty]] grows a Yes/No **Warranty Offered?** gate (a new
nullable-boolean line field, tri-state `null`/`true`/`false`, mirroring
`discountAvailable`'s storage). The single gate covers **both** warranty pairs: under
**Yes** the up-to-two value+unit pairs are shown and captured; under **No** (or blank)
the pairs are hidden, and on save the four pair fields are **cleared to null** so the
DB never carries a "No" line with a residual warranty. We chose one gate over the whole
warranty rather than a gate per pair — "does this dealer offer warranty" is one business
fact, and the second pair already expresses "no further warranty" by being blank.

**Warranty Offered? is required to submit.** A blank answer blocks the
document's [[document submit|Quote Lifecycle]], reported through the same
`IncompleteLine.missing` channel as every other gap. This is a deliberate **asymmetry**
with the discount chain, whose `available` gate is *not* in `LINE_REQUIRED_TO_SUBMIT`
and submits fine when blank: a researcher must affirmatively state whether warranty is
offered, but need not state whether a discount was available. Under **Yes**, the existing
ADR-0034 pair-coherence rule still applies (a half pair blocks); a **Yes with both pairs
empty submits fine** — "warranty offered, none specified" is a coherent end-state, exactly
as discount allows `available = Yes` with no type/applied.

When Offered is not Yes, the warranty pairs are treated as **absent** for submit — the
coherence check is short-circuited regardless of any DB residue, since save nulls them.

**No export column.** The legacy artifact has no "Warranty Offered" column (it runs
Warranty Value/Unit 1 & 2 straight into "Discount Available"), so per ADR-0029 the field
never crosses to either export. Consequently a "No" line and a "Yes with no pairs" line
export identically (all warranty cells blank); the offered-distinction lives only in-app.

**Backfill:** the migration seeds `warrantyOffered = true` for existing rows where either
pair has a value (a filled warranty was unambiguously offered), and **null** otherwise —
an empty-warranty line is genuinely ambiguous between "not offered" and "not yet answered,"
and null correctly forces the researcher to answer before submit rather than fabricating
a "No."

## Relationship to ADR-0034

This **amends** ADR-0034's stance that warranty "still never gates on presence; it gates
only on coherence." That remains true of the **pairs** — presence of a warranty value is
never forced. But the **Offered answer itself** is now a presence gate: warranty becomes
the one competitive-context field required to submit on presence, while staying coherence-
only on its pairs.

## Considered options

- **Mirror discount exactly — Offered optional, blank submits fine**: rejected. The user
  wants an affirmative answer; "no warranty offered" and "haven't said" are meaningfully
  different and only an explicit answer distinguishes them.
- **A gate per warranty pair**: rejected — a "No" on pair 2's gate is indistinguishable
  from leaving pair 2 blank, which the pairs already express. One gate, two pairs.
- **Add a "Warranty Offered" export column**: rejected — breaks the column-for-column
  artifact fidelity of ADR-0029; the legacy sheet never carried the distinction.
- **Backfill empty-warranty rows to No**: rejected — fabricates an answer the researcher
  never gave; null is the honest "still unanswered."

## Consequences

- `SubmittableLine` gains `warrantyOffered`; `submitDocument` reports it missing when
  null, and skips the two warranty pairs' coherence check when it is not `true`.
- The save path (editor + line writers) nulls all four pair fields whenever Offered ≠ Yes,
  keeping the DB free of "No + stored warranty" contradictions.
- Batch Line-Fill's two warranty pair groups collapse into one gated `warrantyGroup`
  (Offered → both pairs), so the editor and panel never diverge (ADR-0036). CONTEXT's
  batch group count drops from six to five.
- The shared field widget gains the Offered gate above the two `ValueUnitField` pairs,
  mirroring `DiscountField`'s `available` gate.
