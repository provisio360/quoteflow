"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createMarketQuoteAction,
  addQuoteLineAction,
  updateDraftLineAction,
} from "@/lib/quotes/actions";
import type { QuoteLineFields } from "@/lib/quotes/repository";

// The Quote entry/edit form for a Researcher (#87). A Market Quote is a dealer
// DOCUMENT (source/date/currency) that has many Quote Lines. In CREATE mode this
// form captures the document header AND the first line, then creates a one-line
// Market Quote (the common by-row case, ADR-0026); in EDIT mode it edits an
// existing Draft line's per-item fields (the header is fixed once created).
// Uncontrolled — read on submit — with empty fields sent as undefined so an edit
// only touches what was filled. Client Price is not a line field.

type Mode =
  | { type: "create"; studyId: string; country: string; itemId: string }
  | { type: "edit"; lineId: string };

// Document-header text fields (create only) and the line fields. Kept as plain
// [name, label] pairs to render a compact grid (ADR-0022: plain components).
const HEADER_FIELDS: [string, string][] = [
  ["sourceName", "Dealer / source name *"],
  ["sourceLocation", "Dealer location *"],
  ["sourceUrl", "Dealer URL"],
  ["currency", "Currency * (e.g. EUR)"],
];

const LINE_TEXT_FIELDS: [keyof QuoteLineFields, string][] = [
  ["competitorBrand", "Competitor brand *"],
  ["competitorPartNumber", "Competitor part number"],
  ["competitorPartDescription", "Competitor part description"],
  ["stockStatus", "Stock status"],
];

function str(fd: FormData, k: string): string | undefined {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? undefined : v;
}

function lineFieldsFromForm(fd: FormData): QuoteLineFields {
  const num = (k: string) => {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? undefined : Number(v);
  };
  return {
    competitorBrand: str(fd, "competitorBrand"),
    competitorPartNumber: str(fd, "competitorPartNumber"),
    competitorPartDescription: str(fd, "competitorPartDescription"),
    stockStatus: str(fd, "stockStatus"),
    notes: str(fd, "notes"),
    justification: str(fd, "justification"),
    price: str(fd, "price"),
    quantityQuoted: num("quantityQuoted"),
  };
}

const input = { padding: "0.3rem 0.4rem", width: "100%", boxSizing: "border-box" } as const;

export function QuoteEditor({
  mode,
  initial,
  onDone,
}: {
  mode: Mode;
  initial?: Partial<Record<string, string>>;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const lineFields = lineFieldsFromForm(fd);
    setMessage(null);
    startTransition(async () => {
      if (mode.type === "create") {
        // Create the one-line document: header first (allocates the Market Quote
        // Number), then its single line (allocates the Quote Line Number).
        const doc = await createMarketQuoteAction(mode.studyId, mode.country, {
          sourceName: str(fd, "sourceName") ?? null,
          sourceLocation: str(fd, "sourceLocation") ?? null,
          sourceUrl: str(fd, "sourceUrl") ?? null,
          currency: str(fd, "currency") ?? null,
          dateQuoteReceived: fd.get("dateQuoteReceived")
            ? new Date(String(fd.get("dateQuoteReceived")))
            : null,
        });
        if (!doc.ok) {
          setMessage(doc.message ?? "Couldn't create the Market Quote.");
          return;
        }
        const line = await addQuoteLineAction(doc.id, mode.itemId, lineFields);
        if (!line.ok) {
          setMessage(line.message ?? "Couldn't add the Quote Line.");
          return;
        }
      } else {
        const result = await updateDraftLineAction(mode.lineId, lineFields);
        if (!result.ok) {
          setMessage(result.message ?? "Couldn't save the Quote Line.");
          return;
        }
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <form onSubmit={handle} style={{ display: "grid", gap: "0.4rem", margin: "0.5rem 0", padding: "0.6rem", border: "1px solid #ddd" }}>
      {mode.type === "create" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
          {HEADER_FIELDS.map(([name, label]) => (
            <label key={name} style={{ fontSize: "0.85rem" }}>
              {label}
              <input name={name} defaultValue={initial?.[name] ?? ""} style={input} />
            </label>
          ))}
          <label style={{ fontSize: "0.85rem" }}>
            Date received *
            <input name="dateQuoteReceived" type="date" defaultValue={initial?.dateQuoteReceived ?? ""} style={input} />
          </label>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
        {LINE_TEXT_FIELDS.map(([name, label]) => (
          <label key={name} style={{ fontSize: "0.85rem" }}>
            {label}
            <input name={name} defaultValue={initial?.[name] ?? ""} style={input} />
          </label>
        ))}
        <label style={{ fontSize: "0.85rem" }}>
          Price * (local)
          <input name="price" type="number" step="0.0001" defaultValue={initial?.price ?? ""} style={input} />
        </label>
        <label style={{ fontSize: "0.85rem" }}>
          Quantity *
          <input name="quantityQuoted" type="number" defaultValue={initial?.quantityQuoted ?? ""} style={input} />
        </label>
      </div>
      <label style={{ fontSize: "0.85rem" }}>
        Notes
        <textarea name="notes" rows={2} defaultValue={initial?.notes ?? ""} style={input} />
      </label>
      <label style={{ fontSize: "0.85rem" }}>
        Justification (if asked to confirm your price)
        <textarea name="justification" rows={2} defaultValue={initial?.justification ?? ""} style={input} />
      </label>
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <button type="submit" disabled={pending} style={{ padding: "0.3rem 0.8rem" }}>
          {pending ? "Saving…" : mode.type === "create" ? "Add quote" : "Save"}
        </button>
        <button type="button" onClick={onDone} style={{ padding: "0.3rem 0.8rem" }}>
          Cancel
        </button>
      </div>
      <p style={{ fontSize: "0.8rem", color: "#777", margin: 0 }}>* required to submit.</p>
      {message !== null && (
        <p role="alert" style={{ color: "#b00", margin: 0 }}>
          {message}
        </p>
      )}
    </form>
  );
}
