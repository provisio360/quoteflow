# Currency conversion is a deferred background sweep, not fetched at submit

ADR-0004 chose to pin the **historical** rate for a Quote's Date Quote Received
behind a swappable `RateProvider`, and framed the background worker as the
*fallback* for when the provider is unreachable at submit time. This ADR refines
that: the worker is the **happy path, not the exception**. A Quote's conversion
is **never fetched synchronously at submit** — submit only marks the Quote
`pending`, and a background sweep fills the USD figures later (the "within ~24h"
the product owner expects).

## The mechanism

- **Submit sets `conversionStatus = pending`.** No API call on the submit path.
  This makes `pending` the normal initial state of every Submitted Quote, and
  preserves the invariant **`null` ⇔ Draft; once Submitted, always
  `pending → auto/manual`** (CONTEXT.md: Conversion Status).
- **A Graphile Worker cron task** (hourly) selects
  `state = Submitted AND conversionStatus = 'pending' AND dateQuoteReceived <
  current UTC date`, runs the pure `computeConversion` core against the live
  adapter, and pins `auto` on success. It never touches `auto`/`manual` rows —
  a `manual` override is sticky (ADR-0004).
- **The adapter calls `/history/USD/{Y}/{M}/{D}` once per distinct date** and
  reads `conversion_rates[currency]`, storing `1 / that` to honour the port's
  "USD per 1 unit of local currency" convention. One call per *date* serves
  every currency in that sweep's batch.

## Why deferred, not at submit

The obvious design is to convert synchronously when a researcher submits. We
rejected it for three reasons, the first of which is a correctness bug, not just
a preference.

- **A same-day quote's rate does not exist yet.** Historical rates are keyed to
  the **UTC day** and are not published until that day has closed. If we fetched
  at submit for a Quote dated *today*, the provider would return no data for
  today, and ADR-0012's nearest-prior walk-back would silently pin
  **yesterday's** rate as if the market were closed — wrong, and invisibly so.
  Waiting until `dateQuoteReceived < current UTC date` is what makes the
  walk-back's "`null` ⇒ closed market" assumption valid. The deferral is the
  fix, not a convenience.

- **Batching controls API cost and quota.** Grouping pending Quotes by date and
  fetching with `BASE = USD` collapses a whole sweep into one call per distinct
  date (all currencies in one response), instead of one call per submit. A
  per-submit fetch cannot batch.

- **One code path, and submit stays fast and offline-tolerant.** With deferral
  there is no "synchronous happy path plus asynchronous fallback" to keep in
  sync — there is just the sweep. Submit never blocks on, or fails because of,
  the FX vendor.

## Consequences

- **Latency is bounded by the sweep, not instant.** Hourly cron means typical
  fill within the hour and a ~24h ceiling. That is the product's expectation, not
  a regression.

- **#11's approval gate is a simple `pending` check.** Because a Submitted Quote
  is *always* `pending` until resolved (never a Submitted-but-`null` limbo),
  "block approval while conversion is pending" is exactly
  `conversionStatus === 'pending'` — no need to also guard an unconverted-Submitted
  case.

- **The submit one-liner ships in #10**, crossing the issue's stated "wire the
  adapter" boundary by a single line, because without it the background-fill
  acceptance criterion has no `pending` rows to resolve. This is deliberate.

- **Operational failures pile up silently, by choice (v1).** `invalid-key`,
  `quota-reached`, `inactive-account`, and `plan-upgrade-required` mean *every*
  conversion stays `pending` until a human fixes the account. For v1 the worker
  **logs at error level only**; the growing pending count is the signal. Active
  alerting (via the Notifications adapter) is deferred, not designed-out.

- **An uncovered currency wastes a bounded walk-back, then waits for manual.** A
  currency absent from a successful response is treated as `null` and exhausts
  the 7-day walk-back (ADR-0012) into `pending`, where it stays until an analyst
  supplies a manual rate. Acceptable: uncovered currencies are rare and the
  sweep only re-examines `pending` rows.
