"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { selfAssignBenchmarkItemAction } from "@/lib/benchmark-items/actions";
import {
  deleteDraftLineAction,
  reviseLineAction,
  submitMarketQuoteAction,
} from "@/lib/quotes/actions";
import type { QuoteLineView } from "@/lib/quotes/repository";
import type { TransitionResult, SubmitDocumentResult } from "@/domains/quotes/lifecycle";
import { QuoteEditor } from "./QuoteEditor";
import {
  quoteAffordances,
  type GuidanceFields,
  type ItemMode,
} from "@/domains/benchmark-items/researcher-view";

type Item = GuidanceFields;

type ActionResult =
  | { ok: boolean; message?: string }
  | TransitionResult
  | SubmitDocumentResult;

function failureMessage(r: ActionResult): string {
  if (r.ok) return "";
  if ("reason" in r) {
    switch (r.reason) {
      case "lines-incomplete": {
        // Bulk submit is all-or-nothing: report which lines still lack what (#88).
        const detail = r.perLine
          .map((l) => `line ${l.lineId} (${l.missing.join(", ")})`)
          .join("; ");
        return `Fill required fields before submitting the market quote: ${detail}.`;
      }
      case "no-draft-lines":
        return "This market quote has no draft lines to submit.";
      case "illegal-transition":
        return "This quote can't change state right now (already actioned).";
      case "conversion-pending":
        return "Waiting on currency conversion.";
      case "needs-justification":
        return "Add a justification first.";
      case "missing-reason":
        return "A reason is required.";
      default:
        return "Couldn't complete that.";
    }
  }
  return r.message ?? "Couldn't complete that.";
}

const btn = { padding: "0.2rem 0.55rem", marginRight: "0.3rem" } as const;

/** One client-guidance field in the `mine` panel (#66). Null shows as an em-dash. */
function Guidance({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ display: "flex", gap: "0.4rem", padding: "0.05rem 0" }}>
      <dt style={{ color: "#777", minWidth: "11rem" }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value ?? "—"}</dd>
    </div>
  );
}

export function ResearcherItem({
  item,
  mode,
  studyId,
  quotes,
  myUserId,
}: {
  item: Item;
  mode: ItemMode;
  studyId: string;
  quotes: QuoteLineView[];
  myUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function run(action: () => Promise<ActionResult>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setMessage(failureMessage(result));
    });
  }

  function claim() {
    const fd = new FormData();
    fd.set("itemId", item.id);
    run(() => selfAssignBenchmarkItemAction(fd));
  }

  return (
    <li style={{ padding: "0.6rem 0", borderTop: "1px solid #eee" }}>
      <strong>{item.clientItemNumber}</strong> — {item.itemDescription}{" "}
      <span style={{ color: "#777" }}>(needs {item.requiredQuotes} quote{item.requiredQuotes === 1 ? "" : "s"})</span>

      {mode === "claimable" && (
        <button type="button" onClick={claim} disabled={pending} style={{ ...btn, marginLeft: "0.5rem" }}>
          Claim
        </button>
      )}
      {mode === "claimed" && <span style={{ color: "#999", marginLeft: "0.5rem" }}>claimed by another researcher</span>}

      {/* The work panel is shown both for items I lead (`mine`) and items a peer
          leads (`claimed`): same guidance + quote list, but a claimed item gets no
          write affordances — quote actions are owner-only (quoteAffordances) and
          "+ Add quote" is gated to `mine` below (#68). */}
      {(mode === "mine" || mode === "claimed") && (
        <div style={{ marginTop: "0.4rem" }}>
          <dl style={{ margin: "0 0 0.6rem", fontSize: "0.9rem", color: "#333" }}>
            <Guidance label="Client item number" value={item.clientItemNumber} />
            <Guidance label="Item description" value={item.itemDescription} />
            <Guidance label="Configuration comment" value={item.configurationComment} />
            <Guidance label="Quantity" value={item.quantity === null ? null : String(item.quantity)} />
            <Guidance label="Client source unit" value={item.clientSourceUnit} />
          </dl>
          {quotes.length === 0 ? (
            <p style={{ color: "#777", margin: "0.2rem 0" }}>No quotes yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {quotes.map((q) => {
                const can = quoteAffordances(q, myUserId);
                return (
                  <li key={q.id} style={{ padding: "0.25rem 0" }}>
                    #{q.quoteLineNumber} · <strong>{q.state}</strong> · {q.competitorBrand ?? "—"}{" "}
                    {q.price ?? "—"} — {q.authorName}
                    {(can.canEdit || can.canSubmit || can.canDelete) && (
                      <span style={{ marginLeft: "0.4rem" }}>
                        {can.canEdit && (
                          <button type="button" style={btn} onClick={() => setEditingId(editingId === q.id ? null : q.id)}>
                            {editingId === q.id ? "Close" : "Edit"}
                          </button>
                        )}
                        {can.canSubmit && (
                          // Interim: submit fires at the document grain (#88); the
                          // proper per-document Submit control is #97. Submitting
                          // here moves every Draft line in this line's Market Quote.
                          <button type="button" style={btn} disabled={pending} onClick={() => run(() => submitMarketQuoteAction(q.marketQuoteId))} title="Submits all draft lines in this market quote">
                            Submit market quote
                          </button>
                        )}
                        {can.canDelete && (
                          <button type="button" style={btn} disabled={pending} onClick={() => run(() => deleteDraftLineAction(q.id))}>
                            Delete
                          </button>
                        )}
                      </span>
                    )}
                    {can.canRevise && (
                      <span style={{ marginLeft: "0.4rem" }}>
                        <button type="button" style={btn} disabled={pending} onClick={() => run(() => reviseLineAction(q.id))}>
                          Revise
                        </button>
                      </span>
                    )}
                    {can.showRejectionReason && q.rejectionReason && (
                      <div style={{ color: "#b00", fontSize: "0.85rem" }}>Returned: {q.rejectionReason}</div>
                    )}
                    {can.canEdit && editingId === q.id && (
                      <QuoteEditor
                        mode={{ type: "edit", lineId: q.id }}
                        initial={initialFromLine(q)}
                        onDone={() => setEditingId(null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {mode === "mine" &&
            (adding ? (
              <QuoteEditor
                mode={{ type: "create", studyId, country: item.country, itemId: item.id }}
                onDone={() => setAdding(false)}
              />
            ) : (
              <button type="button" style={{ ...btn, marginTop: "0.3rem" }} onClick={() => setAdding(true)}>
                + Add quote
              </button>
            ))}
        </div>
      )}

      {message !== null && (
        <p role="alert" style={{ color: "#b00", margin: "0.3rem 0 0" }}>
          {message}
        </p>
      )}
    </li>
  );
}

/** Prefill the line editor from an existing Draft line (Decimal already marshalled
 *  to a string on QuoteLineView; quantity formatted for the input). The dealer/
 *  date/currency live on the parent document, not the line, so they are not here. */
function initialFromLine(q: QuoteLineView): Record<string, string> {
  return {
    competitorBrand: q.competitorBrand ?? "",
    competitorPartNumber: q.competitorPartNumber ?? "",
    competitorPartDescription: q.competitorPartDescription ?? "",
    stockStatus: q.stockStatus ?? "",
    notes: q.notes ?? "",
    justification: q.justification ?? "",
    price: q.price ?? "",
    quantityQuoted: q.quantityQuoted === null ? "" : String(q.quantityQuoted),
  };
}
