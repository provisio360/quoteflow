"use client";

import { useActionState, useState } from "react";
import { setStudyRateAction, type SetStudyRateOutcome } from "@/lib/exchange-rates/actions";
import { currencyForCountry } from "@/domains/exchange-rates/rates";
import { ISO_4217_CURRENCIES } from "@/domains/quotes/currencies";
import { ISO_3166_COUNTRY_NAMES } from "@/domains/benchmark-items/countries";

// The Study Exchange Rate entry form (#160, ADR-0041). Country-first: choosing a
// country autopopulates the currency (via the pure `currencyForCountry`); the
// currency select stays freely changeable so a currency no country produces can
// be added directly (ADR-0041 — the set a study needs is open-ended). The
// study's own market countries are grouped at the top as suggestions. `rate` is
// a text input, not a number one, so its exact decimal string reaches the server
// untouched by float coercion.

const field = { display: "block", marginTop: "1rem" } as const;
const control = { display: "block", marginTop: "0.25rem", padding: "0.35rem", minWidth: "18rem" } as const;

export function RatesForm({
  studyId,
  suggestedCountries,
}: {
  studyId: string;
  suggestedCountries: string[];
}) {
  const [outcome, formAction, pending] = useActionState<SetStudyRateOutcome | null, FormData>(
    setStudyRateAction,
    null,
  );
  const [currency, setCurrency] = useState("");

  function onCountryChange(country: string) {
    const derived = currencyForCountry(country);
    if (derived !== null) setCurrency(derived);
  }

  return (
    <>
      <form action={formAction} style={{ marginTop: "1.5rem" }}>
        <input type="hidden" name="studyId" value={studyId} />

        <label style={field}>
          Country (fills the currency)
          <select
            name="country"
            defaultValue=""
            style={control}
            onChange={(e) => onCountryChange(e.target.value)}
          >
            <option value="">— pick a country —</option>
            {suggestedCountries.length > 0 && (
              <optgroup label="This study's markets">
                {suggestedCountries.map((c) => (
                  <option key={`s-${c}`} value={c}>
                    {c}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="All countries">
              {ISO_3166_COUNTRY_NAMES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <label style={field}>
          Currency
          <select
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            style={control}
            required
          >
            <option value="">— pick a currency —</option>
            {ISO_4217_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>

        <label style={field}>
          Rate applies from
          <input type="date" name="rateDate" required style={control} />
        </label>

        <label style={field}>
          Rate (1 unit → USD)
          <input
            type="text"
            name="rate"
            inputMode="decimal"
            placeholder="e.g. 1.08"
            required
            style={control}
          />
        </label>

        <button type="submit" disabled={pending} style={{ marginTop: "1.25rem", padding: "0.5rem 1rem" }}>
          {pending ? "Saving…" : "Save rate"}
        </button>
      </form>

      {outcome?.ok === true && (
        <p role="status" style={{ color: "#0a0", marginTop: "1rem" }}>
          {outcome.changed
            ? `Saved ${outcome.currency} rate for ${outcome.rateDate}.`
            : `${outcome.currency} rate for ${outcome.rateDate} was already set to that value.`}
        </p>
      )}

      {outcome?.ok === false && (
        <p role="alert" style={{ color: "#b00", marginTop: "1rem" }}>
          {outcome.message}
        </p>
      )}
    </>
  );
}
