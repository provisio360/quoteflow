# QuoteFlow

A multi-tenant platform for running pricing studies: researchers enter price quotes, analysts review and approve them, and clients view results. It replaces the Excel-and-email back-and-forth of traditional pricing research.

## Language

**Pricing Study**:
A top-level project container owned by one tenant and scoped to one end-client. It holds the set of items to be priced, the people working on it, and the price quotes collected against those items.
_Avoid_: Project, survey, campaign

**Benchmark Item**:
The client's part to be price-benchmarked, defined once and carrying the client's guidance: country, item/part description, client part number, configuration comment, quantity, machine/model, and a **Required Quotes** count. A Benchmark Item has many Quotes. Uniquely identified within a study by **client part number + country** (the key a spreadsheet re-import upserts on).
_Avoid_: Target part, subject part, line item, SKU

**Client Price**:
The expected USD price-per-unit benchmark for a Benchmark Item. Initially **seeded from the client brief** at study setup, but **owned and maintained by the analyst** thereafter — the brief is *not* its source of truth, so a re-import never overwrites it (the analyst corrects it in-app, ADR-0015). Used purely as an internal QC reference: a [[Quote]] whose USD price-per-unit differs from it by more than the study's [[QC Threshold]] is **flagged** (see [[Price Flag]]). **May be unset** — an item the client never priced has no Client Price and is *not comparable*, raising no flag (parallel to an unconverted [[Quote]]). Hidden from researchers (to avoid biasing the quotes they collect) and never shown to clients or included in client exports. Powers the internal analyst QC view, not any client-facing dashboard.

**QC Threshold**:
The per-[[Pricing Study]] percentage that defines how far a [[Quote]]'s USD price-per-unit may diverge from a Benchmark Item's [[Client Price]] before the quote is flagged for analyst attention. Defined by the [[Engagement Manager]] or [[Analyst]] as part of study setup (a required study attribute — a study without one is mis-configured). One threshold governs every item in the study; the difference measure itself is relative, so a single percentage works across cheap and expensive parts.
_Avoid_: tolerance, variance limit

**Price Flag**:
The QC signal raised on a [[Quote]] whose USD price-per-unit diverges from its Benchmark Item's [[Client Price]] by more than the study's [[QC Threshold]]. Only computable once the quote is converted **and** its Benchmark Item has a [[Client Price]] (lacking either, the quote is *not comparable*, never flagged). The flag is **advisory, not a hard block** — but approving a flagged quote requires the author's [[Justification]] first. The analyst sees the flag and its direction (higher/lower than expected); the researcher never does (the [[Client Price]] is hidden from them, ADR-0003).
_Avoid_: alert, warning, exception

**Justification**:
The author-supplied explanation that a flagged [[Quote]]'s price is genuinely correct despite diverging from the [[Client Price]]. Required before a flagged quote can be approved, and gathered only by returning the quote to its author (who is told the direction of the divergence, never the benchmark value). Distinct from the quote's free-text **notes**: a justification specifically answers a [[Price Flag]]. Persists on the quote across resubmission (unlike a rejection reason, which is cleared on resubmit).
_Avoid_: explanation, comment, reason

**Quote**:
One competitive data point collected from a single distributor/dealer against a Benchmark Item — competitor brand, dealer, location, price (with currency conversion), stock status, lead time, warranty, discounts, and notes. Many Quotes per Benchmark Item, distinguished by quote number. A Quote's **Price** is always the dealer's final quoted price in the local currency — discount-inclusive when the dealer states a discount was applied (not all quotes have one).
_Avoid_: Row, price entry, bid

**Client**:
An end-client company that commissions pricing studies. The client is the **tenant**: its studies, benchmark items, and quotes are isolated from every other client. A Client is a company, not a person — it never logs in. The humans who log in on its behalf are **Client Users**.
_Avoid_: Customer, account, organization

**Client User**:
A person who logs in on behalf of exactly one Client (tenant). The only external (non-staff) user. Viewer-only and tenant-bound: sees only that Client's released data, never another tenant's, and has no intra-client roles in v1 (every Client User of a tenant has the same view). Many Client Users may belong to one Client. Distinct from the **Client** itself, which is the company/tenant and never logs in.
_Avoid_: Client (when you mean the person), customer contact, account user

**Engagement Manager**:
Internal staff member who runs a study and assigns researchers to Countries (a Country may have several). Sets the pool who may work each Country.
_Avoid_: Project manager, study owner

**Researcher**:
Internal staff member who collects quotes by contacting distributors/dealers. Works within Countries the Engagement Manager assigned them to, and self-assigns individual Benchmark Items. The lead on a given Benchmark Item is its _primary researcher_; others may still contribute quotes to the same item.
_Avoid_: Agent, collector

