"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteDraftLineAction,
  submitMarketQuoteAction,
} from "@/lib/quotes/actions";
import type { DraftMarketQuoteGroup, DraftMarketQuoteGroupLine } from "@/lib/quotes/repository";
import { formatMoney, NO_AMOUNT } from "@/domains/quotes/format-money";
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
    // Currency lives on the document, not the line — pass it through so the
    // price input groups with the right minor units (ADR-0033).
    currency: currency ?? "",
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

function DocGroup({ group }: { group: DraftDocGroup }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<SubmitReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [addItemId, setAddItemId] = useState<string | null>(null);

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

  function deleteLine(lineId: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteDraftLineAction(lineId);
      if (result.ok) router.refresh();
      else setMessage(result.message ?? "Couldn't delete that line.");
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

      <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0" }}>
        {group.lines.map((l) => {
          const missing = lineMissing.get(l.lineId) ?? [];
          return (
            <li key={l.lineId} style={{ padding: "0.25rem 0" }}>
              #{l.quoteLineNumber} · {l.itemLabel} · {l.competitorBrand ?? "—"} {group.currency ? formatMoney(l.price, group.currency) : l.price ?? NO_AMOUNT}
              <span style={{ marginLeft: "0.4rem" }}>
                <button type="button" style={btn} disabled={pending} onClick={() => setEditingLineId(editingLineId === l.lineId ? null : l.lineId)}>
                  {editingLineId === l.lineId ? "Close" : "Edit"}
                </button>
                <button type="button" style={btn} disabled={pending} onClick={() => deleteLine(l.lineId)}>
                  Delete
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
