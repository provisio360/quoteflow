# Batch line-fill is a stateless document-scoped writer, not document columns

A researcher pricing one dealer often gets the same answer for every item —
"all in stock, 3-week lead, same warranty, no discount." To avoid retyping it
per [[Quote Line]], the Draft entry surface offers a **batch line-fill**: a
document-level panel that stamps a group of line fields onto **every Draft line**
in a [[Market Quote]] at once. The batched groups are stock status, the shipping
lead-time pair, landed cost, warranty 1, warranty 2, and the discount chain
(issue #128).

The load-bearing decision is what batch-fill is *not*: it is **not** a promotion
of these fields to the [[Market Quote]] document. They remain **line-level**
fields (CONTEXT.md; landed cost is a per-line cross-border conditional, ADR-0035;
warranty/discount are per-line). Batch-fill is a pure **convenience writer** — it
loops the configured values onto the document's Draft lines and holds no state of
its own. Per-line entry/edit is unchanged and remains the override path.

## Decisions

- **Stamp-all, not default-at-entry.** Batch writes existing Draft lines
  immediately (a researcher fills the whole document *after* the lines exist), and
  is **overwrite-all per group** (it replaces a line's current value, it does not
  only fill blanks — blank is a legitimate value to stamp, e.g. discount = No).
- **An empty group field stamps blank (clears), it does not skip.** The batch
  group-builder maps an empty select to **`null`** (clear on every Draft line),
  deliberately diverging from the single-line entry parser (`str()` in
  `quote-line-form.ts`), where an empty field is `undefined` (omit — "don't touch"
  this field on a partial edit). The two contracts differ on purpose: a per-line
  edit is partial, so empty = leave alone; a per-group **apply is total**, so empty
  = set blank. This is what makes "the click is the intent" hold for optional
  fields — there is no skip-vs-clear ambiguity, because empty *is* clear (issue
  #128, stock-status group).
- **Six coherent groups, intra-group gating reused from the entry form.** Discount
  is batched as the whole chain (available → type + applied → value), so a stamped
  chain is always coherent; landed cost (included + note) only appears when the
  document is cross-border (`landedCostApplies`, doc-uniform since both countries
  live on the document). "Per-field overwrite" means per-*group*.
- **Per-group apply.** Each group has its own "apply to all N draft lines" button
  — one server action over the document's Draft lines. Clicking *is* the intent,
  so there is no skip-vs-clear ambiguity that a single combined apply would have
  for optional/tri-state fields.
- **Draft-only, owner-only, draft surface only.** Batch inherits
  `updateDraftLine`'s gate: it writes only **Draft** lines (Submitted/Approved/
  Rejected are immutable to the author), only the author's own document, only on
  the Draft entry surface, and the panel shows only at **≥2 Draft lines** (one
  line — just edit it).
- **No new validation; no audit; no notification.** Batch writes the group
  verbatim and the existing **document submit** gate catches incoherence
  (half-pairs, ADR-0034/0035) exactly as per-line edit does today — one coherence
  gate, not two. Draft writes are not in the audited action set and push nothing.
- **Stateless — no inherited defaults.** Because batch stores no document-level
  template, a line added *after* a batch starts blank; re-clicking the group's
  apply (which targets "all Draft lines" live) covers late additions.

## Considered and rejected

- **Default-at-entry (pre-fill new lines only).** Doesn't help fill a document
  whose lines already exist — the common case after adding all the dealer's items.
- **Promote the fields to Market Quote columns.** Contradicts their line-level
  nature: landed cost is per-line cross-border, and brand/warranty/discount
  legitimately vary line to line. Batch must not relocate the fields.
- **Fill-blanks-only.** Can't correct a doc-wide mistake without first clearing
  lines, and "is `false`/No filled?" is murky for tri-state fields.
- **One combined apply with per-group include checkboxes.** Reintroduces state to
  misread; per-group apply makes the click itself the disambiguator.

## Consequences

- A new repository writer (`batchUpdateDraftLines(principal, marketQuoteId,
  group)`) and its action, gated identically to `updateDraftLine`, writing all the
  document's Draft lines in one transaction.
- The Draft document group (`DraftMarketQuotes`) gains the collapsible batch
  panel; the single-line `QuoteEditor` and its gating logic are reused so batch and
  per-line entry can never present different field shapes.
