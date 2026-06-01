# PRD: QuoteFlow v1

> Status: ready-for-agent
> Domain glossary: [`CONTEXT.md`](../../CONTEXT.md) · Decisions: [`docs/adr/`](../adr/)

## Problem Statement

Pricing studies today run on Excel spreadsheets emailed back and forth. Researchers collect competitive part prices from distributors and dealers into wide, flat rows; analysts review them by reading the same spreadsheets and replying with comments; clients receive results as more spreadsheets, often late and after the whole study is done. This is slow, error-prone, gives no real-time visibility, mixes client-confidential guidance with collected data, and offers no audit trail or controlled release of results.

From the user's perspective:

- **Researchers** re-type the client's guidance on every row, have no structured place to record competitor quotes, and get feedback only via email.
- **Analysts** cannot quality-check quotes as they arrive, cannot easily spot prices that fall outside an expected range, and have no controlled way to release results.
- **Clients** wait for the entire study, receive raw spreadsheets rather than insight, and see internal back-and-forth they shouldn't.
- **Engagement Managers** have no clean way to assign work by country or track progress.

## Solution

QuoteFlow is a multi-tenant web application that replaces the Excel-and-email loop with one platform structured around the domain: a **Pricing Study** contains **Benchmark Items** (the client's parts to price), and each Benchmark Item collects many **Quotes** (one competitive data point per distributor/dealer).

- **Researchers** work assigned **Countries**, self-assign Benchmark Items, and enter Quotes in a structured form. The client guidance is entered once on the Benchmark Item, not re-typed per quote.
- **Analysts** review submitted Quotes in a queue, approve or reject each with a reason, see system flags for prices outside the expected range, and **release** a Country's approved Quotes to the client once it is complete.
- **Clients** (the tenant) log in to see only their own released results: dashboards showing the competitor price range per Benchmark Item and a breakdown by competitor, plus exports — never internal review history.
- **Engagement Managers** set up studies via spreadsheet bulk import and assign researchers to Countries.

Currency is normalized to USD automatically using a pinned historical exchange rate, so every quote is comparable and never shifts after the fact.

See ADRs for the load-bearing decisions: tenant = client company (0001), two-gate quote release (0002), Client Price is an internal QC benchmark hidden from researchers and clients (0003), pinned historical exchange rates (0004).

## User Stories

### Setup & import
1. As an Engagement Manager, I want to create a Pricing Study scoped to one client, so that all of that client's work is isolated in one place.
2. As an Engagement Manager, I want to bulk-import Benchmark Items from a spreadsheet, so that I don't hand-key the client's brief.
3. As an Engagement Manager, I want each import row to carry the client guidance (country, item/part description, client part number, configuration comment, quantity, machine/model) plus a per-item Required Quotes count and the Client Price, so that the study is fully specified up front.
4. As an Engagement Manager, I want a re-imported spreadsheet to upsert on (client part number + country), so that corrections update existing Benchmark Items instead of creating duplicates.
5. As an Engagement Manager, I want the import to validate the whole file and reject it on any error with a per-row report, so that I never end up with a half-loaded study.
6. As an Engagement Manager, I want to assign one or more researchers to each Country in a study, so that the right people can work it.

### Researcher workflow
7. As a researcher, I want to see the Countries I'm assigned to across studies, so that I know what to work on.
8. As a researcher, I want to self-assign individual Benchmark Items within my Countries, so that I can take ownership as the primary researcher.
9. As a researcher, I want to see the client guidance on a Benchmark Item, so that I can describe the part accurately to a distributor/dealer.
10. As a researcher, I want to never see the Client Price, so that my quotes are not anchored or biased.
11. As a researcher, I want to see other researchers' quotes on the same Benchmark Item, so that I can coordinate and avoid duplicating sources.
12. As a researcher, I want to enter a Quote with competitor brand, distributor/dealer name, location, URL, date quote received, currency, quantity quoted, price, stock status, lead time, warranty, discounts available, discounts applied, and dealer perspective, so that the competitive data point is complete.
13. As a researcher, I want each Quote auto-numbered within its Benchmark Item with stable numbers (gaps allowed), so that "Item 12, Quote 3" always refers to the same quote.
14. As a researcher, I want to save a Quote as a Draft, so that I can record partial work mid-call.
15. As a researcher, I want the system to compute the USD conversion for me, so that I never hand-calculate exchange math.
16. As a researcher, I want to submit a Quote only when its required fields are filled, so that I don't send incomplete data to the analyst.
17. As a researcher, I want to be notified when a Quote of mine is rejected, with the reason, so that I can fix and re-submit it.
18. As a researcher, I want a rejected Quote to come back to me, so that ownership of the fix is clear.

### Analyst workflow
19. As an analyst, I want a queue of submitted Quotes, so that I can review them as they arrive rather than waiting for the whole study.
20. As an analyst, I want to approve or reject each Quote individually with a reason, so that quality control is per-quote.
21. As an analyst, I want the system to flag Quotes whose USD price-per-unit falls above or below the expected range around the Client Price, so that I can spot suspect prices quickly.
22. As an analyst, I want to enter and maintain the Client Price for a Benchmark Item, so that the QC flagging has a benchmark.
23. As an analyst, I want the Client Price hidden from researchers and clients, so that it stays an internal QC tool only.
24. As an analyst, I want to see when a Country is eligible for release (every Benchmark Item has at least its Required Quotes approved and nothing is in Draft/Submitted), so that I know when I can release it.
25. As an analyst, I want to manually release a Country, so that I control the moment its approved Quotes become visible to the client.
26. As an analyst, I want to be blocked from releasing a Country that doesn't meet the precondition, so that clients never see incomplete results.
27. As an analyst, I want to reopen a released Country, so that I can correct or add data, with the client's view reverting until I re-release.
28. As an analyst, I want a Quote I would approve to be blocked from approval until its currency conversion resolves, so that no approved Quote lacks a real USD figure.
29. As an analyst, I want to set a Quote's exchange rate manually for currencies the provider doesn't cover, recorded as a manual override, so that exotic-currency quotes can still be processed.

### Client experience
30. As a client user, I want to log in and see only my own studies, so that my data is isolated from other clients.
31. As a client user, I want to see only released, approved Quotes, so that I get complete, vetted results rather than work in progress.
32. As a client user, I want a dashboard showing the competitor price range (min/median/max USD per unit) per Benchmark Item, so that I understand the spread of competitive pricing.
33. As a client user, I want a breakdown of pricing by competitor, so that I can compare rival brands.
34. As a client user, I want to never see internal review back-and-forth, rejection reasons, or the Client Price, so that I only see the finished picture.
35. As a client user, I want to export my released data as CSV/Excel and dashboards as PDF, so that I can share results internally.
36. As a client user, I want my export to exclude the Client Price, so that internal QC benchmarks never leak.

### Cross-cutting
37. As an internal staff member, I want to work across all client tenants, so that I'm not locked to a single client.
38. As an admin, I want to invite users (internal staff with a role, or client users bound to one tenant), so that there's no open self-signup.
39. As a user, I want to authenticate with email/password, so that I can access the app in v1.
40. As an analyst/EM, I want to export full study data including in-progress Quotes, audited, so that I can analyze or hand off data out-of-band.
41. As any actor, I want all exports and views to respect tenant isolation absolutely, so that no client ever sees another's data.
42. As an internal staff member, I want an append-only audit log of key transitions (submit, approve, reject, release, reopen, import/upsert, Client Price set/change, assignment), with before/after values on Price and Client Price, so that sensitive changes are traceable.
43. As an internal staff member, I want the audit log to be internal-only, so that clients never see it.
44. As a client user, I want to be notified when a Country I care about is released, so that I know when new results are available.

## Implementation Decisions

### Architecture & module shape

The build is organized around deep modules whose pure decision-logic cores are testable in isolation, with I/O pushed to thin adapters. **Tech stack (language, web framework, database, FX HTTP client) is an open decision** — see Out of Scope; module interfaces below are described stack-agnostically.

**Deep modules:**

1. **RateProvider + Currency Conversion** — `rateFor(currency, date) -> { rate, rateDateUsed }`, returning the historical rate for the date or the nearest prior business day (recording which date was used). Pure conversion functions derive `convertedUsdPrice` and `usdPricePerUnit`. The FX HTTP client (exchangerate-api.com paid `/history`) is a swappable adapter behind the interface (ADR-0004). Handles unreachable-provider (pending) and manual-override states.
2. **Quote Lifecycle** — pure state machine over Draft → Submitted → Approved/Rejected, with submit-time required-field validation and rejection reasons. Approval is blocked while a Quote's conversion is pending.
3. **Country Release Gate** — pure evaluator: given a Country's Benchmark Items, their approved-Quote counts vs. per-item Required Quotes, and whether any Quote is in Draft/Submitted, returns whether the Country is releasable. Owns release/reopen transitions (ADR-0002).
4. **Bulk Import** — pure validator (all-or-nothing, per-row error report) + upsert resolver keyed on (client part number + country). Spreadsheet parsing is a thin adapter feeding the validator.
5. **QC Outlier Flagging** — pure function: a Quote's USD price-per-unit and the Benchmark Item's Client Price expected range -> above / within / below.
6. **Authorization & Visibility** — cross-cutting policy: tenant isolation, role rules (Engagement Manager, Researcher, Analyst, Client), field-level Client-Price hiding, and release-gated client visibility. Expressed as predicates/filters callable by every read path.
7. **Audit Log** — append-only event recorder; captures actor + timestamp for key transitions and before/after for Price and Client Price.
8. **Analytics read model** — aggregations for client dashboards A (price range per Benchmark Item) and B (competitor breakdown) over released + approved Quotes, plus the internal-only D (vs. Client Price benchmark) view.

**Shallow / adapter modules:** Identity & Auth (invite-only, email/password, role + tenant binding; structured so SSO can be added later), Notifications (push email + in-app on Quote rejected → primary researcher and Country released → client users; everything else pull), and persistence for Study / Benchmark Item / Quote.

### Domain model

- **Pricing Study** (belongs to one Client/tenant) → **Benchmark Item** (identity = client part number + country within the study) → **Quote** (per-item auto-numbered, stable with gaps).
- Benchmark Item fields: country, item/part description, client part number, configuration comment, quantity, machine/model, **Required Quotes** (per-item), **Client Price** (analyst-only).
- Quote required-to-submit fields: Competitor, Distributor/Dealer name, Distributor/Dealer location, Date Quote Received, Currency Type Quoted, Quantity Quoted, Price, In/Out-of-stock, Lead Time, Dealer URL, Warranty, Discounts Available, Discounts Applied, Dealer Perspective. Optional: Competitor Model, Competitor Part Number, Other Notes. System-derived (never entered): Exchange Rate, Converted USD Price, USD Price/Unit.
- **Price** is always the dealer's final quoted price in local currency — discount-inclusive when the dealer states a discount was applied (not all quotes have one).
- **Quantity Quoted** is the dealer's selling quantity (replaces the former "Competitor Quantity"); distinct from the client's own quantity on the Benchmark Item.

### Visibility & release rules

- Two gates to client visibility (ADR-0002): per-Quote analyst **approval**, then per-**Country release**. Clients see only released + approved Quotes. Release is manual, precondition-guarded, and reversible (reopen).
- **Client Price** is an internal QC benchmark (ADR-0003): hidden from researchers (bias) and never shown to clients or in client exports. Drives the QC outlier flag and the internal D view only.
- Researchers can see peers' Quotes on the same Benchmark Item, but never the Client Price.
- Tenant = client company (ADR-0001); internal staff (EM/Researcher/Analyst) work across tenants; clients are viewer-only and tenant-bound.

### Currency

- Historical rate auto-fetched for Date Quote Received and pinned to the Quote; nearest-prior-business-day fallback with the used date stored (ADR-0004).
- USD figures always computed, never hand-entered. USD is the fixed conversion target for v1.
- Provider unreachable at submit → submit anyway, conversion pending, approval blocked until resolved. Analyst manual rate override for uncovered currencies, recorded in the audit log.
- exchangerate-api.com API key stored as a sandbox/deployment secret; the domain must be network-allow-listed.

### Auth & accounts

- Invite-only; no self-signup. Internal users invited with a role; client users bound to exactly one tenant at invite. Multiple viewer-only client users per tenant; no intra-client roles in v1. Email/password with verification; identity structured so SSO can be added without rework.

## Testing Decisions

Good tests assert external behavior through a module's public interface, not its internals — they survive refactors and document the contract. The pure decision cores are the priority because they encode the rules most expensive to get wrong, and they need no database or network to exercise.

Unit-tested modules (v1):

1. **Currency Conversion / RateProvider** — conversion math; nearest-prior-business-day selection; rate pinning (a historical quote's USD never changes when "today's" rate moves); pending-on-outage and manual-override paths. FX HTTP client mocked at the adapter boundary.
2. **Quote Lifecycle** — every valid/invalid transition; submit-time required-field validation; approval blocked while conversion pending; rejection carries a reason and returns to the primary researcher.
3. **Country Release Gate** — releasable vs. not across combinations of Required-Quotes-met, approved counts, and in-flight Draft/Submitted Quotes; reopen reverts client visibility.
4. **Bulk Import** — all-or-nothing rejection with per-row errors; upsert vs. insert decisions keyed on (client part number + country); malformed rows reported, not partially applied.
5. **QC Outlier Flagging** — above / within / below classification at and around range boundaries.
6. **Authorization & Visibility** — tenant isolation (no cross-tenant read), Client Price hidden from researchers and clients, client sees only released+approved Quotes, internal staff cross-tenant access.

Adapters (FX HTTP client, spreadsheet parser, persistence, email, web layer) are covered by thinner integration tests rather than unit tests. No prior art exists yet (greenfield); these tests establish the conventions.

## Out of Scope

- **Tech stack selection** (language, web framework, database, ORM, FX HTTP client library) — to be decided before implementation; this PRD is deliberately stack-agnostic.
- **Client self-service entry** of Benchmark Items — v1 is internal-only via bulk import; client self-service is a later phase.
- **SSO** — email/password only in v1; identity is structured so SSO can be added later.
- **Conversion targets other than USD** — fixed to USD in v1; a per-study target currency is a later enhancement.
- **Geographic comparison dashboard (view C)** — follow-on after A, B, and the internal D.
- **Intra-client roles** (client admin vs. viewer) — all client users are viewers in v1.
- **Notification preferences** (digests, muting) — fixed push-on-rejection and push-on-release in v1.
- **Full field-level change history** — v1 audits key transitions with before/after on Price and Client Price only.
- **Study/Quote terminal states, archival/deletion, and data retention policy** — not yet specified (open thread).
- **Exact thresholds for the QC "expected range"** around Client Price (e.g. ± percentage vs. analyst-set band) — not yet specified (open thread).
- **Pre-existing competitor quotes in imports** — quotes are always collected in-app in v1.

## Further Notes

- Open threads to resolve before or during build: (1) how the QC "expected range" around Client Price is defined; (2) Study/Quote terminal states, archival, and retention; (3) exact dashboard filters/cuts for A and B.
- This PRD was produced from a `grill-with-docs` session; the domain glossary (`CONTEXT.md`) and ADRs 0001–0004 are the source of truth for terminology and decisions and should be kept in sync as the build proceeds.
- This PRD is tracked as GitHub issue [#1](https://github.com/provisio360/quoteflow/issues/1) on `provisio360/quoteflow`, labeled `ready-for-agent`. This file is the canonical source; the issue carries the same content for agent pickup.
