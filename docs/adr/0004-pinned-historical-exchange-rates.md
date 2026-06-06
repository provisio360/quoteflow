# Pinned historical exchange rates via a swappable provider

Quote prices are recorded in the dealer's local currency and converted to USD. We fetch the **historical** exchange rate for the Quote's **Date Quote Received** and **pin** it to the Quote, so a quote's USD conversion never shifts after the fact. On a market-closed date (weekend/holiday) we use the nearest prior business day's rate and store which date was used.

We use **exchangerate-api.com's paid plan** for its historical (`/history`) endpoint, accessed behind a `RateProvider` interface so the vendor can be swapped without touching domain code. We rejected the free tier because it returns only the latest rate, which cannot honor "rate as of Date Quote Received" for back-dated entries or bulk re-imports.

Two operational consequences: the API key is stored as a sandbox secret (never in code), and `exchangerate-api.com` must be allow-listed in the network policy.

Conversion is **not** fetched at submit time — submit only marks the conversion **pending**, and a background worker fills the rate later (refined in **ADR-0013**; the "unreachable at submit → pending" framing originally here is superseded by deferred-by-default). An analyst **cannot approve** the quote until the conversion resolves. For currencies the provider does not cover, an analyst may set the rate **manually** (recorded as a manual override in the audit log). USD figures are always recomputed from whatever rate is in effect and are never hand-entered.
