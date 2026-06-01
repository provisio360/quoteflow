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
The expected price-per-unit benchmark for a Benchmark Item, entered by the analyst. Used purely as an internal QC reference: the system flags competitor quotes whose USD price-per-unit falls above or below the expected range around it. Hidden from researchers (to avoid biasing the quotes they collect) and never shown to clients or included in client exports. Powers the internal analyst QC view, not any client-facing dashboard.

**Quote**:
One competitive data point collected from a single distributor/dealer against a Benchmark Item — competitor brand, dealer, location, price (with currency conversion), stock status, lead time, warranty, discounts, and notes. Many Quotes per Benchmark Item, distinguished by quote number. A Quote's **Price** is always the dealer's final quoted price in the local currency — discount-inclusive when the dealer states a discount was applied (not all quotes have one).
_Avoid_: Row, price entry, bid

**Client**:
An end-client company that commissions pricing studies. The client is the **tenant**: its studies, benchmark items, and quotes are isolated from every other client. Client users are the only external users and see only their own data.
_Avoid_: Customer, account, organization

**Engagement Manager**:
Internal staff member who runs a study and assigns researchers to Countries (a Country may have several). Sets the pool who may work each Country.
_Avoid_: Project manager, study owner

**Researcher**:
Internal staff member who collects quotes by contacting distributors/dealers. Works within Countries the Engagement Manager assigned them to, and self-assigns individual Benchmark Items. The lead on a given Benchmark Item is its _primary researcher_; others may still contribute quotes to the same item.
_Avoid_: Agent, collector

**Analyst**:
Internal staff member who performs quality checks on quotes and approves them before clients see them.
_Avoid_: Reviewer, QA

**Quote Number**:
A per-Benchmark-Item reference label for a Quote, auto-assigned in sequence. Stable and never reused — an abandoned or rejected quote leaves a permanent gap rather than renumbering, so "Item 12, Quote 3" always means the same quote. It is a display label, not the quote's internal identity.

**Country**:
The geographic focus of a Benchmark Item's pricing and the unit of client release.
_Avoid_: Market, segment, region, territory

**Required Quotes**:
The per-Benchmark-Item count of approved quotes needed before its Country can be released. Set by the client up front and carried as a column in the bulk upload; varies per item, so sparse-source parts simply specify a lower number (no analyst override exists).

**Released**:
The state of a Country whose approved quotes have been made visible to the client, as a set. The analyst manually releases a Country, gated by a system-enforced precondition: every Benchmark Item in it has at least its Required Quotes approved, and no quote is still in Draft or Submitted. A released Country can be reopened (pulling it back from client view) and re-released; the client's view always reflects only currently-released data. Per-quote approval alone never exposes a quote.

**Quantity Quoted**:
The quantity in which the distributor/dealer actually sells the item, recorded on a Quote. Drives USD Price per Unit. Distinct from the client's own quantity carried on the Benchmark Item.
_Avoid_: Competitor quantity

**Exchange Rate**:
The local-currency-to-USD rate applied to a Quote's price. Auto-fetched as the historical rate for the Quote's Date Quote Received and pinned to the Quote, so conversions never shift. On a market-closed date the nearest prior business day's rate is used, and the date actually used is stored. Not entered by researchers; an analyst may set it manually (audited) for currencies the provider doesn't cover.

**Converted USD Price / USD Price per Unit**:
System-computed values on a Quote: the local price converted to USD, and that figure divided by quantity quoted. Always derived, never hand-entered. USD is currently the fixed conversion target.

**Submitted**:
A Quote a researcher has marked done and sent to the analyst's review queue. Internal-only — "submitted" never means client-visible.

**Approved / Rejected**:
An analyst's per-quote verdict. Approved quotes await Country release; rejected quotes return to the same researcher with a reason. The review back-and-forth is never visible to the client.

**Competitor**:
The rival company and brand whose equivalent part is being priced against the client's Benchmark Item.

**Distributor/Dealer**:
The source a researcher contacts for a Quote — the company that sells the competitor's part and would ship it to the customer. Carries a name, physical location, and URL.
_Avoid_: Vendor, supplier, source
