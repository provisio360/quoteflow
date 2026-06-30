"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  batchDeleteDraftLinesAction,
  submitMarketQuoteAction,
  batchUpdateDraftLinesAction,
} from "@/lib/quotes/actions";
import type {
  DraftMarketQuoteGroup,
  DraftMarketQuoteGroupLine,
  QuoteLineFields,
} from "@/lib/quotes/repository";
import { formatMoney, NO_AMOUNT } from "@/domains/quotes/format-money";
import { landedCostApplies } from "@/domains/quotes/landed-cost";
import { emptyBatchGroupValues, type BatchGroupValues } from "@/domains/quotes/batch-line-fill";
import { BatchGroupFields } from "./BatchGroupFields";
import {
  partitionSubmitReport,
  type AddLineCandidate,
  type SubmitReport,
} from "@/domains/benchmark-items/researcher-view";
import { QuoteEditor } from "./QuoteEditor";

// The document-grouped researcher submit surface (#97). Each of the researcher's
// own Draft Market Quotes is one group: its shared document facts, its Draft lines,
// and the ONE document-level "Submit market quote" control. The bulk submit is
// all-or-nothing, so a failure shows the per-line missing-field report (split into
// the document banner and per-line rows, partitionSubmitReport) and nothing moves.
// Draft mutation lives here (Edit/Delete lines, + Add line, Edit details), so the
// fix-and-retry loop is self-contained (#97/Q8).

/** A Draft document plus the items a new line may be added for (#97/Q5/Q7). */
export type DraftDocGroup = DraftMarketQuoteGroup & {
  readonly addCandidates: readonly AddLineCandidate[];
};

/** A line's required-to-submit field renders by a friendly name, not its key. */
const FIELD_LABEL: Record<string, string> = {
  sourceName: "dealer / source name",
  sourceCountry: "dealer country",
  sourceLocality: "dealer locality",
  currency: "currency",
  dateQuoteReceived: "date received",
  competitorBrand: "competitor brand",
  price: "price",
  quantityQuoted: "quantity",
  warrantyOffered: "warranty offered?",
  warranty1Value: "warranty 1 value",
  warranty1Unit: "warranty 1 unit",
  warranty2Value: "warranty 2 value",
  warranty2Unit: "warranty 2 unit",
  leadTimeValue: "shipping lead time value",
  leadTimeUnit: "shipping lead time unit",
  landedCostIncluded: "landed cost included?",
};

const btn = { padding: "0.2rem 0.55rem", marginRight: "0.3rem" } as const;

/** Marshal a line into the editor's initial values (the slim subset the panel
 *  carries; untouched fields stay undefined so an edit only writes what changed). */
function initialFromLine(
  l: DraftMarketQuoteGroupLine,
  currency: string | null,
): Record<string, string> {
  return {
    competitorBrand: l.competitorBrand ?? "",
    price: l.price ?? "",
    quantityQuoted: l.quantityQuoted === null ? "" : String(l.quantityQuoted),
    // Warranty Offered? round-trips as the dropdown's tri-state string ("true"/
    // "false"/""): null ⇒ unanswered ⇒ blank option. The pairs ride under Yes.
    warrantyOffered: l.warrantyOffered === null ? "" : String(l.warrantyOffered),
    warranty1Value: l.warranty1Value ?? "",
    warranty1Unit: l.warranty1Unit ?? "",
    warranty2Value: l.warranty2Value ?? "",
    warranty2Unit: l.warranty2Unit ?? "",
    // Discount chain round-trips as the dropdowns' tri-state strings ("true"/
    // "false"/""): null ⇒ unanswered ⇒ blank option. The % is recorded as-is.
    discountAvailable: l.discountAvailable === null ? "" : String(l.discountAvailable),
    discountApplied: l.discountApplied === null ? "" : String(l.discountApplied),
    discountValue: l.discountValue ?? "",
    discountType: l.discountType ?? "",
    leadTimeValue: l.leadTimeValue ?? "",
    leadTimeUnit: l.leadTimeUnit ?? "",
    // Landed cost round-trips as the dropdown's tri-state string; the Note rides
    // along only when Included = Yes (ADR-0035).
    landedCostIncluded: l.landedCostIncluded === null ? "" : String(l.landedCostIncluded),
    landedCostNote: l.landedCostNote ?? "",
    // Currency lives on the document, not the line — pass it through so the
    // price input groups with the right minor units (ADR-0033).
    currency: currency ?? "",
    // Round-trip any existing Justification so an edit doesn't blank it (ADR-0014).
    justification: l.justification ?? "",
  };
}

