# Money is minor-unit-aware in-app; exports stay artifact-faithful (`#,##0`)

Every monetary amount **in the application UI** renders through one shared
`Intl.NumberFormat("en-US", { style: "currency", currency })` helper — grouping +
currency symbol + the code's ISO 4217 **minor units** (USD `2`, JPY/KRW `0`,
BHD/KWD `3`), right-aligned in table columns, with a null/not-comparable amount
shown as an em-dash `—`. USD-derived figures (the [[Client Price]], the
[[Converted USD Price / USD Price per Unit|Converted USD]] values) pass `"USD"`; a
raw local dealer price passes its parent [[Market Quote]]'s currency. The
[[Export|Exports]], by contrast, are **deliberately excluded** — they keep mirroring
the real `pricing_study_example1_*` artifact, whose money columns are whole-number
`#,##0` (zero decimals, Excel-default right-aligned), per ADR-0029. So the two money
surfaces intentionally **diverge**: the app shows decimals and a symbol, the
workbook shows none.

## Considered options

- **Blanket 2-decimal everywhere** (including exports and local JPY/KRW): rejected
  — it misformats zero- and three-minor-unit currencies, and overriding the export
  to 2dp breaks the byte-for-byte artifact contract (ADR-0029) downstream consumers
  already parse.
- **Apply the rule to exports too** (amend ADR-0029): rejected — fidelity to the
  existing artifact beats internal consistency between the two surfaces; the
  workbook is a contract, the screen is not.

## Consequences

- A future engineer will notice the app and the export format money differently —
  this is intentional, not a bug to "fix."
- Minor-unit-aware local-price display needs the **document currency at the render
  site**. `QuoteLineView` currently omits it (currency lives on the parent
  [[Market Quote]], CONTEXT.md), so surfacing local price minor-unit-correctly in
  the researcher item view requires joining `marketQuote.currency` into that
  read view — a display-only join that does not move currency ownership onto the
  line.
- Editable price inputs (the analyst Client Price box, the QuoteEditor local price)
  format-on-blur and right-align, but never reformat keystrokes — formatting must
  not fight typing.

## Amendment — editable inputs are grouped at rest (`28,911.32`)

The original decision left the two editable price inputs showing an **ungrouped**
bare number (`28911.32` via `toFixed`), grouping only the read-only surfaces. This
amendment groups the inputs too, so a thousands separator is shown on every
in-app money figure, editable or not — without reopening the *don't-fight-typing*
principle above, which it honours.

- **A second display helper, `formatMoneyInput`** joins `formatMoney`. It groups
  with the currency's ISO 4217 minor units but emits **no symbol** (`28,911.32`,
  not `$28,911.32`) — an input box holds a bare number, not a currency string. It
  replaces the old `toFixed(dp)` at both the initial `defaultValue` and the
  on-blur reformat. A blank/null value stays **blank** (not the read-only `—`).
- **A parse helper, `parseMoneyInput`,** strips every comma before the value is
  `Number()`-parsed in the pure decision cores (`parseClientPrice` and the
  quote-line price parse). Safe because the app pins `Intl.NumberFormat("en-US")`
  everywhere, so a comma is *unambiguously* a thousands separator, never a decimal.
  **Lenient**: mis-grouped input (`2,8,911.32`) still parses — bad numbers are
  rejected by the existing `> 0` check, not by grouping-pattern validation.
- **Grouping is at-rest only.** `onFocus` strips commas back to a raw number for
  clean editing; `onBlur` re-groups. Commas exist only when the field is *not*
  being edited — this is what "must not fight typing" means, with zero caret math.
- **`QuoteEditor`'s local-price input changes `type="number"` → `type="text"
  inputMode="decimal"`.** A native number input cannot hold a comma at all; the
  Client Price box was already `type="text"`.
- Exports are **still** excluded — ADR-0029's `#,##0` artifact contract stands. The
  two-surface divergence this ADR established is unchanged; only the in-app input
  display moves from ungrouped to grouped.
