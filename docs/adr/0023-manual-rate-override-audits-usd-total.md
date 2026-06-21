# A manual rate override audits the converted USD total, not the raw rate

> **Amended by ADR-0026.** The override now acts on a **Market Quote** (one rate
> per document), so it is **one audit event per document** whose before/after is
> the **document-total** converted USD (summed across the document's lines). The
> "audit the money that moved, not the raw rate" principle below is unchanged.

Issue #70 wires the [[Analyst]]'s manual [[Exchange Rate]] override for a [[Quote]]
whose currency the provider doesn't cover — the first action to use the
before/after monetary pair ADR-0019 left generic for "a future price-bearing
action (e.g. a manual rate override)". This ADR records *what value that pair
carries*, because the obvious-looking answer (the rate the analyst typed) is the
wrong one and a future reader will otherwise try to "fix" it.

## Decision

The new `manualRateOverride` [[Audit Action]] writes `beforeValue = null`,
`afterValue = convertedUsdPrice` (the newly-pinned USD **total**). The raw
exchange rate the analyst entered is recorded on the Quote itself
(`Quote.exchangeRate`), not in the audit pair.

## Why not the rate

The audit `beforeValue`/`afterValue` columns are `Decimal(14,4)`, sized to match
`BenchmarkItem.clientPrice` (ADR-0019). A pinned exchange rate is
`Decimal(18,8)` — a small rate such as `0.00012345` would be silently truncated
to `0.0001` if forced into the audit pair, producing a *wrong* number in an
append-only log that is never corrected by edit. The pair is a **price** channel,
not a rate channel.

`convertedUsdPrice` is a genuine USD money figure that fits `Decimal(14,4)`
exactly, is always present once converted (price is required at submit), and is
the monetary *outcome* an auditor cares about — the USD figure that becomes
visible and feeds the benchmark. `before` is `null` because a `pending` quote has
no USD figure to move from.

## Consequences

- The audit log answers "what USD value did this override produce", not "what
  rate did the analyst type". The rate (and `rateDate`) remain queryable on the
  Quote row, so nothing is lost — the two stores are complementary.
- This satisfies the debt ADR-0019 flagged: `conversion.ts` and CONTEXT's
  Exchange Rate term say the override is "audited (#16)"; that reference lands
  here, with the rate-override slice, as ADR-0019 anticipated.
- `convertedUsdPricePerUnit` may be null (a quote with no quantity), which is why
  the **total**, not the per-unit, is the audited figure — the per-unit is not
  reliably present, the total always is.
