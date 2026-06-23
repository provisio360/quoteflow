# A re-import seeds Client Price onto a truly-unpriced item — a narrow opening of ADR-0015/0027

ADR-0015 made [[Client Price]] analyst-owned by making the import's **update**
path skip it; ADR-0027 extended that skip to the raw seed trio. Both end with the
same warning: *"a future engineer will see this skip and may 'fix' it back to
overwriting — do not."* This ADR records the **one** exception we now allow, and
why it is not that forbidden fix.

## The gap this closes

Items created **before** they could be priced — e.g. seeded before #86 added the
Client Price trio to the brief — have `clientPrice` null and an empty seed trio.
Because they already exist, every subsequent brief import is an **update**, which
strips the whole price group. So a brief that has *always* carried a price can
**never** seed these items: they are stuck unpriced forever, even though no
analyst value is at risk. ADR-0015 named this limitation ("a corrected brief
cannot fix a Client Price on an existing item") and waved it to in-app work — but
hand-pricing back-fill across a whole study is exactly the manual toil QuoteFlow
exists to kill.

## The rule: seed on update only when truly unpriced

On the import update path, write the full Client Price group (derived
`clientPrice` + the three raw seed columns) from the brief **iff the existing row
is truly unpriced** — `clientPrice` null **AND** the seed trio null. Otherwise the
group is stripped, exactly as ADR-0015/0027 require. Insert is unchanged.

"Truly unpriced" must exclude a value the analyst deliberately **cleared**, or we
resurrect a benchmark they removed on purpose. We distinguish the two states
**without a new provenance column**, using an invariant the code already holds:

| State | `clientPrice` | seed trio | Re-import seeds? |
|---|---|---|---|
| Never seeded (the gap) | null | null | **yes** |
| Analyst cleared | null | non-null | no |
| Normally priced | non-null | non-null | no |

`setClientPrice` clears only `clientPrice` and never the trio; import writes all
four together on insert; the trio is all-or-nothing (ADR-0027). So a null
`clientPrice` beside a **non-null** trio can only mean "an analyst cleared a value
that was once seeded" — off-limits. A null `clientPrice` beside a **null** trio is
the genuine never-priced case — eligible.

A seed-on-update that establishes a value (null → non-null) emits
`auditClientPriceChange` (before null, after the seeded value) **in addition to**
the generic import event, so every Client Price transition is audited no matter
which path makes it (ADR-0015's audit, ADR-0019). A brief that is itself unpriced
for the row is a null → null no-op and logs no price change.

## Why this is not "import always wins"

- It never touches a value that is **set** — the ADR-0015 footgun (a routine
  re-brief silently stomping a curated benchmark) stays closed.
- It never touches a value the analyst **cleared** — the table above keeps the
  clear deliberate, not a transient the next import undoes.
- It cannot create an **incoherent row** (ADR-0027's footgun): it writes the
  derived value and its trio **together**, so `trio ÷ priceQuantity = clientPrice`
  always holds for a seeded row.

The brief is still *not* the source of truth for a Client Price that exists; it is
only allowed to fill a hole that was never filled.

## Considered alternatives

- **Brief always wins on re-import (reverse ADR-0015).** Makes Client Price
  client-owned. Rejected: reopens the stomp footgun and contradicts ADR-0003's
  "the analyst curates the QC benchmark."
- **Seed when `clientPrice` is null, ignoring the trio.** Simpler, but resurrects
  an analyst-cleared price — the trio-null discriminator is the whole point.
- **Add a `clientPriceSource: imported | analyst` column.** The provenance
  machinery ADR-0015 already rejected as marginal. Still unnecessary: the existing
  trio nullity already encodes the one distinction we need.

## Consequences

- The update path can no longer strip the price group **blindly** — it must read
  each existing row's `clientPrice` + trio (within the import transaction) to
  apply the gate per item. The strip remains the default; seeding is the
  exception.
- The comment "Import never changes Client Price, so no before/after" at the
  import audit site is no longer true and is replaced: import **may** establish a
  Client Price (null → value) on a truly-unpriced item, and that transition is
  audited like any other.
- The invariant future engineers must preserve is now subtler than "import never
  writes Client Price on update": it is "import never **overwrites** a Client
  Price, but **may seed** one onto a row that is null with a null trio." Do not
  collapse this back to either extreme.
