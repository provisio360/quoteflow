"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDraftQuoteAction, updateDraftQuoteAction } from "@/lib/quotes/actions";
import type { QuoteFields } from "@/lib/quotes/repository";

// The Quote entry/edit form for a Researcher (#8). One form for both create (on an
// item) and edit (on a draft). Uncontrolled — read on submit — since there are
// many optional fields; empty fields are sent as undefined so an edit only
// touches what was filled. Client Price is not a Quote field, so nothing here is
// tenant-sensitive. The Justification field lets the author answer a flag.

type Mode = { type: "create"; itemId: string } | { type: "edit"; quoteId: string };

const TEXT_FIELDS: [keyof QuoteFields, string][] = [
  ["competitorBrand", "Competitor brand *"],
  ["dealerName", "Dealer name *"],
  ["dealerLocation", "Dealer location *"],
  ["dealerUrl", "Dealer URL"],
  ["currency", "Currency * (e.g. EUR)"],
  ["stockStatus", "Stock status"],
  ["leadTime", "Lead time"],
  ["warranty", "Warranty"],
  ["discount", "Discount"],
];

function fieldsFromForm(fd: FormData): QuoteFields {
  const str = (k: string) => {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? undefined : v;
  };
  const num = (k: string) => {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? undefined : Number(v);
  };
  const date = (k: string) => {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? undefined : new Date(v);
  };
  return {
    competitorBrand: str("competitorBrand"),
    dealerName: str("dealerName"),
    dealerLocation: str("dealerLocation"),
    dealerUrl: str("dealerUrl"),
    currency: str("currency"),
    stockStatus: str("stockStatus"),
    leadTime: str("leadTime"),
    warranty: str("warranty"),
    discount: str("discount"),
    notes: str("notes"),
    justification: str("justification"),
    price: str("price"),
    quantityQuoted: num("quantityQuoted"),
    dateQuoteReceived: date("dateQuoteReceived"),
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
    const fields = fieldsFromForm(new FormData(event.currentTarget));
    setMessage(null);
    startTransition(async () => {
      const result =
        mode.type === "create"
          ? await createDraftQuoteAction(mode.itemId, fields)
          : await updateDraftQuoteAction(mode.quoteId, fields);
      if (result.ok) {
        router.refresh();
        onDone();
      } else {
        setMessage(result.message ?? "Couldn't save the quote.");
      }
    });
  }

  return (
    <form onSubmit={handle} style={{ display: "grid", gap: "0.4rem", margin: "0.5rem 0", padding: "0.6rem", border: "1px solid #ddd" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
        {TEXT_FIELDS.map(([name, label]) => (
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
        <label style={{ fontSize: "0.85rem" }}>
          Date received *
          <input name="dateQuoteReceived" type="date" defaultValue={initial?.dateQuoteReceived ?? ""} style={input} />
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
