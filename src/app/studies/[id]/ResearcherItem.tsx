"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { selfAssignBenchmarkItemAction } from "@/lib/benchmark-items/actions";
import {
  deleteDraftQuoteAction,
  reviseQuoteAction,
  submitQuoteAction,
} from "@/lib/quotes/actions";
import type { QuoteView } from "@/lib/quotes/repository";
import type { TransitionResult } from "@/domains/quotes/lifecycle";
import { QuoteEditor } from "./QuoteEditor";
import {
  quoteAffordances,
  type GuidanceFields,
  type ItemMode,
} from "@/domains/benchmark-items/researcher-view";

type Item = GuidanceFields;

type ActionResult = { ok: boolean; message?: string } | TransitionResult;

function failureMessage(r: ActionResult): string {
  if (r.ok) return "";
  if ("reason" in r) {
    switch (r.reason) {
      case "missing-fields":
        return `Fill required fields first: ${r.missing.join(", ")}.`;
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
  quotes,
  myUserId,
}: {
  item: Item;
  mode: ItemMode;
  quotes: QuoteView[];
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
                    #{q.quoteNumber} · <strong>{q.state}</strong> · {q.competitorBrand ?? "—"} / {q.dealerName ?? "—"}{" "}
                    {q.price ?? "—"} {q.currency ?? ""} — {q.authorName}
                    {(can.canEdit || can.canSubmit || can.canDelete) && (
                      <span style={{ marginLeft: "0.4rem" }}>
                        {can.canEdit && (
                          <button type="button" style={btn} onClick={() => setEditingId(editingId === q.id ? null : q.id)}>
                            {editingId === q.id ? "Close" : "Edit"}
                          </button>
                        )}
                        {can.canSubmit && (
                          <button type="button" style={btn} disabled={pending} onClick={() => run(() => submitQuoteAction(q.id))}>
                            Submit
                          </button>
                        )}
                        {can.canDelete && (
                          <button type="button" style={btn} disabled={pending} onClick={() => run(() => deleteDraftQuoteAction(q.id))}>
                            Delete
                          </button>
                        )}
                      </span>
                    )}
                    {can.canRevise && (
                      <span style={{ marginLeft: "0.4rem" }}>
                        <button type="button" style={btn} disabled={pending} onClick={() => run(() => reviseQuoteAction(q.id))}>
                          Revise
                        </button>
                      </span>
                    )}
                    {can.showRejectionReason && q.rejectionReason && (
                      <div style={{ color: "#b00", fontSize: "0.85rem" }}>Returned: {q.rejectionReason}</div>
                    )}
                    {can.canEdit && editingId === q.id && (
                      <QuoteEditor
                        mode={{ type: "edit", quoteId: q.id }}
                        initial={initialFromQuote(q)}
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
              <QuoteEditor mode={{ type: "create", itemId: item.id }} onDone={() => setAdding(false)} />
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

/** Prefill the editor from an existing draft (Decimal/Date already marshalled to
 *  strings on QuoteView, except quantity/date which we format for the inputs). */
function initialFromQuote(q: QuoteView): Record<string, string> {
  const date = q.dateQuoteReceived ? new Date(q.dateQuoteReceived).toISOString().slice(0, 10) : "";
  return {
    competitorBrand: q.competitorBrand ?? "",
    dealerName: q.dealerName ?? "",
    dealerLocation: q.dealerLocation ?? "",
    dealerUrl: q.dealerUrl ?? "",
    currency: q.currency ?? "",
    stockStatus: q.stockStatus ?? "",
    leadTime: q.leadTime ?? "",
    warranty: q.warranty ?? "",
    discount: q.discount ?? "",
    notes: q.notes ?? "",
    justification: q.justification ?? "",
    price: q.price ?? "",
    quantityQuoted: q.quantityQuoted === null ? "" : String(q.quantityQuoted),
    dateQuoteReceived: date,
  };
}
