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
import type { QuoteGroup, QuoteGroupPart } from "@/domains/benchmark-items/researcher-view";

// The Collect surface (ADR-0038, #140): the dealer-first researcher entry path —
// Country → Quote Group → part-picker → seed a NEW Market Quote. A Quote Group is a
// non-persisted ordinal lens; selecting parts and starting seeds one document with a
// blank Draft line per part (the batch stamp-on-create is a later slice), which the
// researcher then fills in the Drafts panel below. The lens adds NO gates — groups
// are independently startable in any order. This tracer uses a DUMB pre-check (every
// position-membership part checked); progress-aware pre-check + n/N counts come later.

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

/** One Quote Group slot: its position-membership parts pre-checked (dumb pre-check),
 *  the off-slot "other parts" escape hatch collapsed and unchecked, and a dealer-info
 *  form that seeds a new document from whatever is checked. */
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

  // Selection: members start checked (dumb pre-check), other parts start unchecked.
  // Both populations merge into one selection set the seed receives (#140).
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(group.members.map((m) => m.id)),
  );
  const [currency, setCurrency] = useState("");

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onDealerCountryChange(next: string) {
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
    startTransition(async () => {
      const result = await seedMarketQuoteAction(studyId, country, headerFieldsFromForm(fd), itemIds);
      if (!result.ok) {
        setMessage(result.message ?? "Couldn't start the quote.");
        return;
      }
      router.refresh();
      setStarting(false);
    });
  }

  const checkbox = (part: QuoteGroupPart) => (
    <label key={part.id} style={{ display: "block", fontSize: "0.9rem" }}>
      <input
        type="checkbox"
        checked={checked.has(part.id)}
        onChange={() => toggle(part.id)}
        style={{ marginRight: "0.4rem" }}
      />
      {part.clientItemNumber} {part.itemDescription}
    </label>
  );

  return (
    <div style={{ margin: "0.75rem 0", padding: "0.6rem", border: "1px solid #ddd" }}>
      <h4 style={{ fontSize: "0.95rem", margin: "0 0 0.4rem" }}>Quote Group {group.groupNumber}</h4>

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
                defaultValue=""
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