**Analyst**:
Internal staff member who performs quality checks on quotes and approves them before clients see them. Can also create a [[Pricing Study]]: study **creation** is a shared internal-setup capability held by Engagement Managers and Analysts (not the Admin, who remains user-administration only), distinct from **running** a study, which stays the Engagement Manager's job.
_Avoid_: Reviewer, QA

**Admin**:
Internal staff member responsible for user administration: invites users, assigns internal roles, and binds client users to their tenant. The root of the invite tree — the only role that can mint other internal staff (including other Admins) and client users. Like all internal staff, an Admin is **not tenant-scoped**. User-administration authority only; being an Admin does not by itself grant Engagement Manager, Researcher, or Analyst capabilities (those are separate role assignments).
_Avoid_: Superuser, owner, operator

**Invite**:
An Admin's single-use, expiring offer to create one account for a specific email, carrying the bindings chosen up front — either an internal **role** or a **Client** (tenant). There is no other way to obtain an account (no self-signup). Accepting an Invite (setting a password via the emailed link) both creates the account and serves as **email verification** — possession of the link proves inbox control, so no separate verification step exists. A pending Invite is not yet a [[Client User]] or staff account: it cannot authenticate until accepted. Invites can be revoked or resent by an Admin and expire after a configurable window.
_Avoid_: Signup, registration, activation link

**Quote Number**:
A per-Benchmark-Item reference label for a Quote, auto-assigned in sequence. Stable and never reused, so "Item 12, Quote 3" always means the same quote. A number is retained by its quote for life — a [[Rejected]] quote keeps its number through revision and resubmission rather than being renumbered. Only an **abandoned** (hard-deleted) [[Draft]] leaves a permanent gap. It is a display label, not the quote's internal identity.

**Country**:
The geographic focus of a Benchmark Item's pricing and the unit of client release.
_Avoid_: Market, segment, region, territory

**Country Assignment**:
The Engagement Manager's act of putting a [[Researcher]] onto a Country within a study — the pool allowed to work that Country. A Country may have several assigned researchers, and a researcher may be assigned across many studies. A Country is only assignable once it has Benchmark Items (the brief defines a study's countries), and assignment is **additive**: it only ever adds researchers, never removes them. Distinct from a researcher then self-assigning an individual [[Benchmark Item]] within a Country (becoming its [[Primary Researcher]]), which is a separate, later act.
_Avoid_: Allocation, posting

**Primary Researcher**:
The single lead [[Researcher]] on a [[Benchmark Item]], established when a researcher **self-assigns** that item. Self-assignment is only permitted within a Country the researcher already has a [[Country Assignment]] to, and is **first-come**: an item has at most one primary researcher and the lead cannot be taken over once claimed (re-assignment/handoff is out of scope here). Being primary is a *lead* designation, not a lock on the item — other researchers may still contribute [[Quote]]s to the same item without becoming primary. An item may have no primary researcher (unclaimed).
_Avoid_: Owner, assignee, item owner

**Required Quotes**:
The per-Benchmark-Item count of approved quotes needed before its Country can be released. Set by the client up front and carried as a column in the bulk upload; varies per item, so sparse-source parts simply specify a lower number (no analyst override exists). May be **zero** — an item that needs no quotes, whose Country can release without any approved quote for it.

**Released**:
The state of a Country whose approved quotes have been made visible to the client, as a set. Release is scoped to a **(study, country)** pair, not a bare country name — the same country recurs across studies and each is released independently (ADR-0016). The analyst manually releases a Country, gated by a system-enforced precondition (its [[Release Eligibility]]): every Benchmark Item in it has at least its Required Quotes approved, and no quote is still **in-flight** (a [[Draft]] or [[Submitted]] quote — a [[Rejected]] one does *not* block). A released Country can be reopened (pulling it back from client view) and re-released; the client's view always reflects only currently-released data. Reopen is a **visibility lever only** — it never changes any quote's state, so re-release needs no re-approval. Per-quote approval alone never exposes a quote.

**Release Eligibility**:
The precondition that decides whether a Country *may* be released: every Benchmark Item has at least its [[Required Quotes]] approved **and** no item has an in-flight ([[Draft]]/[[Submitted]]) quote. A pure, derived judgement — never a stored flag — evaluated fresh from the Country's items at the moment of release (and re-checked inside the release itself, so a race can't release a no-longer-eligible Country). A Country with no Benchmark Items is *not* eligible (releasing nothing is meaningless). Distinct from [[Released]], which is the resulting persisted state; eligibility is the gate, Released is the outcome.
_Avoid_: releasable flag, completion status

**Quantity Quoted**:
The quantity in which the distributor/dealer actually sells the item, recorded on a Quote. Drives USD Price per Unit. Distinct from the client's own quantity carried on the Benchmark Item.
_Avoid_: Competitor quantity

