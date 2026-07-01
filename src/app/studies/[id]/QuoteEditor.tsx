"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
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
import { formatMoneyInput, parseMoneyInput, formatMoney } from "@/domains/quotes/format-money";
import { convert } from "@/domains/quotes/conversion";
import type { StudyRatePreview } from "@/domains/exchange-rates/preview";
import { peerSpreadFlag } from "@/domains/quotes/peer-spread-flag";
import { decimalSlip, quantityPlausible } from "@/domains/quotes/mechanical-checks";
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
// DOCUMENT (source/date/currency) that has many Quote Lines. New documents are
// seeded only through the Collect flow now (ADR-0038, #143); the modes here all
// edit an EXISTING document:
//   edit       — edit an existing Draft line's per-item fields;
//   addLine    — add another Draft line to an EXISTING document (#97/Q5);
//   editHeader — edit an existing Draft document's header (#97/Q6), allowed only
//                while the document is unconverted (gated in the repository).
// Uncontrolled — read on submit — with empty fields sent as undefined so an edit
// only touches what was filled. Client Price is not a line field.

type Mode =
  | { type: "edit"; lineId: string }
  | { type: "addLine"; marketQuoteId: string; itemId: string }
  | { type: "editHeader"; marketQuoteId: string };

// Document-header text fields (editHeader only) and the line fields. Kept as plain
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
  // Both are fixed on the saved document and passed in (edit/addLine); editHeader's
  // live country select feeds the currency default, not the Landed Cost conditional.
  marketCountry,
  dealerCountry,
  // Whether to show the Justification field — true only when editing a flagged line
  // the analyst returned to its author for a Justification (ADR-0014). A brand-new
  // addLine has no USD yet so is never flagged, hence the default.
  showJustification = false,
  // The document's entry-time study-rate preview (#162, ADR-0041), resolved once
  // on the server (currency + Date Quote Received are fixed while entering lines).
  // Display only — the line stays Draft and pins nothing. Absent/null in editHeader
  // and for already-converted documents; then no preview renders.
  ratePreview,
  // The Researcher's live peer-spread nudge inputs (#163, ADR-0042): the peer
  // median USD-per-unit for THIS line's Benchmark Item (null ⇔ < 2 converted peers
  // → silent), the study QC Threshold (one knob, reused from the analyst flag), and
  // the OTHER lines on this document (for the within-document decimal-slip check).
  // All market-anchored — the Client Price is never sent to a researcher (ADR-0003).
  peerMedianUsdPerUnit = null,
  threshold = null,
  siblings = [],
}: {
  mode: Mode;
  initial?: Partial<Record<string, string>>;
  onDone: () => void;
  marketCountry?: string;
  dealerCountry?: string;
  showJustification?: boolean;
  ratePreview?: StudyRatePreview | null;
  peerMedianUsdPerUnit?: number | null;
  threshold?: number | null;
  siblings?: readonly { readonly price: string | null; readonly quantityQuoted: number | null }[];
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
  const showLandedCost = landedCostApplies(dealerCountry, marketCountry);

  // Live study-rate preview (#162). Price/quantity stay UNCONTROLLED (the money
  // input's comma focus/blur logic must not be disturbed); we mirror their raw
  // values into preview-only state on input and run the SAME conversion math the
  // submit pin uses. A `miss` warning is document-level, so it shows regardless of
  // price/quantity; a `hit`/`usd` number needs both present (qty > 0). USD converts
  // at rate 1 (its own case — never a table hit, ADR-0041).
  const [priceRaw, setPriceRaw] = useState(initial?.price ?? "");
  const [qtyRaw, setQtyRaw] = useState(initial?.quantityQuoted ?? "");
  const previewKind = ratePreview?.kind;
  const previewRate =
    ratePreview?.kind === "hit" ? Number(ratePreview.rate) : ratePreview?.kind === "usd" ? 1 : null;
  const priceNum = Number(parseMoneyInput(priceRaw));
  const qtyNum = Number(qtyRaw);
  const previewPerUnit =
    previewRate !== null && priceRaw.trim() !== "" && !Number.isNaN(priceNum) && qtyNum > 0
      ? convert(priceNum, qtyNum, previewRate).convertedUsdPricePerUnit
      : null;

  // The live entry-time nudges (#163, ADR-0042). Sibling USD-per-unit is derived
  // from the SAME shared document rate the live line uses (Q2: server ships the
  // peer median, the client computes siblings), so every figure on the document is
  // consistent with the preview the researcher sees. All three are advisory — they
  // never gate submit; the researcher may proceed regardless.
  const siblingUsdPerUnit = siblings.map((s) => {
    if (previewRate === null || s.price === null) return null;
    const p = Number(parseMoneyInput(s.price));
    const q = Number(s.quantityQuoted);
    return !Number.isNaN(p) && q > 0 ? convert(p, q, previewRate).convertedUsdPricePerUnit : null;
  });
  const spread = peerSpreadFlag({
    liveUsdPerUnit: previewPerUnit,
    peerMedianUsdPerUnit,
    threshold: threshold ?? 0,
  });
  const slip = decimalSlip({ liveUsdPerUnit: previewPerUnit, siblingUsdPerUnit });
  const quantityBad = qtyRaw.trim() !== "" && !quantityPlausible(qtyNum);

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
      if (mode.type === "addLine") {
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

  const showHeader = mode.type === "editHeader";
  const showLine = mode.type === "edit" || mode.type === "addLine";
  const submitLabel = pending
    ? "Saving…"
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
                // Mirror keystrokes into preview-only state — the input stays
                // uncontrolled so the comma focus/blur logic below is untouched (#162).
                onInput={(e) => setPriceRaw(e.currentTarget.value)}
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
              <input
                name="quantityQuoted"
                type="number"
                defaultValue={initial?.quantityQuoted ?? ""}
                onInput={(e) => setQtyRaw(e.currentTarget.value)}
                style={input}
              />
            </label>
          </div>
          {/* Live study-rate preview (#162, ADR-0041): the USD-per-unit that WILL pin
              at submit (same lookup), or the missing-rate warning. Display only. */}
          {ratePreview != null && (previewKind === "hit" || previewKind === "usd") && (
            <p style={{ fontSize: "0.85rem", color: "#0a6", margin: 0 }}>
              {previewPerUnit !== null ? (
                <>
                  ≈ {formatMoney(previewPerUnit, "USD")} USD/unit
                  {ratePreview.kind === "hit" && (
                    <span style={{ color: "#777" }}>
                      {" "}
                      — rate {ratePreview.rate} · {ratePreview.rateDate.toISOString().slice(0, 10)} ·{" "}
                      {ratePreview.ageDays} {ratePreview.ageDays === 1 ? "day" : "days"} old
                    </span>
                  )}
                </>
              ) : (
                <span style={{ color: "#777" }}>Live USD/unit shows once price and quantity are set.</span>
              )}
            </p>
          )}
          {ratePreview?.kind === "miss" && (
            <p style={{ fontSize: "0.85rem", color: "#b8860b", margin: 0 }}>
              ⚠ No saved rate for this currency/date — USD fills in later.
            </p>
          )}
          {/* Peer-spread nudge (#163, ADR-0042): a soft "sits outside the other
              dealers — sure?" anchored to the peer median, NEVER the Client Price.
              Silent below 2 converted peers or with no live USD. Non-blocking. */}
          {!spread.silent && spread.flagged && (
            <p style={{ fontSize: "0.85rem", color: "#8a6d00", margin: 0 }}>
              ⚠ This sits {spread.direction} than the other dealers (~{spread.percentDiff.toFixed(0)}%{" "}
              {spread.direction}) — sure?
            </p>
          )}
          {/* Decimal-slip mechanical check (#163): a within-document 10× sanity
              catch on USD-per-unit; fires even with no peers. Advisory. */}
          {!slip.silent && slip.flagged && (
            <p style={{ fontSize: "0.85rem", color: "#8a6d00", margin: 0 }}>
              ⚠ This is {slip.ratio >= 1 ? `${slip.ratio.toFixed(0)}×` : `1/${(1 / slip.ratio).toFixed(0)}`}{" "}
              your other lines on this document — check for a misplaced decimal.
            </p>
          )}
          {/* Quantity plausibility mechanical check (#163): advisory only — the
              required-field gate at document submit is the real validation. */}
          {quantityBad && (
            <p style={{ fontSize: "0.85rem", color: "#8a6d00", margin: 0 }}>
              ⚠ Quantity should be a positive number.
            </p>
          )}
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
