# The Client Price seed trio is insert-only, like the derived value it seeds

The brief now supplies [[Client Price]] as a raw trio — `Client Item Price`,
`Client Item Price Currency`, `Client Item Price Quantity` — from which the
import **derives** `clientPrice` (USD/unit) `= price ÷ priceQuantity` (issue #86).
The three raw columns are retained on the Benchmark Item as **seed provenance**.
This ADR records that the whole Client Price group — the derived value **and** the
three raw seed columns — is written **only on insert** and **omitted on every
re-import update**, extending **ADR-0015** (which spoke only of the single
`clientPrice` column).

## Why freeze the trio too, not just the derived value

ADR-0015 made the derived `clientPrice` analyst-owned: the update path strips it,
so a re-brief can never stomp a curated benchmark. Adding three raw seed columns
raises a new question ADR-0015 never faced — does a re-import refresh the raw
trio?

We freeze it. If the trio were file-wins while the derived value stayed frozen,
an analyst edit would make the row **incoherent**: the seed would read
`100 ÷ 2 = 50` while the stored `clientPrice` held `45`, and a future engineer
seeing `trio ÷ priceQuantity ≠ clientPrice` would "fix" the apparent bug. Keeping
the entire group insert-only preserves the invariant that the seed trio always
derives to the `clientPrice` **as first seeded**, and keeps ADR-0015's rule
literally true: a re-import never touches Client Price, in any of its columns.

## Considered alternatives

- **Trio file-wins, derived frozen.** Would let an Engagement Manager see
  brief-vs-analyst drift directly on the row. Rejected for the incoherent-row
  footgun above; drift is already legible through the audit log (#16/#42) and the
  in-app editor.
- **Provenance flag (`imported | analyst`).** Already weighed and rejected in
  ADR-0015 as machinery for marginal gain; nothing here changes that.

## Consequences

- The import's update path strips **four** fields, not one: `clientPrice` and the
  three raw seed columns. A future engineer will see this skip and may "fix" it
  back to overwriting — **do not.** The skip is the point, exactly as in ADR-0015.
  (Narrowly amended by **ADR-0030**: when the existing row is *truly unpriced* —
  null `clientPrice` *and* null trio — the re-import seeds all four together, which
  keeps the trio↔derived coherence this ADR protects. It never overwrites a set or
  cleared value.)
- The raw trio means "what the brief *first* seeded this item from," never "what
  the latest brief says." It is provenance, not a live mirror.
- A non-USD `Client Item Price Currency` is an import validation error (v1), so a
  frozen trio is always USD; `priceQuantity > 0` is enforced at import, so the
  stored derivation can never divide by zero.
