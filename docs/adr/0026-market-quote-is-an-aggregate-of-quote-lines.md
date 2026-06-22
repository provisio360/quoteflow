# Market Quote is an aggregate of Quote Lines

The flat `Quote` of the v1 walking skeleton — one free-standing row per
competitor data point, with its own per-item number, dealer, date, currency and
conversion — is replaced by a two-level aggregate that matches how the work is
actually captured: a **Market Quote** (one dealer's quotation document) that
**has many Quote Lines** (one per Benchmark Item it prices).

This supersedes **ADR-0010** (per-item monotonic quote numbering) and amends
**ADR-0014** (one QC threshold per study) and **ADR-0023** (manual-rate-override
audit).

## What the source data showed

The real artifacts (`pricing_study_example1_*`) for one country are 6 dealer
quotes × 24 items = 144 rows, and every row carries a **Market Quote Number**
(1–6) that groups one dealer's quote across the whole item list: each group is a
single **Source**, on a single **date**, in a single **currency**, at a single
pinned **exchange rate** (`0.19727` across all 24 lines of market quote 1). The
real-world unit of collection is the dealer document, and `Required Quotes = 6`
means *six dealer quotes per item* — not six arbitrary rows.

A dealer who cannot price the whole list simply yields **fewer lines**; there is
no separate "by-row" entity — a one-line Market Quote *is* the by-row case.

## Decision

- **`MarketQuote`** owns the facts shared by all its lines: source
  name/location/url, `dateQuoteReceived`, `currency`, and the **single** pinned
  conversion (`exchangeRate`, `rateDate`, `conversionStatus`). It has **no
  lifecycle state of its own** — only a roll-up of its lines.
- **`QuoteLine`** owns the per-item facts and **carries the lifecycle state**
  (`Draft → Submitted → Approved/Rejected`, revise loop — the ADR-0014 state
  machine, unchanged, just attached to the line). Competitor brand, paper-quote
  flag and confidence code live on the line too: usually uniform across a
  document and defaulted once at entry, but they may legitimately vary line to
  line, so they cannot be document attributes.
- **Submit is bulk; verdicts are per line.** A researcher submits a Market Quote
  and all its lines transition `Draft → Submitted` together (and the document's
  rate pins once at that moment). The analyst then approves/rejects **each line**;
  there is no wholesale verdict on a document. This is forced by the Price Flag,
  which is per line (each line's USD/unit vs *that item's* Client Price).
- **Conversion is per document.** One date + one currency ⇒ one rate for every
  line; each line keeps only its *derived* USD figures. "Approval blocked while
  pending" becomes: a pending document blocks approval of all its lines. The
  revise loop no longer re-converts — a revised line keeps its parent's pinned
  rate (the date lives on the document and cannot change under a line).

### Numbering (supersedes ADR-0010)

Two numbers, both scoped **per (study, country)**, both allocated by the same
single-statement atomic-increment idiom ADR-0010 established (and which the
first-come Primary Researcher claim already uses):

- **Market Quote Number** — sequences the documents within a market (restarts per
  country; "Brazil quote 3"). Counts toward Required Quotes. Abandoning an
  unsubmitted document leaves a permanent gap.
- **Quote Line Number** — a **stored, stable** flat 1…N across the whole market
  (1…144 for 6×24), the citable handle that replaces the spreadsheet "Row Id"
  (which was a render-time row position, not a stable identity). Survives
  re-sort/re-export and the revise loop; a discarded line leaves a gap.

ADR-0010's `BenchmarkItem.quoteSeq` is removed. The counters now need a per-(study,
country) home — there is no guaranteed row at that grain (a `CountryRelease`
exists only after release) — so a lightweight **per-(study, country) sequence row**
holds `marketQuoteSeq` and `quoteLineSeq`, created lazily on first use and
incremented atomically (`UPDATE … SET seq = seq + 1 … RETURNING seq`). The
gap-is-the-feature reasoning of ADR-0010 carries over unchanged, one level up.

### Threshold (amends ADR-0014)

The QC Threshold becomes **per Benchmark Item with a study-level default**: the
bulk upload carries a per-item `Price Difference Threshold`, and an item that
sets none falls back to the study threshold (still required, so every item always
has one). Stored as a **fraction** (`0.8` = 80%) to match the relative difference
measure `|USD/unit − ClientPrice| / ClientPrice`. ADR-0014's "a relative measure
works across cheap and expensive parts" still holds; only the per-study
*uniqueness* is relaxed.

### Audit (amends ADR-0023)

Subject types become `MarketQuote` and `QuoteLine` (replacing `Quote`). `submit`
is **one event per document** (subject `MarketQuote`); `approve`/`reject` are
**per line** (subject `QuoteLine`). `manualRateOverride` is **one event per
document** carrying the document-total before/after converted USD (ADR-0023's
"audit the money that moved", summed across the document's lines, since one rate
now moves many line totals).

## Why not keep the flat per-item Quote

- It can't express the document-level facts (one source/date/rate) without
  redundantly repeating them on every row, and it can't express "this dealer
  priced 20 of 24 items" as a unit.
- `Required Quotes` would have to mean "rows", losing the "N dealers" semantics
  the client actually sets.
- Conversion would re-fetch and re-pin the same rate 24 times per document.

## Why line-level state, not document-level

A document-level verdict can't reject a single bad line, and it fights the
per-item Price Flag, Justification, and rejection reason — all of which are
inherently per item. Collection is naturally per document; **review is
irreducibly per line**. So state lives on the line and submission is the only
bulk transition.

## Consequences

- The `quote` table splits into `market_quote` + `quote_line`; the RLS backstop
  `clientId` (ADR-0021) is denormalized onto both.
- Import (ADR-0009) is unchanged in spirit and remains **items-only** — Quote
  Lines are entered in-app by researchers; the analyst_tracker / client_final_report
  are export shapes, never import inputs.
- Client Export = the client_final_report shape (one row per released+approved
  line, joined to its document, never Client Price or Paper-Quote); Internal
  Export = the analyst_tracker shape (every non-Draft line incl. Client Price,
  flag direction, justification, paper-quote).
- A future engineer must not reintroduce a document-level Approved/Rejected
  state, nor a per-line exchange rate — both were considered and rejected here.
- The split migration renames `quote` to `quote_line` **in place** (preserving each
  line's id) and retains the legacy `Quote` audit/notification subject value, so the
  append-only `AuditEvent`/`Notification` history written before the split stays
  resolvable; the extracted one-line `market_quote` documents get fresh ids.
