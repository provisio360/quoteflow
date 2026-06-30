# Batch line-fill apply targets a selected set of lines, and gains a brand group

ADR-0036 made [[Batch Line-Fill]] a stateless writer that stamps a group onto
**every** Draft line, and **rejected** "per-group include checkboxes" so that
clicking a group's apply *is* the intent — no selection state to misread. In
practice a dealer document often splits: most lines share an answer but a few
differ (some parts in stock, two on backorder; one part a different competitor
brand). Stamp-all forces the researcher to batch the majority, then hand-correct
the exceptions per line — and a doc-wide mistake can only be undone by clearing.

This ADR **amends ADR-0036** on two points and leaves the rest intact: the
**Drafts** surface lets the apply target a **chosen subset of Draft lines**, and
the **[[Competitor]] brand** becomes a sixth batch group. The Collect dealer step
(ADR-0038) is unchanged in mechanism — its "selected set" was always the
part-picker checkboxes; it simply gains the brand group too (shared field shape).

## Decisions

- **Selection is over lines, not over groups.** ADR-0036 rejected per-*group*
  include checkboxes (which *fields* to apply) — that rejection stands: each group
  still has its own apply button, and clicking it stamps that whole group. What is
  new is a per-*line* selection (which *lines* a click lands on). The two axes are
  distinct; "the click is the intent" is preserved because a click still applies a
  known group, now to the explicitly-selected lines.
- **Disabled until ≥1 line selected.** The Drafts panel renders a compact checkbox
  list (client item # + description) co-located with the apply buttons; every
  group's apply is **disabled at zero selection**. There is no implicit "empty means
  all" — applying is always to an explicit set, so a forgotten selection can never
  silently stamp the whole document. ("All" is just checking every box.)
- **Per-group apply stays total on the selected lines.** Within the selected set the
  ADR-0036 contract is unchanged: overwrite-all per group, **empty-is-clear** (an
  empty field stamps `null`), no fill-blanks-only. The subset narrows *which* lines,
  never *whether* a field clears.
- **The writer intersects silently.** `batchUpdateDraftLines` gains a `lineIds`
  argument and stamps the **intersection** of the requested ids with {this
  document's Draft lines owned by the principal}. Ids that are no longer writable
  (submitted in another tab) or foreign are **dropped without error** — the request
  narrows, the existing Draft-only / owner-only gate still decides. It returns the
  count actually written.
- **Competitor brand is the sixth group — brand only.** `competitorBrand` is the
  one competitor field uniform across a document (CONTEXT); it joins the batch group
  builders with the same empty-is-clear contract. `competitorPartNumber` and
  `competitorPartDescription` stay **per-line** — they identify the specific
  competitor part and vary every line; batching them would overwrite real per-line
  data. Because `BatchGroupFields` is shared, the brand group appears on **both** the
  Drafts panel and the Collect dealer step.
- **Still no validation, audit, or notification.** Unchanged from ADR-0036 — the
  document-submit gate remains the single coherence check; Draft writes push nothing.

## Considered and rejected

- **Keep stamp-all only.** The status quo; forces hand-correcting every exception
  line and can't fix a doc-wide mistake without clearing. The split-document case is
  common enough to warrant subset.
- **"Empty selection = all lines" (backward-compat).** Preserves today's one-click
  path but reintroduces exactly the silent-doc-wide-stamp risk; disabled-at-zero is
  chosen instead, "all" being one extra click (check every box).
- **Reject the apply when a selected id isn't writable.** A benign race (a line
  submitted in another tab) would block a legitimate batch; intersect-silently keeps
  the gate authoritative without a new error path.
- **Per-group include checkboxes (ADR-0036's original rejection).** Still rejected —
  the new selection is on the line axis, not the group axis; per-group apply remains
  one button per group.
- **Batch the competitor part number/description too.** They are per-line identity,
  not document-uniform; a doc-wide stamp would usually be wrong.

## Consequences

- `batchUpdateDraftLines(principal, marketQuoteId, group, lineIds)` and its action
  gain the `lineIds` subset, intersecting against the existing owner/Draft gate.
- `BatchGroupValues` / the per-group builders gain a brand group; `batchStampFields`
  spreads it, so both surfaces get brand with no divergence.
- `BatchFillPanel` (Drafts) gains the per-line checkbox list and shared selection
  set, with each apply disabled until the set is non-empty and labelled by its size.
- CONTEXT's [[Batch Line-Fill]] entry updated: six groups, and the Drafts apply
  targets a selected set of lines.
