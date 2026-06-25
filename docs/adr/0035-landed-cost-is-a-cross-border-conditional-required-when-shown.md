# Landed Cost is a cross-border conditional, required when shown

A [[Quote Line]] carries a **[[Landed Cost]]**: an *Included?* flag (does the quoted
[[price]] already include the cost of getting the part to the customer — shipping,
duties, import handling) plus an optional free-text *Note*. Landed cost only *means*
anything when the part crosses a border to reach the market: if the
[[Distributor/Dealer]] sits in the same country as the market being priced, there is
nothing to land. So the researcher is **only asked** for Landed Cost when the
[[Dealer Country]] differs from the market [[Country]], and **when asked, must
answer** (Yes/No) before the [[Market Quote]] can be submitted.

This couples a **line's** submit-readiness to a **document-level** comparison. A
Market Quote holds exactly one Dealer Country (`sourceCountry`, on the header) and
covers exactly one market Country, so "does landed cost apply?" is decided **once per
document**, not per line — but it is *enforced* per line, because every Draft line in
a cross-border document must carry a non-null `landedCostIncluded` to submit.

## The two behaviours

1. **Visibility (entry):** the in-app entry form renders the Landed Cost question
   only when a *real* Dealer Country is selected **and** it differs from the market
   Country. A blank Dealer Country shows nothing (no provenance yet to judge). If the
   researcher toggles the Dealer Country back to *match* the market, the field
   unmounts and therefore posts nothing — any value already captured clears, exactly
   as the discount chain's nested fields drop when their parent flips to No.
2. **Gating (submit):** inside `submitDocument` (ADR-0026: the one bulk,
   all-or-nothing transition), when `sourceCountry` differs from the market Country,
   `landedCostIncluded` becomes a **conditionally required** line field. An
   unanswered line is reported through the **same** `IncompleteLine.missing` channel
   as every other gap — the `landedCostIncluded` key is pushed into the list and
   rendered via `FIELD_LABEL`. The *Note* never gates; it is meaningful only when
   *Included?* is Yes and is dropped otherwise.

This **extends** the narrow reversal ADR-0034 already made (warranty *conditionally*
gates submit). Landed Cost now also conditionally gates — but on a **cross-entity
condition** (the document's Dealer Country vs market Country), not on a line-local
pair's coherence. It still never gates on a same-country (domestic) document.

## Considered options

- **Advisory, never gates (like stock status / discount):** rejected — for a
  cross-border quote, whether the price is landed materially changes how the client
  reads it; leaving it blank (which exports as "No") silently asserts *not landed*,
  which may be wrong. When the question is relevant, an explicit answer is required.
- **Always ask Landed Cost, every document:** rejected — a domestic quote has no
  landing to speak of; asking would be noise and would force a meaningless Yes/No on
  every same-country line.
- **Gate per line on the line's own data:** rejected — a line does not carry the
  Dealer Country (it lives once on the document header). Threading the document's
  Dealer Country + market Country into the line guard is the minimal way to decide
  the condition without denormalising Dealer Country onto every line.

## Consequences

- `SubmittableLine` gains `landedCostIncluded`, and `submitDocument` learns the
  market Country alongside the existing `DocumentHeader.sourceCountry`, so the guard
  can compute the cross-border condition once and presence-check the flag per line.
- The conditional uses the **same** canonical ISO 3166-1 vocabulary on both sides
  (Dealer Country and market Country validate against one list — see [[Dealer
  Country]]), so "differs" is a plain string inequality, no normalisation needed.
- The entry form needs both countries available at render: in *create* mode the
  Dealer Country is the live header select and the market Country is `mode.country`;
  in *edit* / *addLine* mode the Dealer Country is fixed on the saved header, so the
  document's Dealer Country + market Country are passed to the line editor as props
  and the decision is static.
- Reported through `FIELD_LABEL` like warranty — no new result shape or UI message
  path. The "never gates submit" lifecycle comment, already softened by ADR-0034,
  now also names Landed Cost as a conditional gate.
</content>
</invoke>
