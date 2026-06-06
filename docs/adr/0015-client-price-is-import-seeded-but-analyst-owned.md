# Client Price is import-seeded once, then analyst-owned — a carve-out from ADR-0009

A Benchmark Item's [[Client Price]] rides in on the **client brief** at study
setup: it is a column in the same spreadsheet import that carries part number,
country, required quotes, etc. (issue #12). But unlike every other column on a
Benchmark Item, the brief is **not its source of truth**. After the item exists,
the [[Analyst]] owns the Client Price and maintains it in-app; a re-import never
touches it.

This is a deliberate exception to **ADR-0009 (bulk import is the source of
truth)**, and it exists because Client Price is not client data in the same sense
as the rest of the brief — it is an **internal QC benchmark** the analyst curates
(ADR-0003), which merely happens to be convenient to seed from the brief.

## The rule: blunt insert-only

- **Insert (study setup):** the import writes `clientPrice` from the sheet when it
  first creates the item. This is the normal entry path — items arrive priced.
- **Update (re-import):** the import **never writes `clientPrice`**. Whatever the
  analyst has (or has not) set is preserved. A corrected brief cannot fix a
  Client Price on an existing item — that is now the analyst's job in-app.
- **Optional / nullable:** the column is no longer required and the field is
  nullable. An item the client never priced is created with no Client Price and
  is **not comparable** — no [[Price Flag]], and approval is *not* blocked (there
  is no benchmark to violate). This mirrors how an unconverted [[Quote]] is not
  comparable.
- **Analyst maintenance:** an Analyst-gated action sets a positive value or
  clears it back to null. Validation matches import (`> 0` when present).

## Why not the alternatives

- **Import always wins (the original code).** A routine re-brief would silently
  stomp an analyst's curated benchmark. Rejected: it makes "the analyst owns
  Client Price" a lie.
- **Provenance-tracked sticky** (`clientPriceSource: imported | analyst`;
  re-import overwrites only still-`imported` values). More faithful in one edge
  case — a corrected brief could fix a typo'd seed the analyst never touched —
  but it adds a column and branching for a case the in-app editor already
  handles. Rejected as machinery for marginal gain.
- **Drop Client Price from the brief entirely** (analyst types every value
  in-app). Rejected: the brief is where the value is known at setup; typing
  hundreds of benchmarks by hand is the workflow QuoteFlow exists to kill.

## Consequences

- The import's update path must **omit** `clientPrice` from the written row. A
  future engineer will see this skip and may "fix" it back to overwriting —
  **do not.** The skip is the point, exactly as the column being hidden from
  researchers is the point in ADR-0003.
- `BenchmarkItem.clientPrice` becomes nullable; the import column becomes
  optional.
- The pure flag core (`evaluatePriceFlag`) takes `clientPrice: number | null`
  and returns `{ comparable: false }` when it is null — the same shape as a null
  USD price-per-unit. Unit-tested at that boundary.
- The flag is **derived on read** (no stored `flagged` column), so an analyst
  correcting a Client Price re-flags queued quotes automatically; already-decided
  verdicts are not retroactively changed.
- A full audit trail of Client Price edits is **out of scope** here and deferred
  to the audit slice (#16/#42), consistent with the rest of the codebase;
  `updatedAt` is the only provenance v1 keeps.
