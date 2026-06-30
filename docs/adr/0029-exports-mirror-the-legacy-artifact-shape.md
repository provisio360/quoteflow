# Exports mirror the legacy artifact shape verbatim

The Internal Export (analyst_tracker) and Client Export (client_final_report) are
shaped to **reproduce the real `pricing_study_example1_*` workbooks
column-for-column**, rather than emit a cleaner normalized shape of our own. The
artifacts are an existing contract our users already parse, so fidelity to them
beats internal tidiness. Builds on ADR-0026 (which named these two export shapes)
and respects ADR-0003 (no Client Price client-side) and ADR-0011 (no Drafts).

## What the source data showed

Both example workbooks are a **single sheet named after the study** (`"Boznia"`),
**not** one sheet per Market — every row carries a `Market` column, and example1
simply has one market (Brazil, 144 rows). The cell conventions are the legacy
spreadsheet's, not ours: booleans render `Yes`/`No`; not-applicable dependent
fields (discount type/applied, landed-cost note) render the literal `"N/A"`; the
first column is `Row Id`; dates are bare `YYYY-MM-DD`; `Converted Currency` is a
constant `"USD"`.

## Decision

- **One detail sheet per workbook, named after the study** (sanitized + truncated
  to Excel's 31-char limit), with `Market` as a column. Multiple countries are
  more rows, sorted Market → Client Item Number → Quote Line Number — never
  separate tabs. **(Row order superseded by ADR-0040:** ordering is now
  document-major — Market Quote Number → Client Source Unit (A→Z) → Client Item
  Number (A→Z). The column/cell/keying decisions below still stand.)
- **The column set is a fixed superset** matching the artifact exactly. Columns
  with no backing schema field — the 5 competitor-descriptive ones (Competitor
  Category, Source Unit, Source Unit Identifier, Item Offering, Item Secondary
  Description) — are emitted **always-blank**, never dropped, so the contract stays
  stable as future slices add the data. (Per-project-type column visibility is a
  later UI concern; the export shape stays fixed.)
- **`Row Id` = `quoteLineNumber`** (ADR-0026), which is per-`(study, country)`. In
  the single multi-country sheet it therefore **repeats across markets**; the
  unique handle is the composite **`(Market, Row Id)`**. We deliberately do *not*
  synthesize a sheet-global sequential id — that would reintroduce the render-time
  row position `quoteLineNumber` was created to kill.
- **Cell rendering mirrors the file**: booleans → `Yes`/`No`; discount/landed-cost
  dependent fields → `"N/A"` when their parent flag is off; dates → `YYYY-MM-DD`;
  everything else blank when null.
- **Internal adds three native analyst_tracker columns** the client shape omits
  (`Client Item Price (USD/unit)`, `Quoted Price Difference to Client Price`,
  `Paper Quote`) **plus four trailing columns beyond the artifact**: `Price Flag`
  (direction, populated only when the line is actually flagged), `Justification`,
  and — because the artifact has no way to show it otherwise — the line's `State`
  and latest `Rejection Reason`. The State/Rejection columns deviate from the
  artifact deliberately: an analyst tracker that spans Submitted/Approved/Rejected
  is useless if it can't show which a line is, or why it was rejected. The Client
  Export carries none of these seven.
- **`Quoted Price Difference to Client Price` is the symmetric relative-difference
  fraction** — the same `|a−b| / ((a+b)/2)` measure the Price Flag compares to the
  QC Threshold (confirmed against the artifact's stored values) — emitted whenever
  the line is comparable, blank otherwise.
- **Client Export adds one global `Summary` sheet** (per-Benchmark-Item
  min/median/max, the Competitor Price Range population) after the detail sheet;
  the example file omitted it but CONTEXT/issue require it. Internal stays
  detail-only.
- **Empty populations emit a header-only sheet** (zero data rows), so a download
  always opens with its column contract visible.

## Consequences

- A blank competitor-descriptive column is **intended**, not a data bug; a future
  engineer must not "fix" it by deleting the column.
- `Row Id` is not unique within a multi-country sheet — consumers key on
  `(Market, Row Id)`.
- The Summary sheet's rows are kept fully structured (Market, item identity,
  min/median/max, count) so future analytical views can read it directly.
