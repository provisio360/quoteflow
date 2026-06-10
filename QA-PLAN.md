# QuoteFlow v1 — UAT / QA Plan

Manual user-acceptance test plan derived from [`docs/prd/quoteflow-v1.md`](./docs/prd/quoteflow-v1.md).
Each case maps to PRD user story numbers (US#). Run locally against a seeded
database before the Playwright suite (#45) and before deploy.

**Tracking:** progress is checked off on the GitHub UAT tracking issue
(checkboxes there mirror the case IDs below). A failing case becomes a linked bug
issue via GitHub's "convert to issue".

## Preconditions

- Local app running against a Neon dev branch (or local Postgres) with RLS on.
- Seeded demo logins (password `quoteflow-demo-1`):
  - `em@quoteflow.local` — Engagement Manager
  - `analyst@quoteflow.local` — Analyst
  - `researcher1@quoteflow.local`, `researcher2@quoteflow.local` — Researchers
  - `client@globex.com` — Client user (tenant: Globex)
  - Admin via `scripts/seed-admin.ts`
- A sample import spreadsheet available (see `scripts/seed-sample-data.ts` for shape).

**Result legend:** ✅ pass · ❌ fail (file a bug) · ⚠️ pass-with-note · ⬜ not run

---

## A. Setup & Import (EM)

- **A1 — Create study** (US1): As EM, create a Pricing Study scoped to one client. *Expect:* study created, bound to that client only.
- **A2 — Bulk import items** (US2,3): Import a spreadsheet of Benchmark Items. *Expect:* each row carries country, item/part description, client part number, configuration comment, quantity, machine/model, Required Quotes, Client Price.
- **A3 — Re-import upserts** (US4): Re-import with a corrected row (same client part number + country). *Expect:* existing item updated, no duplicate created.
- **A4 — All-or-nothing validation** (US5): Import a file with one bad row. *Expect:* whole file rejected with a per-row error report; nothing partially loaded.
- **A5 — Assign researchers to a Country** (US6): Assign one+ researchers to a Country. *Expect:* assignment saved; additive (re-assign doesn't drop others).

## B. Researcher workflow

- **B1 — See my Countries** (US7): As researcher1, view assigned Countries across studies. *Expect:* only assigned Countries shown.
- **B2 — Self-assign an item** (US8): Self-assign a Benchmark Item in my Country. *Expect:* I become primary researcher on it.
- **B3 — See client guidance** (US9): Open a Benchmark Item. *Expect:* guidance fields visible (description, part no, config, qty, model).
- **B4 — Client Price hidden** (US10,23): Inspect the Benchmark Item thoroughly. *Expect:* **Client Price never shown** anywhere to researcher (ADR-0003).
- **B5 — See peers' quotes** (US11): View an item another researcher quoted. *Expect:* their quotes visible; still no Client Price.
- **B6 — Enter a full Quote** (US12): Create a Quote with all fields (competitor, dealer, location, URL, date, currency, qty, price, stock, lead time, warranty, discounts avail/applied, perspective). *Expect:* saved.
- **B7 — Quote auto-numbering** (US13): Add several quotes, delete one, add another. *Expect:* numbers stable, gaps allowed ("Item 12, Quote 3" stays put).
- **B8 — Save as Draft** (US14): Save a partial Quote as Draft. *Expect:* persists; private to me (ADR-0011).
- **B9 — Auto USD conversion** (US15): Enter price in a non-USD currency with a valid date. *Expect:* system computes USD; I never hand-calc.
- **B10 — Submit gating** (US16): Try to submit a Quote with a required field blank. *Expect:* blocked with a clear message; submit allowed once complete.
- **B11 — Rejection notify + return** (US17,18): (After analyst rejects one) *Expect:* I'm notified with the reason and the Quote returns to me to fix/re-submit.

## C. Analyst workflow

- **C1 — Review queue** (US19): As analyst, open the queue of submitted Quotes. *Expect:* submitted quotes listed as they arrive.
- **C2 — Approve / reject with reason** (US20): Approve one, reject one with a reason. *Expect:* per-quote outcome recorded; reason captured on reject.
- **C3 — QC outlier flag** (US21): Review a Quote whose USD/unit is far from Client Price. *Expect:* flagged above/below expected range.
- **C4 — Maintain Client Price** (US22): Set/edit Client Price on a Benchmark Item. *Expect:* saved; drives QC flag and internal view.
- **C5 — Release eligibility shown** (US24): View a Country. *Expect:* shows eligible only when every item has ≥ Required Quotes approved and nothing in Draft/Submitted.
- **C6 — Manual release** (US25): Release an eligible Country. *Expect:* approved quotes become client-visible.
- **C7 — Release precondition block** (US26): Try to release an incomplete Country. *Expect:* blocked.
- **C8 — Reopen reverts view** (US27): Reopen a released Country. *Expect:* client view reverts until re-released.
- **C9 — Approval blocked while conversion pending** (US28): Approve a Quote whose USD conversion is pending. *Expect:* blocked until conversion resolves.
- **C10 — Manual rate override** (US29): Set a manual exchange rate for an uncovered currency. *Expect:* accepted, recorded as a manual override (audited).

## D. Client experience

- **D1 — See only my studies** (US30,41): As `client@globex.com`, log in. *Expect:* only Globex studies; no other tenant's data anywhere.
- **D2 — Only released + approved** (US31): View results. *Expect:* only released, approved quotes — no Draft/Submitted/Rejected.
- **D3 — Price-range dashboard (A)** (US32): Open dashboard. *Expect:* min/median/max USD per unit per Benchmark Item.
- **D4 — Competitor breakdown (B)** (US33): *Expect:* pricing broken down by competitor.
- **D5 — No internal data** (US34): Inspect everything visible. *Expect:* no review back-and-forth, no rejection reasons, no Client Price.
- **D6 — Export CSV/Excel + PDF** (US35): Export released data and a dashboard. *Expect:* CSV/Excel + PDF produced.
- **D7 — Export excludes Client Price** (US36): Inspect the export. *Expect:* Client Price absent.

## E. Cross-cutting

- **E1 — Internal cross-tenant** (US37): As internal staff, work across multiple clients. *Expect:* not locked to one client.
- **E2 — Invite users** (US38): As admin, invite an internal user (with role) and a client user (bound to one tenant). *Expect:* invite sent; no open self-signup.
- **E3 — Email/password auth** (US39): Sign in/out with email + password. *Expect:* works; invite-only.
- **E4 — Internal full export** (US40): As analyst/EM, export full study data incl. in-progress quotes. *Expect:* produced and audited.
- **E5 — Tenant isolation absolute** (US41): Attempt (e.g. via URL tampering) to read another tenant's study/export as a client. *Expect:* denied (app-layer + RLS #43).
- **E6 — Audit log of transitions** (US42): As internal staff, view the audit log after submit/approve/reject/release/reopen/import/Client-Price change/assignment. *Expect:* append-only entries with actor + timestamp; before/after on Price and Client Price.
- **E7 — Audit log internal-only** (US43): Confirm clients have no path to the audit log. *Expect:* never exposed to clients.
- **E8 — Release notification to client** (US44): Release a Country. *Expect:* the relevant client users are notified (log-only until Resend #42 — confirm the notification is generated).

---

## Bug log

Failed cases become linked issues from the UAT tracking issue. Record here for
quick reference:

| Case | Issue # | Summary |
|------|---------|---------|
|      |         |         |
