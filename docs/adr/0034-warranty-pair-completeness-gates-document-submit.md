# Warranty value+unit pair-completeness gates document submit

A [[Quote Line]] carries up to two warranties, each a **value + unit** pair
(`warranty1Value`/`warranty1Unit`, `warranty2Value`/`warranty2Unit` — CONTEXT.md).
Both are **optional competitive context**: a line with no warranty at all submits
fine, and warranty is *not* in `LINE_REQUIRED_TO_SUBMIT`. But a **half-filled
pair** — a value with no unit (`3` / —) or a unit with no value (— / `year`) — is
incoherent data: `"3"` of what, or a bare `"year"` quantifying nothing. So warranty
imposes a **consistency** constraint, not a presence one: *if either half of a pair
is set, the other half is required.*

This constraint is enforced **at document submit**, inside `submitDocument`
(ADR-0026: submit is the one bulk, all-or-nothing transition). A [[Draft]] line may
hold a half-filled pair while the researcher is still entering data; the
incompleteness is caught only when the whole [[Market Quote]] is submitted, reported
through the **same** `IncompleteLine.missing` channel as the required-to-submit
fields — the missing *half's* field key (`warranty1Unit`, `warranty2Value`, …) is
pushed into the list and rendered via `FIELD_LABEL` like any other gap.

This **reverses, narrowly, an invariant** the lifecycle previously asserted in code:
*"Optional competitive context is omitted — it never gates submit."* Warranty now
*conditionally* gates submit. It still never gates on **presence** (you may omit it
entirely); it gates only on **internal coherence** of a pair the researcher chose to
start filling.

## Considered options

- **Enforce on every line save** (reject a half pair the moment the line is
  written): rejected — it blocks a Draft from holding work-in-progress, fighting the
  "a Draft saves partial data" model, and would need the same check duplicated in
  every line-write path (create / addLine / editDraft). Submit is the natural,
  already-all-or-nothing gate.
- **No constraint — store half pairs, let exports emit them**: rejected — a bare
  `3` warranty value or orphan `year` unit is meaningless to the client consuming
  the export, and there is no later gate that would ever catch it.
- **Make warranty a normal required-to-submit field**: rejected — warranty is
  genuinely optional; most lines have none, and forcing it would block legitimate
  no-warranty quotes.

## Consequences

- The lifecycle's "never gates submit" comment is now **false as stated** and is
  updated: warranty is the one piece of optional context that *can* block submit,
  on coherence rather than presence.
- `SubmittableLine` gains the four warranty fields so `submitDocument` can see them;
  they are pair-checked, not presence-checked. The repository that builds
  `SubmittableLine` from DB rows must project them.
- The pair check emits a **synthetic** missing-field key for the absent half, so no
  new result shape or UI message path is needed — `FIELD_LABEL` simply learns the
  warranty keys.
- In-app the warranty **value** input is thousands-grouped at rest (reusing the
  ADR-0033 input-grouping approach, but unit-agnostic — warranty is not money, so no
  currency/minor-unit logic); the **export stays a raw ungrouped number**, exactly
  as price does under ADR-0033. The two-surface divergence is unchanged.
</content>
</invoke>
