"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createMarketQuoteAction,
  addQuoteLineAction,
  updateDraftLineAction,
  updateMarketQuoteAction,
} from "@/lib/quotes/actions";
import type { MarketQuoteHeaderFields, QuoteLineFields } from "@/lib/quotes/repository";
import { ISO_3166_COUNTRY_NAMES } from "@/domains/benchmark-items/countries";
import {
  currencyOptions,
  defaultCurrencyOnCountryChange,
} from "@/domains/quotes/quote-currency-picker";
import { formatMoneyInput, parseMoneyInput } from "@/domains/quotes/format-money";

// The Quote entry/edit form for a Researcher (#87, #97). A Market Quote is a dealer
// DOCUMENT (source/date/currency) that has many Quote Lines. Modes:
//   create     — capture the document header AND a first line, creating a one-line
//                Market Quote (the common by-row case, ADR-0026);
//   edit       — edit an existing Draft line's per-item fields;
//   addLine    — add another Draft line to an EXISTING document (#97/Q5);
//   editHeader — edit an existing Draft document's header (#97/Q6), allowed only
//                while the document is unconverted (gated in the repository).
// Uncontrolled — read on submit — with empty fields sent as undefined so an edit
// only touches what was filled. Client Price is not a line field.

type Mode =
  | { type: "create"; studyId: string; country: string; itemId: string }
  | { type: "edit"; lineId: string }
  | { type: "addLine"; marketQuoteId: string; itemId: string }
  | { type: "editHeader"; marketQuoteId: string };

// Document-header text fields (create only) and the line fields. Kept as plain
// [name, label] pairs to render a compact grid (ADR-0022: plain components).
// Free-text header fields. Dealer Country and Currency are validated pickers
// rendered separately (controlled, country drives the currency default — ADR-0032).
const HEADER_FIELDS: [string, string][] = [
  ["sourceName", "Dealer / source name *"],
  ["sourceLocality", "Dealer locality *"],
  ["sourceUrl", "Dealer URL"],
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
    // The input groups at rest (ADR-0033 amendment); strip the thousands commas
    // before the bare number reaches storage/conversion.
    price: ((p) => (p === undefined ? undefined : parseMoneyInput(p)))(str(fd, "price")),
    quantityQuoted: num("quantityQuoted"),
  };
}

function headerFieldsFromForm(fd: FormData): MarketQuoteHeaderFields {
  return {
    sourceName: str(fd, "sourceName") ?? null,
    sourceLocality: str(fd, "sourceLocality") ?? null,
    sourceCountry: str(fd, "sourceCountry") ?? null,
    sourceUrl: str(fd, "sourceUrl") ?? null,
    currency: str(fd, "currency") ?? null,
    dateQuoteReceived: fd.get("dateQuoteReceived")
      ? new Date(String(fd.get("dateQuoteReceived")))
      : null,
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

  // Dealer Country + Currency are the only controlled fields: changing the
  // country re-applies that country's default currency (ADR-0032). Currency
  // options carry any legacy free-text value so an edit round-trips it.
  const [country, setCountry] = useState(initial?.sourceCountry ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? "");

  function onCountryChange(next: string) {
    setCountry(next);
    const applied = defaultCurrencyOnCountryChange(next);
    if (applied !== null) setCurrency(applied);
  }

  function handle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setMessage(null);
    startTransition(async () => {
      if (mode.type === "create") {
        // Create the one-line document: header first (allocates the Market Quote
        // Number), then its single line (allocates the Quote Line Number).
        const doc = await createMarketQuoteAction(
          mode.studyId,
          mode.country,
          headerFieldsFromForm(fd),
        );
        if (!doc.ok) {
          setMessage(doc.message ?? "Couldn't create the Market Quote.");
          return;
        }
        const line = await addQuoteLineAction(doc.id, mode.itemId, lineFieldsFromForm(fd));
        if (!line.ok) {
          setMessage(line.message ?? "Couldn't add the Quote Line.");
          return;
        }
      } else if (mode.type === "addLine") {
        const line = await addQuoteLineAction(mode.marketQuoteId, mode.itemId, lineFieldsFromForm(fd));
        if (!line.ok) {
          setMessage(line.message ?? "Couldn't add the Quote Line.");
          return;
        }
      } else if (mode.type === "editHeader") {
        const result = await updateMarketQuoteAction(mode.marketQuoteId, headerFieldsFromForm(fd));
        if (!result.ok) {
          setMessage(result.message ?? "Couldn't save the document details.");
          return;
        }
      } else {
        const result = await updateDraftLineAction(mode.lineId, lineFieldsFromForm(fd));
        if (!result.ok) {
          setMessage(result.message ?? "Couldn't save the Quote Line.");
          return;
        }
      }
      router.refresh();
      onDone();
    });
  }

  const showHeader = mode.type === "create" || mode.type === "editHeader";
  const showLine = mode.type === "create" || mode.type === "edit" || mode.type === "addLine";
  const submitLabel = pending
    ? "Saving…"
    : mode.type === "create"
      ? "Add quote"
      : mode.type === "addLine"
        ? "Add line"
        : mode.type === "editHeader"
          ? "Save details"
          : "Save";

  return (
    <form onSubmit={handle} style={{ display: "grid", gap: "0.4rem", margin: "0.5rem 0", padding: "0.6rem", border: "1px solid #ddd" }}>
      {showHeader && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
          {HEADER_FIELDS.map(([name, label]) => (
            <label key={name} style={{ fontSize: "0.85rem" }}>
              {label}
              <input name={name} defaultValue={initial?.[name] ?? ""} style={input} />
            </label>
          ))}
          <label style={{ fontSize: "0.85rem" }}>
            Dealer country *
            <select
              name="sourceCountry"
              value={country}
              onChange={(e) => onCountryChange(e.target.value)}
              style={input}
            >
              <option value="">— select country —</option>
              {ISO_3166_COUNTRY_NAMES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "0.85rem" }}>
            Currency *
            <select
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              style={input}
            >
              <option value="">— select currency —</option>
              {currencyOptions(initial?.currency).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "0.85rem" }}>
            Date received *
            <input name="dateQuoteReceived" type="date" defaultValue={initial?.dateQuoteReceived ?? ""} style={input} />
          </label>
        </div>
      )}
      {showLine && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
            {LINE_TEXT_FIELDS.map(([name, label]) => (
              <label key={name} style={{ fontSize: "0.85rem" }}>
                {label}
                <input name={name} defaultValue={initial?.[name] ?? ""} style={input} />
              </label>
            ))}
            <label style={{ fontSize: "0.85rem" }}>
              Price * (local)
              <input
                name="price"
                type="text"
                inputMode="decimal"
                defaultValue={formatMoneyInput(initial?.price, currency)}
                // Grouped at rest with the document currency's minor units (ADR-0033
                // amendment): a `text` input — a number input can't hold a comma.
                // Strip commas on focus for clean editing, re-group on blur. A bare
                // number (no symbol) posts; commas are stripped again server-side.
                onFocus={(e) => {
                  e.target.value = parseMoneyInput(e.target.value);
                }}
                onBlur={(e) => {
                  const v = parseMoneyInput(e.target.value.trim());
                  if (v === "" || !currency) return;
                  if (Number.isNaN(Number(v))) return;
                  e.target.value = formatMoneyInput(v, currency);
                }}
                style={{ ...input, textAlign: "right" }}
              />
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
        </>
      )}
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <button type="submit" disabled={pending} style={{ padding: "0.3rem 0.8rem" }}>
          {submitLabel}
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
