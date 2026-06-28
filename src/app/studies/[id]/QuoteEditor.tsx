"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createMarketQuoteAction,
  addQuoteLineAction,
  updateDraftLineAction,
  updateMarketQuoteAction,
} from "@/lib/quotes/actions";
import type { QuoteLineFields } from "@/lib/quotes/repository";
import { ISO_3166_COUNTRY_NAMES } from "@/domains/benchmark-items/countries";
import {
  currencyOptions,
  defaultCurrencyOnCountryChange,
} from "@/domains/quotes/quote-currency-picker";
import { formatMoneyInput, parseMoneyInput } from "@/domains/quotes/format-money";
import { stockStatusOptions } from "@/domains/quotes/stock-status";
import { leadTimeUnitOptions } from "@/domains/quotes/lead-time-unit";
import { landedCostApplies } from "@/domains/quotes/landed-cost";
import { ValueUnitField } from "./ValueUnitField";
import { WarrantyField } from "./WarrantyField";
import { LandedCostField } from "./LandedCostField";
import { DiscountField } from "./DiscountField";
import {
  headerFieldsFromForm,
  lineFieldsFromForm,
} from "@/domains/quotes/quote-line-form";

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
];

const input = { padding: "0.3rem 0.4rem", width: "100%", boxSizing: "border-box" } as const;

export function QuoteEditor({
  mode,
  initial,
  onDone,
  // The market Country and Dealer Country the Landed Cost conditional reads (ADR-0035).
  // In create mode the Dealer Country is the live header select and the market is
  // mode.country; in edit/addLine both are fixed on the saved document and passed in.
  marketCountry,
  dealerCountry,
  // Whether to show the Justification field — true only when editing a flagged line
  // the analyst returned to its author for a Justification (ADR-0014). A brand-new
  // line (create/addLine) has no USD yet so is never flagged, hence the default.
  showJustification = false,
}: {
  mode: Mode;
  initial?: Partial<Record<string, string>>;
  onDone: () => void;
  marketCountry?: string;
  dealerCountry?: string;
  showJustification?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  // Dealer Country + Currency are the only controlled fields: changing the
  // country re-applies that country's default currency (ADR-0032). Currency
  // options carry any legacy free-text value so an edit round-trips it.
  const [country, setCountry] = useState(initial?.sourceCountry ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? "");

  // Discount is a chain of dropdowns: "Discount available?" gates "Discount
  // applied to the quote?", which in turn gates the % and type. Controlled so the
  // nested fields only render (and only post) once their parent is "Yes". The %
  // is recorded as a percentage; it is NOT applied to the price (the price is
  // already the dealer's discount-inclusive final, per CONTEXT/ADR-0026).
  const [discountAvailable, setDiscountAvailable] = useState(initial?.discountAvailable ?? "");
  const [discountApplied, setDiscountApplied] = useState(initial?.discountApplied ?? "");

  // Warranty Offered? gates the two warranty pairs (ADR-0037). Controlled so the pairs
  // only render (and only post) once Offered is "Yes"; a No/blank answer clears them on
  // save. Required to submit — blank blocks (unlike the discount "available" gate).
  const [warrantyOffered, setWarrantyOffered] = useState(initial?.warrantyOffered ?? "");

  // Landed Cost is shown only when the part crosses a border — Dealer Country differs
  // from the market Country (ADR-0035). The Dealer Country is the live select in
  // create mode and a fixed prop otherwise. When hidden the fields unmount and post
  // nothing, so a stale answer clears (like the discount chain). The Note nests under
  // Included? = Yes.
  const [landedCostIncluded, setLandedCostIncluded] = useState(initial?.landedCostIncluded ?? "");
  const effectiveDealerCountry = mode.type === "create" ? country : dealerCountry;
  const effectiveMarketCountry = mode.type === "create" ? mode.country : marketCountry;
  const showLandedCost = landedCostApplies(effectiveDealerCountry, effectiveMarketCountry);

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
              Stock status
              <select name="stockStatus" defaultValue={initial?.stockStatus ?? ""} style={input}>
                <option value="">— select —</option>
                {stockStatusOptions(initial?.stockStatus).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
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
          {/* Warranty: a Yes/No "Offered?" gate over up to two value+unit pairs
              (ADR-0037). Offered is required to submit; the pairs show only under Yes
              and clear on save otherwise. Rendered via the shared WarrantyField so
              batch line-fill and per-line entry can never present a divergent shape. */}
          <WarrantyField
            mode="uncontrolled"
            offered={warrantyOffered}
            onOfferedChange={setWarrantyOffered}
            offeredName="warrantyOffered"
            defaults={initial}
          />
          {/* Shipping Lead Time: a numeric value + a unit (ADR-0035). Either half may
              be left blank while drafting; a half-filled pair is caught at document
              submit, like warranty. Same shared widget as warranty and batch fill. */}
          <ValueUnitField
            mode="uncontrolled"
            label="Shipping lead time"
            unitOptions={leadTimeUnitOptions}
            valueName="leadTimeValue"
            unitName="leadTimeUnit"
            defaultValue={initial?.leadTimeValue}
            defaultUnit={initial?.leadTimeUnit}
          />
          {/* Landed Cost is a cross-border conditional (ADR-0035): shown only when the
              Dealer Country differs from the market Country. Hidden ⇒ unmounted ⇒ posts
              nothing ⇒ a stale answer clears. The Note nests under Included? = Yes. When
              shown, an answer is required at submit. */}
          {showLandedCost && (
            <LandedCostField
              mode="uncontrolled"
              included={landedCostIncluded}
              onIncludedChange={setLandedCostIncluded}
              includedName="landedCostIncluded"
              noteName="landedCostNote"
              defaultNote={initial?.landedCostNote}
            />
          )}
          {/* Discount chain (advisory metadata) via the shared DiscountField so
              batch line-fill (#131) and per-line entry can never present a divergent
              shape. "Available?" gates type + "Applied?"; "Applied?" gates the %. The
              % is recorded as typed (15 = 15%) and is NOT applied to the price. */}
          <DiscountField
            mode="uncontrolled"
            available={discountAvailable}
            onAvailableChange={setDiscountAvailable}
            applied={discountApplied}
            onAppliedChange={setDiscountApplied}
            availableName="discountAvailable"
            appliedName="discountApplied"
            typeName="discountType"
            valueName="discountValue"
            defaultType={initial?.discountType}
            defaultValue={initial?.discountValue}
          />
          <label style={{ fontSize: "0.85rem" }}>
            Notes
            <textarea name="notes" rows={2} defaultValue={initial?.notes ?? ""} style={input} />
          </label>
          {/* Shown only when the analyst returned this line asking the author to
              confirm its price (the line is flagged) — ADR-0014. */}
          {showJustification && (
            <label style={{ fontSize: "0.85rem" }}>
              Justification (your price was queried — confirm why it is correct)
              <textarea name="justification" rows={2} defaultValue={initial?.justification ?? ""} style={input} />
            </label>
          )}
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
