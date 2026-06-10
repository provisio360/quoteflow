# QuoteFlow v1 — UAT / QA Plan

Manual user-acceptance test plan derived from [`docs/prd/quoteflow-v1.md`](./docs/prd/quoteflow-v1.md).
Run locally against a seeded database before the Playwright suite (#45) and before deploy.

Each case below carries a `TC` id and the **Tracker** code (`A1`…`E8`) used on the
GitHub UAT tracking issue (#49) — tick the matching checkbox there as you pass each one.
A failing case becomes a linked bug via GitHub's "convert to issue".

## Preconditions

- App + worker running (`npm run dev`, `npm run worker`) against a Neon dev branch (RLS on).
- Import fixtures present in the repo root: `uat-import-sample.xlsx` (valid) and
  `uat-import-invalid.xlsx` (one defect per row). Regenerate with `npx tsx scripts/make-uat-import.ts`.
- Seeded demo logins (password `quoteflow-demo-1`):
  - `em@quoteflow.local` — Engagement Manager
  - `analyst@quoteflow.local` — Analyst
  - `researcher1@quoteflow.local`, `researcher2@quoteflow.local` — Researchers
  - `client@globex.com` — Client user (tenant: Globex)
  - Admin via `scripts/seed-admin.ts`

**Result legend:** ✅ pass · ❌ fail (file a bug) · ⚠️ pass-with-note · ⬜ not run

---

## A. Setup & Import (Engagement Manager)

**ID: TC001**
**Tracker: A1** · US1
**Name:** Create a Pricing Study scoped to one client.
**Instructions:** Sign in as `em@quoteflow.local`. Click **Studies** in the top nav. In the "New study" form enter a Study name (e.g. "UAT Study"), pick a client from the **Client** dropdown, optionally set a QC threshold percent, and submit the form.
**Expected result:** A "Created." confirmation appears with an **Open the study →** link; the study is scoped to the chosen client only.

**ID: TC002**
**Tracker: A2** · US2, US3
**Name:** Bulk-import Benchmark Items from a spreadsheet.
**Instructions:** Open the study, click **Import brief**. Choose the file `uat-import-sample.xlsx` and click **Import brief**.
**Expected result:** Import succeeds; 10 Benchmark Items load across 4 countries (United States, Germany, Japan, United Kingdom), each carrying country, item description, client part number, configuration comment, quantity, machine/model and Required Quotes. No error table is shown.

**ID: TC003**
**Tracker: A3** · US4
**Name:** Re-imported spreadsheet upserts instead of duplicating.
**Instructions:** Edit one row in `uat-import-sample.xlsx` (e.g. change CPN-1001's Client Price to 1900), keep the same Client Part Number + Country, save, and re-import the file into the same study.
**Expected result:** The existing CPN-1001 item is updated (no duplicate row created); item count stays 10.

**ID: TC004**
**Tracker: A4** · US5
**Name:** Invalid file is rejected whole, with a per-row report.
**Instructions:** Open the study's **Import brief** page and import `uat-import-invalid.xlsx`.
**Expected result:** The whole file is rejected; an error table lists Row / Field / Problem for each defect (unknown country, missing part number/description/machine-model, bad Required Quotes, non-positive Client Price/Quantity, duplicate row). No items are loaded.

**ID: TC005**
**Tracker: A5** · US6
**Name:** Assign researchers to a Country (additive).
**Instructions:** On the study page, find the **Researcher assignment** section. For a country (e.g. Germany), tick `researcher1` and click **Assign**. Then assign `researcher2` to the same country.
**Expected result:** Both researchers are listed as assigned to that country; assigning the second does not remove the first.

## B. Researcher workflow

**ID: TC006**
**Tracker: B1** · US7
**Name:** See the Countries I'm assigned to.
**Instructions:** Sign in as `researcher1@quoteflow.local`. Click **Studies** and open the study you were assigned to.
**Expected result:** Only the countries you're assigned to are workable; unassigned countries' items show "not in your assigned countries".

**ID: TC007**
**Tracker: B2** · US8
**Name:** Self-assign a Benchmark Item (become primary researcher).
**Instructions:** In an assigned country, find a claimable Benchmark Item and click **Claim**.
**Expected result:** The item becomes yours (you can now add quotes); other researchers see it as "claimed by another researcher".

**ID: TC008**
**Tracker: B3** · US9
**Name:** See client guidance on a Benchmark Item.
**Instructions:** Open a claimed Benchmark Item.
**Expected result:** Guidance fields are visible — item/part description, client part number, configuration comment, quantity, machine/model.

**ID: TC009**
**Tracker: B4** · US10, US23
**Name:** Client Price is never shown to a researcher.
**Instructions:** As `researcher1`, inspect the Benchmark Item view and any quote forms thoroughly.
**Expected result:** Client Price appears nowhere in the researcher UI (ADR-0003).

**ID: TC010**
**Tracker: B5** · US11
**Name:** See peers' quotes on the same item.
**Instructions:** Open a Benchmark Item that `researcher2` has also quoted.
**Expected result:** The peer's quotes are visible; Client Price is still hidden.

**ID: TC011**
**Tracker: B6** · US12
**Name:** Enter a complete Quote.
**Instructions:** On a claimed item click **+ Add quote**. Fill Competitor brand*, Dealer name*, Dealer location*, Dealer URL, Currency* (e.g. EUR), Stock status, Lead time, Warranty, Discount, Price*, Quantity quoted*, Date quote received*. Click **Add quote**.
**Expected result:** The quote saves and appears under the item as a Draft with a quote number.

**ID: TC012**
**Tracker: B7** · US13
**Name:** Quote auto-numbering is stable with gaps.
**Instructions:** Add three quotes to one item, delete the second (Draft → **Delete**), then add another quote.
**Expected result:** Quote numbers don't renumber — the gap from the deleted quote remains; the new quote takes a fresh higher number.

**ID: TC013**
**Tracker: B8** · US14
**Name:** Save a Quote as a Draft.
**Instructions:** Click **+ Add quote**, fill only some fields, and click **Add quote**.
**Expected result:** The partial quote persists as a Draft, editable later, visible only to you (ADR-0011).

**ID: TC014**
**Tracker: B9** · US15
**Name:** System computes the USD conversion.
**Instructions:** Add a quote with a non-USD Currency (e.g. EUR) and a valid Date quote received, save, then submit it and view it (or check the review queue as analyst).
**Expected result:** A USD price-per-unit is computed by the system using the pinned historical rate; you never hand-enter USD. (Worker must be running.)

**ID: TC015**
**Tracker: B10** · US16
**Name:** Submit is blocked until required fields are filled.
**Instructions:** On a Draft missing a required (*) field, click **Submit**.
**Expected result:** Submission is blocked with a clear message naming the missing field(s). Fill them, click **Submit** again — it succeeds.

**ID: TC016**
**Tracker: B11** · US17, US18
**Name:** Rejection notifies me and returns the Quote.
**Instructions:** After an analyst rejects one of your submitted quotes (TC018), return as `researcher1`, check **Notifications**, then open the item.
**Expected result:** You have a rejection notification with the reason; the rejected quote is back with you showing "Returned: {reason}" and a **Revise** action.

## C. Analyst workflow

**ID: TC017**
**Tracker: C1** · US19
**Name:** Review queue of submitted Quotes.
**Instructions:** Sign in as `analyst@quoteflow.local`. Click **Review** in the nav.
**Expected result:** The Review queue lists submitted quotes (Study / Item, local price, USD/unit, QC status) as they arrive.

**ID: TC018**
**Tracker: C2** · US20
**Name:** Approve or reject each Quote with a reason.
**Instructions:** In the Review queue, click **Approve** on one quote. On another, type a reason in the **Reason (required)** box and click **Reject**.
**Expected result:** The approved quote leaves the queue as Approved; the rejected one records the reason and returns to its primary researcher.

**ID: TC019**
**Tracker: C3** · US21
**Name:** QC outlier flag for prices outside the expected range.
**Instructions:** Ensure a Benchmark Item has a Client Price (TC020). Submit a quote whose USD/unit is far above or below it, then view it in the Review queue.
**Expected result:** The QC column flags it as above/below the expected range (not "in range").

**ID: TC020**
**Tracker: C4** · US22
**Name:** Enter and maintain the Client Price.
**Instructions:** Open the study as analyst. In **Client Price (QC) — analyst only**, type a Client Price (USD/unit) for an item and click **Save**. Clear the box and **Save** to mark another item unpriced.
**Expected result:** The value saves ("Saved"); clearing shows "Cleared"/unpriced. It drives the QC flag and the internal D view.

**ID: TC021**
**Tracker: C5** · US24
**Name:** Country release eligibility is shown.
**Instructions:** As analyst, view the **Release to client** section for a country before and after every item has ≥ its Required Quotes approved with nothing in Draft/Submitted.
**Expected result:** The country shows as releasable only when the precondition is met; otherwise it shows not-releasable.

**ID: TC022**
**Tracker: C6** · US25
**Name:** Manually release a Country.
**Instructions:** For an eligible country, click **Release**.
**Expected result:** State changes to "Released"; the country's approved quotes become visible to the client.

**ID: TC023**
**Tracker: C7** · US26
**Name:** Release is blocked when precondition unmet.
**Instructions:** Attempt to release a country that still has an item below its Required Quotes or a quote in Draft/Submitted.
**Expected result:** The **Release** control is disabled/blocked; the country cannot be released.

**ID: TC024**
**Tracker: C8** · US27
**Name:** Reopen a released Country reverts client view.
**Instructions:** On a Released country click **Reopen**, then check the client dashboard as `client@globex.com`.
**Expected result:** State shows "Reopened"; the client no longer sees that country's results until it's re-released.

**ID: TC025**
**Tracker: C9** · US28
**Name:** Approval blocked while conversion pending.
**Instructions:** Find (or simulate, with the worker stopped) a submitted quote whose USD conversion is still pending; view it in the Review queue and try **Approve**.
**Expected result:** The **Approve** button is disabled with an "awaiting conversion" indicator; approval is impossible until the USD figure resolves.

**ID: TC026**
**Tracker: C10** · US29
**Name:** Manual exchange-rate override for an uncovered currency.
**Instructions:** For a quote in a currency the provider doesn't cover, set a manual exchange rate as analyst and save.
**Expected result:** The override is accepted, the USD figure computes from it, and the action is recorded in the audit log as a manual override.

## D. Client experience

**ID: TC027**
**Tracker: D1** · US30, US41
**Name:** Client sees only their own studies.
**Instructions:** Sign in as `client@globex.com`. Browse Studies.
**Expected result:** Only Globex's studies are visible; no other tenant's data appears anywhere.

**ID: TC028**
**Tracker: D2** · US31
**Name:** Client sees only released, approved Quotes.
**Instructions:** Open a study's dashboard as the client.
**Expected result:** Only released + approved quotes are shown — nothing in Draft, Submitted, or Rejected.

**ID: TC029**
**Tracker: D3** · US32
**Name:** Price-range dashboard (View A).
**Instructions:** On the client dashboard, view the **Competitor price range** section.
**Expected result:** Min / median / max USD per unit is shown per Benchmark Item.

**ID: TC030**
**Tracker: D4** · US33
**Name:** Competitor breakdown (View B).
**Instructions:** On the client dashboard, view the competitor breakdown.
**Expected result:** Pricing is broken down by competitor brand.

**ID: TC031**
**Tracker: D5** · US34
**Name:** Client never sees internal data.
**Instructions:** As the client, inspect every visible page and dashboard.
**Expected result:** No review back-and-forth, no rejection reasons, and no Client Price anywhere.

**ID: TC032**
**Tracker: D6** · US35
**Name:** Export released data and dashboards.
**Instructions:** On the client dashboard, click **⬇ Export released data (Excel)** and export a dashboard PDF.
**Expected result:** A CSV/Excel file of released data and a PDF download successfully.

**ID: TC033**
**Tracker: D7** · US36
**Name:** Client export excludes Client Price.
**Instructions:** Open the exported Excel/CSV from TC032.
**Expected result:** No Client Price column or value is present.

## E. Cross-cutting

**ID: TC034**
**Tracker: E1** · US37
**Name:** Internal staff work across tenants.
**Instructions:** As `analyst@quoteflow.local` (or EM), open studies belonging to different clients.
**Expected result:** You can access multiple clients' studies — not locked to one tenant.

**ID: TC035**
**Tracker: E2** · US38
**Name:** Admin invites internal and client users.
**Instructions:** Sign in as admin, go to **Admin**. Under **Invites**, create an Internal-staff invite (set Invite kind = Internal staff, pick a Staff role) and a Client invite (Invite kind = Client user, pick a Client company). Click **Send invite** each time.
**Expected result:** Each invite is created and an accept link is shown; there is no open self-signup. (Optionally accept one via the link to confirm activation.)

**ID: TC036**
**Tracker: E3** · US39
**Name:** Email/password authentication.
**Instructions:** Sign out, then sign in at `/login` with a seeded email + password (`quoteflow-demo-1`). Then sign out again.
**Expected result:** Sign-in succeeds and redirects into the app; sign-out returns to the login page. Access is invite-only.

**ID: TC037**
**Tracker: E4** · US40
**Name:** Internal full export (audited).
**Instructions:** As analyst/EM, open the study dashboard and click **⬇ Full export (internal)**.
**Expected result:** A full export including in-progress quotes downloads; the export action is recorded in the audit log.

**ID: TC038**
**Tracker: E5** · US41
**Name:** Tenant isolation is absolute.
**Instructions:** As `client@globex.com`, copy a study/dashboard/export URL belonging to a different tenant (get an id as internal staff first) and try to open it directly.
**Expected result:** Access is denied — no other tenant's data is ever returned (app-layer authz + RLS #43).

**ID: TC039**
**Tracker: E6** · US42
**Name:** Audit log of key transitions.
**Instructions:** As internal staff, after performing submit / approve / reject / release / reopen / import / Client-Price change / assignment, open the audit log.
**Expected result:** Append-only entries show actor + timestamp for each transition, with before/after values on Price and Client Price.

**ID: TC040**
**Tracker: E7** · US43
**Name:** Audit log is internal-only.
**Instructions:** As `client@globex.com`, look for any path to the audit log.
**Expected result:** The audit log is never exposed to client users.

**ID: TC041**
**Tracker: E8** · US44
**Name:** Client is notified when a Country is released.
**Instructions:** Release a country (TC022), then sign in as `client@globex.com` and open **Notifications** (and/or check the worker log for the dispatched notification).
**Expected result:** The client has a "Results released: {country}" notification. (Email is log-only until Resend #42 — confirm the notification is generated.)

---

## Bug log

Failed cases become linked issues from the UAT tracking issue (#49). Record here for
quick reference:

| TC | Tracker | Issue # | Summary |
|----|---------|---------|---------|
|    |         |         |         |