**Exchange Rate**:
The local-currency-to-USD rate applied to a Quote's price. Auto-fetched as the historical rate for the Quote's Date Quote Received and pinned to the Quote, so conversions never shift. The fetch is **deferred to a background worker** (see [[Conversion Status]]), which only attempts a Quote once its Date Quote Received has fully closed in **UTC** (`dateQuoteReceived < current UTC date`) — before then the historical rate for that date is not yet published, and attempting it would wrongly pin the prior day's rate. On a market-closed date (weekend/holiday) the nearest prior business day's rate is used, and the date actually used is stored. Not entered by researchers; an analyst may set it manually (audited) for currencies the provider doesn't cover.

**Converted USD Price / USD Price per Unit**:
System-computed values on a Quote: the local price converted to USD, and that figure divided by quantity quoted. Always derived, never hand-entered. USD is currently the fixed conversion target.

**Conversion Status**:
Where a Quote stands in pinning its [[Exchange Rate]]. A Quote is *unconverted* (null) only while it is a [[Draft]]; conversion is never attempted on a Draft. The moment a Quote is [[Submitted]] it becomes **pending** — conversion is **deferred by default** to a background worker, not fetched at submit (the historical rate for the quote's date may not even be published until that date has closed). So `pending` means "no USD figures yet, awaiting the worker," covering both the not-yet-attempted case and the attempted-but-unresolved cases (provider unreachable, no rate within the look-back window, or a currency the provider doesn't cover awaiting a manual rate). While pending, the analyst's approval is blocked. The worker resolves pending to **auto** (a provider rate was found and pinned) or it stays pending until a later run succeeds or an analyst supplies a **manual** rate (a currency the provider doesn't cover). `auto` and `manual` both carry pinned USD figures; the distinction is provenance, and a `manual` rate is sticky — the background worker never overwrites it. Invariant: **null ⇔ Draft; once Submitted, always pending → auto/manual**. The [[Quote Lifecycle]]'s revise loop preserves this: sending a Rejected quote back to Draft returns its status to null, and a later resubmit makes it pending again (re-converted from scratch, since its date may have changed).
_Avoid_: converted/not-converted (loses the pending and provenance distinctions); "fetched at submit" (conversion is deferred to the worker)

**Draft**:
The state a Quote starts in: a researcher's in-progress working copy, saveable with partial data so collection can be interrupted and resumed. No field is required to hold a Draft; required-field validation applies only on the move to [[Submitted]]. A Draft is internal and pre-review — never in the analyst's queue and never client-visible. Abandoning a Draft is what leaves a permanent gap in the item's [[Quote Number]] sequence.
_Avoid_: Incomplete, pending, unsaved

**Quote Lifecycle**:
The states a [[Quote]] moves through — **Draft → Submitted → Approved / Rejected**, with a **Rejected → Draft** revise loop — modeled as a single state machine. The researcher's move (Draft → Submitted) is v1's first quote slice; the analyst verdicts and the revise loop are the same machine's later transitions:
- **approve** (Submitted → Approved): blocked while the Quote's [[Conversion Status]] is pending (no Quote is approved without a real USD figure), and — if the Quote is flagged (see [[Price Flag]]) — blocked until its author has supplied a [[Justification]].
- **reject** (Submitted → Rejected): requires a reason. The same edge also carries the analyst's act of returning a flagged Quote to its author **for justification** — the reason states only the direction ("higher/lower than expected"), never the [[Client Price]] value (ADR-0003).
- **revise** (Rejected → Draft): the **only** way out of Rejected, performed by the quote's author. The revised quote is a Draft again — therefore unconverted — and re-enters the normal Draft → Submitted path keeping its [[Quote Number]].

Every legal move is defined in one place; an undefined move (e.g. editing an Approved quote, or approving a Draft) is rejected, not silently allowed.

**Submitted**:
A Quote a researcher has marked done and sent to the analyst's review queue. Internal-only — "submitted" never means client-visible. The transition out of [[Draft]] is gated: a Quote can only become Submitted once all required-to-submit fields are present.

**Approved / Rejected**:
An [[Analyst]]'s per-quote verdict. Approved quotes await Country release. A rejected quote returns to its **author** — the [[Researcher]] who created it (`createdById`), not necessarily the item's [[Primary Researcher]] — carrying the rejection reason. The author may then **revise** it (back to [[Draft]], same [[Quote Number]]) and resubmit; only the latest rejection reason is retained. The review back-and-forth is never visible to the client.

**Competitor**:
The rival company and brand whose equivalent part is being priced against the client's Benchmark Item.

**Distributor/Dealer**:
The source a researcher contacts for a Quote — the company that sells the competitor's part and would ship it to the customer. Carries a name, physical location, and URL.
_Avoid_: Vendor, supplier, source
