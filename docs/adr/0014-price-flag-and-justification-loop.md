# Out-of-range price flag and the justification loop

A Quote's USD price-per-unit is checked against its Benchmark Item's
[[Client Price]] and **flagged** when it diverges by more than the study's
**QC Threshold** (issue #11). The flag is advisory — it never auto-rejects — but
approving a flagged Quote first requires a **justification** from the quote's
author, gathered by returning the quote down the existing reject → revise →
resubmit loop. Three sub-decisions below are non-obvious and load-bearing.

## The divergence measure: relative percent difference, not "% of benchmark"

A flag is raised when

```
percent_diff = |usdPricePerUnit - clientPrice| / ((usdPricePerUnit + clientPrice) / 2) * 100
```

exceeds the study's QC Threshold. We use the **symmetric** relative percent
difference (the mean of the two values as denominator), not the asymmetric
"percent of the benchmark" (`|a - b| / b`). Reasons:

- It is **direction-neutral**: a quote at 2× the benchmark and a benchmark at 2×
  the quote produce the same magnitude, which matches "how far apart are these
  two numbers" rather than "how much does the quote deviate from the reference."
- It keeps **one study-wide percentage** meaningful across cheap and expensive
  parts, so the threshold lives on the **Study**, not per-item.

The flag itself is **binary** (the formula takes an absolute value); the
*direction* (dearer/cheaper than benchmark) is computed separately for display
only.

## The flag is computed after submit, never at submit

Conversion is a **deferred** background sweep (ADR-0013): at submit there is no
USD price-per-unit yet, so the flag is not knowable then. The flag is therefore
evaluated only once a Quote is converted (`auto`/`manual`). A `pending` Quote is
**not comparable** and never flagged. This is why the justification rule cannot
be a submit-time gate on the researcher — it has to be an after-the-fact loop.

## Justification is gathered by returning the quote to its author

Researchers cannot see the [[Client Price]] (ADR-0003, to avoid biasing the
quotes they collect), so a researcher **cannot self-assess** whether a price is
out of range and cannot justify up front. So:

- A flagged Quote with no justification **cannot be approved** — this is a
  *second* approval gate alongside conversion-pending.
- To obtain a justification the analyst **returns** the quote to its author,
  reusing the **reject → revise → resubmit** loop rather than adding a new
  lifecycle state. The rejection reason states only the **direction**
  ("higher/lower than expected"), never the benchmark value, preserving ADR-0003.
- The author adds a **justification** (a dedicated field, distinct from free-text
  notes) and resubmits. Unlike the rejection reason — cleared on resubmit — the
  justification **persists**, because the analyst needs to read it to approve.

The flag stays **advisory**: an analyst may approve a flagged-but-justified
quote, or outright reject one they judge simply wrong.

## Considered and rejected

- **Asymmetric "% of benchmark."** Simpler, but direction-sensitive and would
  more often need per-item tuning. Rejected for the symmetric measure above.
- **Block approval outright on a flag (hard gate).** Contradicts the product
  rule that a genuinely-correct out-of-range price can still be approved once
  justified.
- **Make the researcher justify at submit.** Impossible: the flag isn't known
  until conversion (deferred), and researchers can't see the benchmark anyway.
- **Auto-bounce flagged quotes to the author** before they reach the analyst.
  Rejected for v1: keeps a single entry path into the queue, leaves the analyst
  in control (they may reject rather than ask), and avoids a side-effect in the
  conversion worker.
- **A distinct "needs-justification" state.** Rejected: the existing
  reject/revise loop already carries "return to author with a reason"; a new
  state adds machinery for no new behaviour.

## Consequences

- **Study gains a required QC Threshold.** A non-null column added in #11;
  existing (pre-launch, test-only) studies are backfilled with a placeholder, and
  study setup captures it going forward.
- **Quote gains** `submittedAt` (FIFO queue ordering, stable under the conversion
  worker's writes), `rejectionReason`, `reviewedById`/`reviewedAt` (latest verdict
  only; full history is the audit slice #16/#42), and a `justification` field.
- **The flag check is pure and unit-tested** in the quotes decision core,
  alongside the lifecycle transitions, taking primitives (the two prices, the
  threshold, the justification presence) so it needs no DB or network.