/** Prefill the header editor from the document's current facts. */
function initialFromHeader(g: DraftDocGroup): Record<string, string> {
  return {
    sourceName: g.sourceName ?? "",
    sourceLocality: g.sourceLocality ?? "",
    sourceCountry: g.sourceCountry ?? "",
    sourceUrl: g.sourceUrl ?? "",
    currency: g.currency ?? "",
    dateQuoteReceived: g.dateQuoteReceived
      ? new Date(g.dateQuoteReceived).toISOString().slice(0, 10)
      : "",
  };
}

/**
 * Batch line-fill panel (#128 / ADR-0036; selected-set #151 / ADR-0039): stamps a group
 * of line fields onto a CHOSEN SUBSET of the document's Draft lines. Shown only at ≥2
 * Draft lines (one line — just edit it). The researcher first checks which lines an apply
 * targets (one, several, or all — "all" is just checking every box); every group's apply
 * is DISABLED until at least one line is selected, so a forgotten selection can never
 * silently stamp the whole document. The selection is over the LINES, never over which
 * groups apply — each group keeps its own apply button (the click IS the intent), now
 * landing on the selected set. The selection PERSISTS across applies, so several groups
 * can be stamped onto the same subset in succession.
 *
 * Groups (the shared `BatchGroupFields`, identical to the Collect dealer step): the
 * Competitor brand (ADR-0039), stock status, the shipping lead-time pair (#129), the
 * warranty chain (ADR-0037 — one Offered? gate over both pairs), landed cost (#130, shown
 * only cross-border, mirroring the single-line form), and the discount chain (#131). Each
 * per-group apply stays TOTAL on the selected lines: leaving a half blank stamps blank
 * (clears); a half-filled pair is stampable and caught by the existing submit gate, not
 * here (ADR-0034/0035). The writer intersects the selected ids with the document's
 * still-writable Draft lines and reports the count actually written.
 */
function BatchFillPanel({
  marketQuoteId,
  lines,
  dealerCountry,
  marketCountry,
}: {
  marketQuoteId: string;
  lines: readonly DraftMarketQuoteGroupLine[];
  dealerCountry?: string;
  marketCountry: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<BatchGroupValues>(emptyBatchGroupValues);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Which Draft lines an apply targets. Persists across applies (re-fired against the
  // live set); only explicit (un)checking changes it. Empty ⇒ every apply disabled.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // Same predicate the single-line form uses, so the group's show/hide can never drift
  // from per-line entry. Both countries live on the document → uniform across lines.
  const showLandedCost = landedCostApplies(dealerCountry, marketCountry);

  const allSelected = selected.size === lines.length && lines.length > 0;
  function toggleLine(lineId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(lines.map((l) => l.lineId)));
  }

  function apply(group: QuoteLineFields) {
    if (selected.size === 0) return; // guarded by the disabled button; defend anyway
    setError(null);
    setStatus(null);
    const lineIds = [...selected];
    startTransition(async () => {
      const result = await batchUpdateDraftLinesAction(marketQuoteId, group, lineIds);
      if (result.ok) {
        const n = result.count ?? 0;
        setStatus(`Applied to ${n} line${n === 1 ? "" : "s"}.`);
        router.refresh();
      } else {
        setError(result.message ?? "Couldn't apply to the draft lines.");
      }
    });
  }

  return (
    <details style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
      <summary style={{ cursor: "pointer", color: "#555" }}>Set for selected lines</summary>
      <div style={{ marginTop: "0.4rem" }}>
        <fieldset style={{ border: "1px solid #ddd", borderRadius: 4, padding: "0.4rem 0.6rem", margin: "0 0 0.5rem" }}>
          <legend style={{ color: "#555", padding: "0 0.3rem" }}>
            Lines to apply to ({selected.size} of {lines.length} selected)
          </legend>
          <label style={{ display: "block", fontWeight: 600, padding: "0.15rem 0" }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ marginRight: "0.4rem" }} />
            {allSelected ? "Clear all" : "Select all"}
          </label>
          {lines.map((l) => (
            <label key={l.lineId} style={{ display: "block", padding: "0.1rem 0" }}>
              <input
                type="checkbox"
                checked={selected.has(l.lineId)}
                onChange={() => toggleLine(l.lineId)}
                style={{ marginRight: "0.4rem" }}
              />
              #{l.quoteLineNumber} · {l.itemLabel}
            </label>
          ))}
        </fieldset>
        <BatchGroupFields
          values={values}
          onChange={setValues}
          showLandedCost={showLandedCost}
          renderApply={(group) => (
            <button
              type="button"
              disabled={pending || selected.size === 0}
              onClick={() => apply(group)}
              style={{ padding: "0.2rem 0.55rem" }}
            >
              Apply to {selected.size} selected line{selected.size === 1 ? "" : "s"}
            </button>
          )}
        />
      </div>
      {status !== null && (
        <p style={{ color: "#555", margin: "0.3rem 0 0" }}>{status}</p>
      )}
      {error !== null && (
        <p role="alert" style={{ color: "#b00", margin: "0.3rem 0 0" }}>
          {error}
        </p>
      )}
    </details>
  );
}

