# A study-scoped manual exchange-rate table pins as `study-rate`, ahead of the provider

ADR-0004 fetches the **historical** rate for a [[Market Quote]]'s Date Quote
Received from a paid provider and pins it; ADR-0013 makes that a **deferred**
background sweep; ADR-0023 lets an analyst hand-set a rate **per document** for a
currency the provider doesn't cover. All three remain. This ADR adds a fourth
source that sits **ahead** of the provider: a per-[[Pricing Study]] table of
manual rates an [[Engagement Manager]] or [[Analyst]] seeds up front.

The motivation is operational, not architectural: **until the provider plan is
fully in use**, the study still needs USD conversions — and, more importantly,
needs them **at entry time** so the researcher sees a live USD-per-unit (and the
peer-spread nudge, ADR-0042) while collecting. The deferred sweep cannot give a
researcher anything during collection; a pre-seeded table can.

## Decision

A new **[[Study Exchange Rate]]** entity holds rows keyed
`(study, currency, rateDate)` — currency is ISO 4217, the conversion is
currency→USD, and the rate follows the **currency**, never the country (see
"Keyed by currency" below). EM/Analyst enter them on the study setup surface.

**Lookup (identical at preview and at pin).** Given a document's currency and its
Date Quote Received, take the table row for that currency with the **greatest
`rateDate ≤ Date Quote Received`**, walking back as far as **study start** (no
rolling window). We never reach *forward* to a later row (that would be a future
rate for a past quote). Staleness is **visible, not blocking**: the picked row's
`rateDate` and age are surfaced so a researcher pinning an old rate sees it.

**Precedence and pinning.** If the lookup finds a row:
- **At entry** the UI computes a **live preview** USD from it — pure display, the
  line stays [[Draft]] and `conversionStatus` stays `null`.
- **At submit** that same rate **pins immediately** with a new
  `conversionStatus = study-rate` provenance (see ADR amendment to Conversion
  Status). No `pending`, no worker wait — the analyst can act at once, and **the
  pinned USD equals the preview the researcher saw** (the lookup rule is the same
  in both places).

If the lookup finds **nothing** (currency absent, or quote dated before the
earliest row): the researcher is **warned** at entry ("no saved rate — USD fills
in later"), and the document follows the **existing** `pending` → worker path
unchanged. This is the graceful fallback and the "until full provider use" exit:
stop filling the table and every study reverts to `auto`.

**The pin is sticky and immutable.** The background worker selects `pending` rows
only, so it never touches `study-rate` (as it never touches `auto`/`manual`).
And, per ADR-0004's core invariant — *a quote's USD conversion never shifts after
the fact* — **editing a table row never re-pins already-converted documents**; it
changes only **future** pins. A document pinned from a value later found wrong is
corrected the existing way, via the per-document `manual` override (ADR-0023).

## Keyed by currency, entered by country

The entry UX is country-first (pick a country → its local currency
autopopulates), but the stored key is **currency**, because:
- **Shared currencies.** A study with France + Germany must not be able to hold
  two contradictory EUR rates for one date. One currency → one rate per date.
- **Dealer-country currencies.** ADR-0032 makes the **dealer country** drive a
  document's currency. A Brazil-market quote from a Colombian dealer is in **COP**
  — a currency no study *market* country implies. So the country picker is **any
  ISO country** (plus a direct currency add), with the study's market countries
  merely pre-suggested. The set of currencies a study needs is open-ended and
  back-filled reactively as new dealer currencies appear.

USD needs no row (rate ≡ 1).

## Why a new provenance instead of reusing `manual`

A `study-rate` pin is human-supplied and sticky **like** `manual`, but it is
**automatic at submit** and must **not** write the per-document
`manual-rate-override` audit event (ADR-0023 — that event is an analyst hand-
typing a rate for *one* document). Conflating the two would either spam the audit
log with an event per submit or lose the provenance distinction. A distinct
status keeps "came from the study table" and "analyst overrode this one doc"
separable.

## Why audit table edits with a null monetary pair

Setting/editing a rate is money-affecting config: one wrong row pins many
documents. So a new `study-rate-set` [[Audit Action]] records who/when/which
`(currency, date)`. It carries a **null** before/after pair — a rate is
`Decimal(18,8)` and would be silently truncated by the audit pair's
`Decimal(14,4)` (ADR-0023's exact reasoning), so like `assign`/`import`/`release`
it logs the event without the monetary pair. The rate values live on the
Study Exchange Rate row.

## Consequences

- **`conversionStatus` gains a fourth value**, `study-rate`, and the invariant
  becomes: `null` ⇔ not-yet-submitted; once submitted, either pins `study-rate`
  immediately (table hit) **or** `pending → auto/manual` (table miss).
- **Preview == pinned** is the load-bearing guarantee: the entry-time USD a
  researcher sees is the USD that pins, because both run the same lookup.
- **Conversion is no longer always deferred.** A table hit converts at submit;
  only table misses defer to the worker. Approval's `pending` gate (ADR-0013) is
  unaffected — a `study-rate` document is simply never `pending`.
- **The table is best-effort, not a guarantee.** Surprise dealer currencies and
  pre-earliest-row dates degrade to the worker; the live preview/nudge is silent
  there, by design.
</content>
</invoke>
