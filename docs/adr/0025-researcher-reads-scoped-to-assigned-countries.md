# Researcher reads are scoped to assigned (study, country) pairs

ADR-0001 stands: internal staff are cross-tenant and not tenant-scoped. This ADR
**narrows one role inside that**. A **Researcher**'s reads of tenant-owned
resources are scoped to the **(study, country)** pairs they hold a
[[Country Assignment]] in. Data for countries they are not assigned to is a
**confidentiality** concern — they must not be able to *load* it, not merely have
it hidden from the UI. Every other role is unchanged: Engagement Manager,
Analyst, and Admin keep full cross-tenant `all` visibility (ADR-0008); Client
Users remain tenant-scoped.

## A second visibility axis, layered — not a wider tenant rule

ADR-0008 commits to **exactly one** tenant-isolation rule: `tenantVisibility`
returns `{scope:"all"}` for internal staff, `{scope:"tenant"}` for a client user,
and stays pure (a `Principal` in, a spec out, no DB). That rule is **left
untouched** — a Researcher is still internal, still `all` on the *tenant* axis.

The country boundary is a **separate, orthogonal layer** AND-ed on top of the
tenant rule for the Researcher role only. The two axes are different
confidentiality walls keyed on different data: tenant isolation walls *between
clients* (keyed on `clientId`); this walls *within a tenant, across (study,
country)* (keyed on a set of `(studyId, country)` pairs). Folding it into the
tenant union was rejected: it would force `tenantVisibility` to take more than a
`Principal` (it would need assignment rows → a DB read), breaking the purity
ADR-0008 depends on. Instead the layer is its own pure decision core, fed the
Researcher's assigned pair-set by a thin adapter that resolves it per request —
the same "pure core, adapter translates" shape as the tenant rule.

## Researcher-only gate, pair-set key

The layer is gated on the role first: it returns **unrestricted** for EM,
Analyst, and Admin (their assignment data is never even loaded) and a
`(studyId, country)` **pair-set** scope **only** when `role === "Researcher"`. A
Client User never reaches the layer — the tenant wall is already terminal for
them. So "only the Researcher is narrowed" is **structural**, not a config flag:
the other internal roles short-circuit before the boundary exists.

## One pair-set, two derived read surfaces

A single resolved pair-set drives both granularities, tested two ways, so they
cannot drift:

- **Study list** — a Study is visible if **any** assigned pair has
  `studyId === study.id` (existence over the set).
- **Benchmark Item** — an Item is visible if `(item.studyId, item.country)` is a
  **member** of the set (exact membership).

Study-level visibility is therefore just the projection of item-level visibility
onto `studyId`. A Researcher assigned to `(S1, France)` sees S1 in their list but
inside S1 sees only France items; Germany items in the same S1 stay hidden.

## Quote visibility: co-researcher coordination preserved within, walled outside

A Researcher reading a [[Quote]] passes through three filters, in this order:

1. **Tenant wall** (ADR-0008) — client isolation, underneath everything.
2. **Country wall** (this ADR) — is `(item.studyId, item.country)` in my
   pair-set? If not, the quote is invisible, full stop. This test is
   **author-blind and state-blind**: it hides the quote whatever its state and
   whoever wrote it.
3. **Pool filter** (ADR-0011) — within an assigned country only:
   `createdById === me OR state <> 'Draft'`.

This reconciles the existing rules rather than overriding them:

- Two Researchers both assigned to `(S1, France)` still see each other's
  Submitted/Approved/Rejected Quotes on France items — ADR-0003's co-researcher
  market-observation visibility is **preserved within** assigned countries.
- Neither sees **any** Quote — Draft, Submitted, or Approved — on `(S1, Germany)`
  if unassigned there: the country wall is **outside** the pool filter and
  subtracts from co-researcher visibility, hiding even a co-researcher's
  *Submitted* quote that the bare ADR-0003 rule would otherwise show.
- A Researcher's own **Draft** stays private to its author everywhere
  (ADR-0011, unchanged) — the country wall only ever removes visibility, never
  adds it.

The new wall **only subtracts**: it can hide a quote the older rules would show,
never reveal one they would hide.

## App-layer only, no RLS — and future slices inherit this

Enforcement is **app-layer only** (ADR-0008), consistent with how Country
Assignment and Country Release are already enforced. **No** RLS policy backstops
this boundary; the tenant RLS wall (ADR-0021) remains underneath, but the
country scope is not pushed into the database. This is a scope decision, not a
security compromise: the boundary is a confidentiality wall, but it is enforced
by the same principal-or-nothing read path the tenant rule uses, and a bypass
would be as loud and intentional there as a tenant bypass.

This ADR is recorded **before** the enforcement slice. Future Benchmark Item and
Quote *browse* slices must honor this boundary — testing exact `(study, country)`
membership for items and the `∃ studyId` projection for study lists — so they
**inherit** it rather than re-deriving it. A future engineer who exposes an
unassigned country's items or quotes to a Researcher, or who "simplifies" the
three-filter quote composition by dropping the author-blind country wall, is
undoing a deliberate confidentiality decision — don't.

## Scope

This is a **read-visibility** boundary. Researcher writes are governed by the
existing assignment rules unchanged: self-assigning a [[Benchmark Item]]
(becoming [[Primary Researcher]]) is already permitted only within a Country the
Researcher holds a Country Assignment to.

Cross-references: ADR-0001 (client is the tenant), ADR-0003 (Client Price hidden
from researchers; co-researcher quotes visible), ADR-0008 (app-layer-first
isolation, one pure tenant rule), ADR-0011 (Draft private to its author).