function DocGroup({ group }: { group: DraftDocGroup }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<SubmitReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [addItemId, setAddItemId] = useState<string | null>(null);
  // Which Draft lines the one "Delete selected" button targets. Own state, kept apart
  // from the batch-fill panel's selection (Q2): a destructive delete never shares a
  // selection with the fill convenience. Empty ⇒ the delete button is disabled.
  const [selectedForDelete, setSelectedForDelete] = useState<ReadonlySet<string>>(new Set());

  // The header is editable only while the document has never been submitted — once
  // converting/converted the Exchange Rate is pinned to its date (#97/Q6, ADR-0004).
  const headerEditable = group.conversionStatus === null;

  function submit() {
    setMessage(null);
    setReport(null);
    startTransition(async () => {
      const result = await submitMarketQuoteAction(group.marketQuoteId);
      if (result.ok) {
        router.refresh();
        return;
      }
      if (result.reason === "lines-incomplete") {
        setReport(partitionSubmitReport(result.perLine, group.lines));
      } else if (result.reason === "no-draft-lines") {
        setMessage("This market quote has no draft lines to submit.");
      } else {
        setMessage(result.message ?? "Couldn't submit the market quote.");
      }
    });
  }

  const allLinesSelected =
    selectedForDelete.size === group.lines.length && group.lines.length > 0;
  function toggleLineForDelete(lineId: string) {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }
  function toggleAllForDelete() {
    setSelectedForDelete(
      allLinesSelected ? new Set() : new Set(group.lines.map((l) => l.lineId)),
    );
  }

  function deleteSelected() {
    if (selectedForDelete.size === 0) return; // guarded by the disabled button; defend anyway
    const n = selectedForDelete.size;
    if (!window.confirm(`Delete ${n} line${n === 1 ? "" : "s"}? This can't be undone.`)) return;
    setMessage(null);
    const lineIds = [...selectedForDelete];
    startTransition(async () => {
      const result = await batchDeleteDraftLinesAction(group.marketQuoteId, lineIds);
      if (result.ok) {
        setSelectedForDelete(new Set());
        router.refresh();
      } else {
        setMessage(result.message ?? "Couldn't delete the selected lines.");
      }
    });
  }

  const docMissingLabels = report?.docMissing.map((f) => FIELD_LABEL[f] ?? f) ?? [];
  const lineMissing = new Map(report?.lines.map((l) => [l.lineId, l.missing]) ?? []);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: "0.6rem 0.8rem", marginTop: "0.6rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        <strong>
          {group.country} · Quote {group.marketQuoteNumber}
        </strong>
        <span style={{ color: "#777" }}>
          — {group.sourceName ?? "—"} {group.currency ? `(${group.currency})` : ""}
        </span>
        {headerEditable && (
          <button type="button" style={{ ...btn, marginLeft: "auto" }} onClick={() => setEditingHeader((v) => !v)}>
            {editingHeader ? "Close" : "Edit details"}
          </button>
        )}
      </div>

      {editingHeader && headerEditable && (
        <QuoteEditor
          mode={{ type: "editHeader", marketQuoteId: group.marketQuoteId }}
          initial={initialFromHeader(group)}
          onDone={() => setEditingHeader(false)}
        />
      )}

      {docMissingLabels.length > 0 && (
        <p role="alert" style={{ color: "#b00", margin: "0.4rem 0", fontSize: "0.9rem" }}>
          ⚠ Document missing: {docMissingLabels.join(", ")}.
        </p>
      )}

      {group.lines.length >= 2 && (
        <BatchFillPanel
          marketQuoteId={group.marketQuoteId}
          lines={group.lines}
          dealerCountry={group.sourceCountry ?? undefined}
          marketCountry={group.country}
        />
      )}

      {group.lines.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.4rem", fontSize: "0.85rem" }}>
          <label style={{ color: "#555" }}>
            <input
              type="checkbox"
              checked={allLinesSelected}
              onChange={toggleAllForDelete}
              style={{ marginRight: "0.4rem" }}
            />
            {allLinesSelected ? "Clear all" : "Select all"}
          </label>
          <button
            type="button"
            disabled={pending || selectedForDelete.size === 0}
            onClick={deleteSelected}
            style={{ padding: "0.2rem 0.55rem" }}
          >
            Delete selected ({selectedForDelete.size})
          </button>
        </div>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0" }}>
        {group.lines.map((l) => {
          const missing = lineMissing.get(l.lineId) ?? [];
          return (
            <li key={l.lineId} style={{ padding: "0.25rem 0" }}>
              <input
                type="checkbox"
                checked={selectedForDelete.has(l.lineId)}
                onChange={() => toggleLineForDelete(l.lineId)}
                style={{ marginRight: "0.4rem" }}
                aria-label={`Select line ${l.quoteLineNumber} for deletion`}
              />
              #{l.quoteLineNumber} · {l.itemLabel} · {l.competitorBrand ?? "—"} {group.currency ? formatMoney(l.price, group.currency) : l.price ?? NO_AMOUNT}
              <span style={{ marginLeft: "0.4rem" }}>
                <button type="button" style={btn} disabled={pending} onClick={() => setEditingLineId(editingLineId === l.lineId ? null : l.lineId)}>
                  {editingLineId === l.lineId ? "Close" : "Edit"}
                </button>
              </span>
              {missing.length > 0 && (
                <span style={{ color: "#b00", fontSize: "0.85rem", marginLeft: "0.3rem" }}>
                  — missing: {missing.map((f) => FIELD_LABEL[f] ?? f).join(", ")}
                </span>
              )}
              {editingLineId === l.lineId && (
                <QuoteEditor
                  mode={{ type: "edit", lineId: l.lineId }}
                  initial={initialFromLine(l, group.currency)}
                  marketCountry={group.country}
                  dealerCountry={group.sourceCountry ?? undefined}
                  // Show the Justification field only when this line was returned
                  // to its author for a Justification (its price is flagged) — ADR-0014.
                  showJustification={l.flagged}
                  onDone={() => setEditingLineId(null)}
                />
              )}
            </li>
          );
        })}
      </ul>

      <div style={{ marginTop: "0.4rem" }}>
        {addItemId === null ? (
          group.addCandidates.length > 0 && (
            <label style={{ fontSize: "0.85rem", marginRight: "0.5rem" }}>
              {"+ Add line for: "}
              <select
                defaultValue=""
                onChange={(e) => e.target.value && setAddItemId(e.target.value)}
                style={{ padding: "0.2rem" }}
              >
                <option value="" disabled>
                  pick an item…
                </option>
                {group.addCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : (
          <QuoteEditor
            mode={{ type: "addLine", marketQuoteId: group.marketQuoteId, itemId: addItemId }}
            marketCountry={group.country}
            dealerCountry={group.sourceCountry ?? undefined}
            onDone={() => setAddItemId(null)}
          />
        )}
        <button type="button" disabled={pending} onClick={submit} style={{ padding: "0.3rem 0.8rem" }}>
          {pending ? "Submitting…" : "Submit market quote"}
        </button>
      </div>

      {message !== null && (
        <p role="alert" style={{ color: "#b00", margin: "0.3rem 0 0" }}>
          {message}
        </p>
      )}
    </div>
  );
}

export function DraftMarketQuotes({ groups }: { groups: readonly DraftDocGroup[] }) {
  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 style={{ fontSize: "1.1rem" }}>Your draft market quotes</h2>
      {groups.length === 0 ? (
        <p style={{ color: "#777" }}>No draft market quotes.</p>
      ) : (
        groups.map((g) => <DocGroup key={g.marketQuoteId} group={g} />)
      )}
    </section>
  );
}
