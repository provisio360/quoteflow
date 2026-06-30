"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { seedMarketQuoteAction } from "@/lib/quotes/actions";
import { headerFieldsFromForm } from "@/domains/quotes/quote-line-form";
import { ISO_3166_COUNTRY_NAMES } from "@/domains/benchmark-items/countries";
import {
  currencyOptions,
  defaultCurrencyOnCountryChange,
} from "@/domains/quotes/quote-currency-picker";
import { landedCostApplies } from "@/domains/quotes/landed-cost";
import {
  batchStampFields,
  emptyBatchGroupValues,
  type BatchGroupValues,
} from "@/domains/quotes/batch-line-fill";
import { BatchGroupFields } from "./BatchGroupFields";
import type { QuoteGroup, QuoteGroupPart } from "@/domains/benchmark-items/researcher-view";

// The Collect surface (ADR-0038, #140): the dealer-first researcher entry path —
// Country → Quote Group → part-picker → seed a NEW Market Quote. A Quote Group is a
// non-persisted ordinal lens; selecting parts and starting seeds one document with a
// blank Draft line per part, which the researcher then fills in the Drafts panel
// below. The lens adds NO gates — groups are independently startable in any order.
// Each part shows layered progress (approved n/N + the researcher's own in-flight
// tally) and the picker pre-checks only parts still short on approved (#142).

const input = { padding: "0.3rem 0.4rem", width: "100%", boxSizing: "border-box" } as const;

export type CollectCountry = { readonly country: string; readonly groups: readonly QuoteGroup[] };

export function CollectPanel({
  studyId,
  countries,
}: {
  studyId: string;
  countries: readonly CollectCountry[];
}) {
  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 style={{ fontSize: "1.1rem" }}>Collect</h2>
      {countries.length === 0 ? (
        <p style={{ color: "#777" }}>No Quote Groups yet — no parts to collect in your countries.</p>
      ) : (
        countries.map((c) => (
          <div key={c.country} style={{ marginTop: "1rem" }}>
            <h3 style={{ fontSize: "1rem", margin: "0 0 0.25rem" }}>{c.country}</h3>
            {c.groups.length === 0 ? (
              <p style={{ color: "#777", margin: 0 }}>No Quote Groups in this Country.</p>
            ) : (
              c.groups.map((g) => (
                <GroupBlock key={g.groupNumber} studyId={studyId} country={c.country} group={g} />
              ))
            )}
          </div>
        ))
      )}
    </section>
  );
}

/** One Quote Group slot: its position-membership parts shown with layered progress
 *  and pre-checked only when still short on approved (#142), the off-slot "other
 *  parts" escape hatch collapsed and unchecked, and a dealer-info form that seeds a
 *  new document from whatever is checked. */
