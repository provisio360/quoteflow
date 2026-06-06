"use client";

import { useActionState } from "react";
import { setClientPriceAction } from "@/lib/benchmark-items/actions";
import type { SetClientPriceFormResult } from "@/lib/benchmark-items/actions";
import type { AnalystItemView } from "@/lib/benchmark-items/repository";

// The analyst QC list (issue #12). Rendered ONLY for Analysts (the page gates on
// role) because it exposes Client Price, which is hidden from researchers and
// clients (ADR-0003). Each row carries an inline edit: type a USD/unit value and
// Save, or clear the box and Save to un-set it (ADR-0015). Client Price is seeded
// by the brief at setup; this surface is for the analyst's later corrections.

const cell = { border: "1px solid #ddd", padding: "0.35rem 0.6rem", textAlign: "left" } as const;

export function ClientPriceList({ studyId, items }: { studyId: string; items: AnalystItemView[] }) {
  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 style={{ fontSize: "1.1rem" }}>Client Price (QC) — analyst only</h2>
      <p style={{ color: "#555", fontSize: "0.9rem" }}>
        Hidden from researchers and clients. Leave the box blank and Save to mark an item unpriced.
      </p>
      <table style={{ borderCollapse: "collapse", marginTop: "0.75rem", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>Country</th>
            <th style={cell}>Client Part No.</th>
            <th style={cell}>Item</th>
            <th style={cell}>Req. Quotes</th>
            <th style={cell}>Client Price (USD/unit)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ClientPriceRow key={item.id} studyId={studyId} item={item} />
          ))}
        </tbody>
      </table>
      {items.length === 0 && (
        <p style={{ color: "#555", marginTop: "0.75rem" }}>No benchmark items yet — import a brief first.</p>
      )}
    </section>
  );
}

function ClientPriceRow({ studyId, item }: { studyId: string; item: AnalystItemView }) {
  const [result, formAction, pending] = useActionState<SetClientPriceFormResult | null, FormData>(
    setClientPriceAction,
    null,
  );

  return (
    <tr>
      <td style={cell}>{item.country}</td>
      <td style={cell}>{item.clientPartNumber}</td>
      <td style={cell}>{item.itemDescription}</td>
      <td style={cell}>{item.requiredQuotes}</td>
      <td style={cell}>
        <form action={formAction} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="studyId" value={studyId} />
          <input
            type="text"
            inputMode="decimal"
            name="clientPrice"
            defaultValue={item.clientPrice ?? ""}
            placeholder="unpriced"
            style={{ width: "8rem", padding: "0.25rem" }}
          />
          <button type="submit" disabled={pending} style={{ padding: "0.25rem 0.75rem" }}>
            {pending ? "Saving…" : "Save"}
          </button>
          {result?.ok === true && (
            <span role="status" style={{ color: "#0a0" }}>
              {result.clientPrice === null ? "Cleared" : "Saved"}
            </span>
          )}
          {result?.ok === false && (
            <span role="alert" style={{ color: "#b00" }}>
              {result.message}
            </span>
          )}
        </form>
      </td>
    </tr>
  );
}
