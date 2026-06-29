# Researcher entry is dealer-first, organised by Quote Group; claiming is implicit

A [[Researcher]] in real life works **one dealer at a time**: a single
[[Distributor/Dealer]] prices many of a [[Country]]'s parts in one conversation,
so the natural unit of entry is "this dealer, these parts," not "this part, find
dealers for it." The v1 surface inverted that — a per-part grid (`ResearcherItem`)
where the researcher first self-assigned (claimed) each [[Benchmark Item]], then
hunted dealers for it. We replace the entry surface with a **Country → [[Quote
Group]] → dealer + batch → per-part** flow, and as a direct consequence retire the
manual claim step.

## Decisions

- **Quote Group is a non-persisted ordinal lens, not an entity.** A "Quote Group N"
  is the *Nth dealer-document slot* toward each part's [[Required Quotes]]. A Country
  shows **max(Required Quotes)** groups; a part appears in slots **1 … its own
  Required Quotes** (so later groups are sparser, group 1 the fullest). Selecting a
  group seeds a **new [[Market Quote]]** (the only persisted entity, ADR-0026
  untouched) pre-scoped to the parts still short of their Nth quote. The group number
  is a bucket label — **never stored on the document, never counted**; [[Release
  Eligibility]] still counts distinct Market Quotes with an approved line, unchanged.
- **The lens adds no gates.** Slots are independently fillable in any order (a dealer
  arrives out of sequence); the entry surface never blocks, orders, or nags. The only
  genuine requirement stays Required Quotes at release. "Later groups optional" means
  the *grouping* imposes no requiredness — it never softens Required Quotes itself.
- **The part-picker offers position-membership plus an escape hatch.** Group N lists
  parts with `Required Quotes ≥ N`, **pre-checking those still short** of their count
  and listing satisfied ones dimmed/unchecked, plus a collapsed "other parts in this
  Country" section so a dealer carrying an off-slot part is never imprisoned by the
  slot.
- **Progress is a layered count from one population.** Each part shows **approved
  n/N** (the Release-Eligibility figure, the canonical "done") *plus* an in-flight
  tally ("2 approved, 3 in review / 6 needed"), both keyed on distinct Market Quotes.
  The approved number is never redefined; the in-flight layer is collection visibility
  only.
- **Claiming is implicit, set on first line-filing.** Selecting a part in a dealer
  document files a line for it and makes the filer its [[Primary Researcher]] if
  unclaimed — first-come and no-takeover unchanged, but no separate self-assign act.
  Primary survives as a *derived* lead ("led by me / a peer / unclaimed"), bounded as
  before to the researcher's assigned Countries ([[Country Assignment]], ADR-0025).
  Authorship (`createdById`) is unaffected, so rejection routing and notifications are
  untouched.
- **Batch values are transient, stamp-on-create — ADR-0036 stays intact.** The
  dealer + batch step holds the five [[Batch Line-Fill]] groups in the entry session's
  UI state; selecting a part creates its Draft line **pre-stamped** with the current
  batch values. Nothing new is persisted — fields stay line-level, Batch Line-Fill
  stays a stateless writer. A part added in a *later* session starts blank until
  batched again (exactly ADR-0036's documented contract, now the uncommon path).
- **Three researcher surfaces, not one grid.** **Collect** (group entry, new
  documents only), **Drafts** (group-agnostic resume/submit of half-built documents,
  today's `DraftMarketQuotes`), and **Needs attention** (rejected lines, mirroring the
  notification deep-link). The per-part "Your quote collection" grid is retired as the
  entry path; its progress role is absorbed into the group view's n/N.

## Considered and rejected

- **Quote Group as a persisted entity** (a Group row a document belongs to). A group
  is not 1:1 with a document (one slot can be two dealers; a dealer rarely covers
  exactly the slot) and varies in membership per part's Required Quotes — persisting it
  buys nothing and invites a second source of truth against Release Eligibility.
- **Per-item claim retained.** Reintroduces exactly the friction the dealer-first
  fan-out removes — claiming 8 parts before pricing them.
- **Primary Researcher retired entirely.** Viable (authorship already routes
  rejections) but throws away the single-lead-per-part answer for no gain; we keep it
  as a derived lead.
- **Persisted document-level batch defaults.** Friendlier across sessions but makes
  the line-level fields Market Quote facts — the precise thing ADR-0036 refused.

## Consequences

- The researcher reads grow: the Collect surface needs **per-part approved + in-flight
  counts grouped by distinct Market Quote** (the current surface doesn't count), and
  the part-picker needs each part's Required Quotes and slot membership.
- `resolveResearcherEntries` / `addLineCandidates`' primary-only `mine/claimable/
  claimed` tri-mode collapses; `addLineCandidates` no longer filters on
  `primaryResearcherId === userId` (auto-claim replaces pre-claim), keeping only the
  Country and "not already on the document" filters.
- Filing the first line for an unclaimed item now writes `primaryResearcherId` as a
  side effect of line creation — first-come enforced at that write.