function GroupBlock({
  studyId,
  country,
  group,
}: {
  studyId: string;
  country: string;
  group: QuoteGroup;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Selection: progress-aware pre-check (#142, replacing #140's dumb pre-check) —
  // a part is checked by default only when still short on its APPROVED count
  // (`preChecked`, keyed on the all-author Release-Eligibility figure alone, ADR-0038).
  // Satisfied members and off-slot parts start unchecked but stay selectable. Both
  // populations merge into one selection set the seed receives.
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        [...group.members, ...group.otherParts].filter((p) => p.preChecked).map((p) => p.id),
      ),
  );
  const [currency, setCurrency] = useState("");
  // Dealer country is controlled so the batch step's Landed Cost group can show/hide
  // reactively (cross-border ⇒ shown), mirroring the single-line entry form (ADR-0035).
  const [sourceCountry, setSourceCountry] = useState("");
  // The five Batch Line-Fill groups in transient UI state — stamped onto each line at
  // creation (ADR-0038, #141). Nothing batch-level is persisted.
  const [batch, setBatch] = useState<BatchGroupValues>(emptyBatchGroupValues);

  // The market Country is `country` (the group's Country); the dealer Country is the
  // live header select. Cross-border ⇒ Landed Cost applies, doc-uniform.
  const showLandedCost = landedCostApplies(sourceCountry, country);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Select-all is scoped to the always-visible MEMBERS only — never the collapsed
  // off-slot otherParts, which stay a hand-picked escape hatch (a select-all that
  // swept in unseen parts would silently seed them). So the toggle adds/removes only
  // member ids and leaves any checked otherParts untouched.
  const allMembersSelected =
    group.members.length > 0 && group.members.every((m) => checked.has(m.id));
  function toggleAllMembers() {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const m of group.members) {
        if (allMembersSelected) next.delete(m.id);
        else next.add(m.id);
      }
      return next;
    });
  }

  function onDealerCountryChange(next: string) {
    setSourceCountry(next);
    const applied = defaultCurrencyOnCountryChange(next);
    if (applied !== null) setCurrency(applied);
  }

  function handleStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const itemIds = [...checked];
    if (itemIds.length === 0) {
      setMessage("Select at least one part to start a quote.");
      return;
    }
    const fd = new FormData(event.currentTarget);
    setMessage(null);
    // Merge the five batch groups into one document-uniform stamp; Landed Cost rides
    // along only when cross-border (excluded otherwise, exactly as the field unmounts).
    const fields = batchStampFields(batch, showLandedCost);
    startTransition(async () => {
      const result = await seedMarketQuoteAction(studyId, country, headerFieldsFromForm(fd), itemIds, fields);
      if (!result.ok) {
        setMessage(result.message ?? "Couldn't start the quote.");
        return;
      }
      router.refresh();
      setStarting(false);
    });
  }

  const checkbox = (part: QuoteGroupPart) => {
    // Satisfied = approved count has reached Required Quotes (the canonical
    // Release-Eligibility "done", ADR-0038). Dimmed and unchecked, but still
    // selectable — a dealer may still price an already-satisfied part (#142).
    const satisfied = part.approvedCount >= part.requiredQuotes;
    return (
      <label
        key={part.id}
        style={{ display: "block", fontSize: "0.9rem", color: satisfied ? "#999" : undefined }}
      >
        <input
          type="checkbox"
          checked={checked.has(part.id)}
          onChange={() => toggle(part.id)}
          style={{ marginRight: "0.4rem" }}
        />
        {part.clientItemNumber} {part.itemDescription}{" "}
        <span style={{ color: "#777", fontSize: "0.8rem" }}>
          ({part.approvedCount}/{part.requiredQuotes} approved
          {part.myInFlightCount > 0 ? `, ${part.myInFlightCount} of mine in review` : ""})
        </span>
      </label>
    );
  };

  return (
    <div style={{ margin: "0.75rem 0", padding: "0.6rem", border: "1px solid #ddd" }}>
      <h4 style={{ fontSize: "0.95rem", margin: "0 0 0.4rem" }}>Quote Group {group.groupNumber}</h4>

      {group.members.length > 0 && (
        <label style={{ display: "block", fontSize: "0.9rem", fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={allMembersSelected}
            onChange={toggleAllMembers}
            style={{ marginRight: "0.4rem" }}
          />
          {allMembersSelected ? "Clear all" : "Select all"}
        </label>
      )}

      {group.members.map(checkbox)}

      {group.otherParts.length > 0 && (
        <details style={{ marginTop: "0.4rem" }}>
          <summary style={{ fontSize: "0.85rem", color: "#555", cursor: "pointer" }}>
            Other parts in this Country ({group.otherParts.length})
          </summary>
          <div style={{ marginTop: "0.3rem" }}>{group.otherParts.map(checkbox)}</div>
        </details>
      )}

      {!starting ? (
        <button type="button" onClick={() => setStarting(true)} style={{ marginTop: "0.5rem" }}>
          Start quote →
        </button>
      ) : (
        <form onSubmit={handleStart} style={{ display: "grid", gap: "0.4rem", marginTop: "0.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
            <label style={{ fontSize: "0.85rem" }}>
              Dealer / source name *
              <input name="sourceName" style={input} />
            </label>
            <label style={{ fontSize: "0.85rem" }}>
              Dealer locality *
              <input name="sourceLocality" style={input} />
            </label>
            <label style={{ fontSize: "0.85rem" }}>
              Dealer URL
              <input name="sourceUrl" style={input} />
            </label>
            <label style={{ fontSize: "0.85rem" }}>
              Dealer country *
              <select
                name="sourceCountry"
                value={sourceCountry}
                onChange={(e) => onDealerCountryChange(e.target.value)}
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
              <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} style={input}>
                <option value="">— select currency —</option>
                {currencyOptions(undefined).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: "0.85rem" }}>
              Date received *
              <input name="dateQuoteReceived" type="date" style={input} />
            </label>
          </div>
          <details style={{ fontSize: "0.85rem" }}>
            <summary style={{ cursor: "pointer", color: "#555" }}>
              Set for all parts (optional)
            </summary>
            <div style={{ marginTop: "0.4rem" }}>
              <BatchGroupFields values={batch} onChange={setBatch} showLandedCost={showLandedCost} />
            </div>
          </details>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" disabled={pending}>
              {pending ? "Starting…" : `Start quote (${checked.size} part${checked.size === 1 ? "" : "s"})`}
            </button>
            <button type="button" onClick={() => setStarting(false)} disabled={pending}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {message !== null && <p style={{ color: "#b00", fontSize: "0.85rem", margin: "0.3rem 0 0" }}>{message}</p>}
    </div>
  );
}
