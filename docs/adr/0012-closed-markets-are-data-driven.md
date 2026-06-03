# Closed markets are data-driven, not calendar-driven

ADR-0004 fixed the strategy: pin the **historical** rate for a Quote's Date
Quote Received, and on a market-closed date use the **nearest prior business
day's** rate, recording which date was used. This ADR fixes the *mechanism* for
"nearest prior business day" — the part that looked, at first, like it needed a
holiday calendar.

It does not. A market is treated as **closed precisely when the provider has no
rate for that date** — nothing more. The `RateProvider` port answers for one
exact date and returns `null` when it has no data; the resolver walks back one
calendar day at a time until a rate appears, **bounded at 7 days**
(`MAX_LOOKBACK_DAYS`), and pins the date it landed on as `rateDate`:

```
resolveExchangeRate(provider, currency, targetDate, 7)
  → { ok: true, rate, rateDate }      // the nearest prior date with data
  → { ok: false, reason: "no-rate-in-window" }
```

## Why data-driven

The obvious alternative is **calendar-driven**: encode a weekend (and holiday)
calendar in the core, compute "is this a business day?", and step to the prior
business day *before* asking the provider. We rejected it for three reasons.

- **Holidays are a bottomless calendar.** They differ per country/currency,
  shift year to year, and would need ongoing maintenance — a permanent source of
  staleness bugs for a detail that is incidental to the product. Defining
  "closed" as "the provider has no data" gets holidays, half-days, and ad-hoc
  market closures **for free**, because all of them surface the same way: no rate.

- **The provider is the authority anyway.** The rate either exists for a date or
  it doesn't. A locally-maintained calendar can only ever *disagree* with the
  provider, and when it does, the provider wins. So the calendar adds work and a
  way to be wrong, with no authority of its own.

- **It keeps the walk-back purely testable.** Because "closed" is just a `null`
  from an injected port, the entire nearest-prior behaviour is exercised by
  seeding an in-memory fake with gaps and asserting the chosen `rateDate` — no
  clock, no calendar fixtures, no network (issue #9's "conversion core
  unit-tested").

The 7-day bound is the backstop: a genuinely-uncovered currency (or a deep
outage) walks back a week, finds nothing, and falls through to `pending` →
the analyst's **manual override** (ADR-0004), rather than looping or guessing.

## Consequences

- **No holiday calendar exists, by design.** A future engineer who "improves"
  conversion by adding one is reintroducing exactly the maintenance burden and
  provider-disagreement this decision removed. Don't — fix the adapter or the
  data instead.

- **The seam is the port, not a calendar.** The bounded walk-back lives *above*
  `RateProvider` (in `resolveExchangeRate`), so the real exchangerate-api adapter
  (#10) only has to answer one honest question — "rate for this exact date, or
  null?" — and normalize the vendor's base→target figure to the port's "USD per
  unit of local currency" convention. Everything about closures stays vendor-
  agnostic and in one place.

- **A live vendor that carries forward Friday's rate over a weekend is fine.**
  If exchangerate-api returns Friday's rate for a Saturday query, we simply never
  see a `null` there and pin Saturday as `rateDate` — still correct, still "the
  rate in effect on that date." The contract (`null` ⇒ walk back) and the live
  behaviour coexist without special-casing; reconciling the two is the adapter's
  job in #10.

- **7 days is a deliberate ceiling, not a magic number.** It comfortably covers
  any real weekend+holiday run while keeping a stuck currency from silently
  walking back indefinitely. Changing it is a one-constant change with no schema
  impact; the *shape* of the decision (bounded, then pending) is what's load-
  bearing.
