# The audit-log view is gated to Client-Price viewers (Analyst + EM), not all internal staff

Issue #72 adds the first **read path** over the [[Audit Event]] stream that ADR-0019
shipped write-only: an internal, per-study audit-log view reached from the Study
detail page. The view renders each event's actor, timestamp, [[Audit Action]], and
subject — and, for the monetary-pair actions, its **before/after** values.

The issue framed the access boundary as "internal-only," with the only named threat
being **client** users (TC040): the log carries [[Client Price]] before/after, and
ADR-0003 forbids Client Price ever crossing to client users. So it specified the
ordinary **internal page guard** (`requireInternalPage`).

That guard is too wide. It admits **Researchers**, and ADR-0003 hides Client Price
from Researchers too — *"Hidden from researchers (to avoid biasing the quotes they
collect) **and** never shown to clients."* A `clientPriceChange` event shows the
actual Client Price values, so a Researcher opening the view would see Client Price.
The issue's own constraint ("use the internal page guard") would have caused the very
leak it set out to prevent.

## Decision

The audit-log view is gated to the staff who may **see** Client Price — **Analyst and
Engagement Manager** — not to all internal staff.

A new pure predicate `canViewClientPrice(principal)` (internal && Analyst‖EM) in
`src/domains/authz/benchmark-items.ts` names this boundary and gates both the page and
its Study-page link. The page applies it as defence in depth: `requireInternalPage()`
first ("is internal at all"), then a redirect if `!canViewClientPrice` ("may see
Client Price"). A Researcher gets no link and is bounced from the URL.

This separates **viewing** Client Price from **maintaining** it. The existing
`canMaintainClientPrice` is **Analyst-only** (only the Analyst owns the value,
ADR-0015) — reusing it would have wrongly excluded the Engagement Manager, who may
already see Client Price via the [[Internal Export]]. `canViewClientPrice` is the
broader **view** boundary; `canMaintainClientPrice` the narrower **edit** boundary.

The population `canViewClientPrice` describes is exactly the [[Internal Export]]'s
("Analyst + Engagement Manager only — never a Researcher"), which until now asserted
that set inline. This predicate gives that boundary a name; a later change may route
the Internal Export gate through it too.

## Consequences

- "Internal-only," for a Client-Price-bearing surface, means **Analyst + EM**, not the
  bare internal guard. A reviewer adding another Client-Price-bearing screen should
  gate it with `canViewClientPrice`, not `requireInternalPage` alone.
- TC040 ("client denied") is necessary but **not sufficient**; the gate is also tested
  for **Researcher denied** — the boundary ADR-0003 actually cares about here.
- There are now two Client-Price authz predicates that must not be confused:
  `canViewClientPrice` (Analyst+EM, read) and `canMaintainClientPrice` (Analyst, write).
- The view is read-only and study-scoped; "tenant isolation" for it reduces to study
  scope plus this gate (internal staff are not tenant-bound — ADR-0008), with the
  RLS backstop (ADR-0021) underneath.

## Considered and rejected

- **Reuse `requireInternalPage` alone** (as the issue specified). Leaks Client Price to
  Researchers via `clientPriceChange` before/after — an ADR-0003 violation.
- **Reuse `canMaintainClientPrice`** (Analyst-only). Closes the leak but wrongly
  excludes the Engagement Manager, who already sees Client Price through the Internal
  Export. Conflates the edit boundary with the view boundary.
- **Keep the page open to all internal staff, redact before/after for Researchers.**
  More code and a partial-view oddity (a Client-Price-change row with blank values),
  for no gain over simply gating the page — a Researcher has no reason to read the
  Client-Price audit history at all.
