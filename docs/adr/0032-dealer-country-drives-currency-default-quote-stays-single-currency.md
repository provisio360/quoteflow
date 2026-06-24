# Dealer Country drives the currency default; the quote stays single-currency

The single free-text "Dealer location" on a [[Market Quote]] is split into a
validated **[[Dealer Country]]** (a canonical ISO 3166-1 English short **name**,
reusing the same `ISO_3166_COUNTRY_NAMES` vocabulary the market [[Country]] already
validates against — not a new alpha-2 representation) and a free-text **dealer
locality** (the renamed `sourceLocation` → `sourceLocality`). The Dealer Country's
only behavioural role is to **supply the default local currency** (one ISO 4217
code per country, from a static bundled map) which the researcher may **override to
another single code** — the document still pins **one** currency and **one**
[[Exchange Rate]], leaving ADR-0004 and the [[Conversion Status]] machine
untouched. Currency moves from a free-text box to a validated picker. Both Dealer
Country and locality are required-to-submit; the existing single export "Source
Location" column is preserved by **composing** `locality, CountryName` (ADR-0029
artifact shape intact).

## Why the dealer's country, not the market's

The default currency follows **where the dealer sits**, not the [[Country]] being
priced. A dealer physically in one country routinely quotes parts for another
market's [[Benchmark Item]]s, and the price they give is in *their* local currency,
not the market's. Defaulting from the market `country` would prefill the wrong
currency for every cross-border source. Dealer Country is therefore purely
descriptive provenance — it never scopes Market Quote numbering, release, or tenant
isolation (those stay on the market `country`).

## Considered and rejected

- **Multiple currencies per quote** (read "also offering other currency options" as
  per-line currencies). Rejected: ADR-0004 pins exactly one [[Exchange Rate]] per
  document and every [[Quote Line]] converts at it; per-line currencies would mean
  multiple pinned rates and a rewrite of the [[Conversion Status]] machine. The
  "options" are an *override of the single document currency*, not a multiplicity.
- **Default the currency from the market `country`.** Wrong for any dealer quoting
  outside the market being priced (see above).
- **Validate the market `country` to the same ISO list now.** Out of scope: market
  `country` carries import-upsert (ADR-0009) and per-country release (ADR-0016)
  dependencies; revalidating it widens blast radius for no gain to this change. It
  deliberately stays free-text — the asymmetry (dealer country validated, market
  country not) is a scope boundary, not an oversight.
- **Add a separate "Source Country" export column.** Rejected: the legacy artifact
  has one location column (ADR-0029); the split is an internal data-quality
  improvement, not a reshape of the client deliverable, so we compose instead.
- **Store Dealer Country as ISO 3166-1 alpha-2 codes.** Rejected: the market
  [[Country]] is already stored as a canonical English short *name* (`countries.ts`);
  a second representation would need cross-mapping and diverge from the value the
  export composes. Dealer Country reuses that same name vocabulary.

## Consequences

- Currency validation is **forward-only**: new and edited documents must pick a
  valid ISO 4217 code; pre-existing free-text currency values are tolerated, not
  rejected. `sourceCountry` is nullable so legacy rows (and their already-pinned
  conversions) are untouched until next edit.
- Changing Dealer Country in the entry form **re-applies** that country's default
  currency (client-side convenience); the server still validates a single currency
  at the bulk submit gate.
</content>
</invoke>
