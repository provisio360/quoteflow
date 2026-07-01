// Pure decision core for the Study Exchange Rate table (#160, ADR-0041) — no
// framework, DB, or network imports. Validates a set/edit request for one
// (currency, rateDate, rate) row before the persistence layer upserts it.
//
// The rate is carried as a validated decimal STRING, never a JS number: a
// Decimal(18,8) with ten integer digits exceeds float-safe precision and a
// number cannot reliably evidence its scale (grilling Q6). The persistence
// layer hands the normalised string straight to Prisma's Decimal column.

import { isValidCurrency, defaultCurrencyForCountry } from "../quotes/currencies";
import { canonicalCountry } from "../benchmark-items/countries";

/** A raw set-rate request as it arrives from the entry form. */
export interface RateSetInput {
  readonly currency: string;
  readonly rateDate: string;
  readonly rate: string;
}

/** The normalised, persist-ready row values. */
export interface RateSetValue {
  readonly currency: string;
  readonly rateDate: string;
  readonly rate: string;
}

export type RateValidationError =
  | "usd-not-allowed"
  | "invalid-currency"
  | "invalid-date"
  | "invalid-rate";

export type RateValidationResult =
  | { readonly ok: true; readonly value: RateSetValue }
  | { readonly ok: false; readonly error: RateValidationError };

/**
 * Validate a set/edit request for one Study Exchange Rate row. USD is refused
 * (it converts 1:1, needs no row — grilling Q4); the rate must be a positive
 * decimal that fits Decimal(18,8); the date must be a well-formed calendar date
 * (no window bounds here — that is the later lookup slice, grilling Q5).
 */
export function validateRateInput(input: RateSetInput): RateValidationResult {
  const currency = input.currency.trim().toUpperCase();
  if (currency === "USD") return { ok: false, error: "usd-not-allowed" };
  if (!isValidCurrency(currency)) return { ok: false, error: "invalid-currency" };

  const rateDate = normaliseDate(input.rateDate);
  if (rateDate === null) return { ok: false, error: "invalid-date" };

  const rate = normaliseRate(input.rate);
  if (rate === null) return { ok: false, error: "invalid-rate" };

  return { ok: true, value: { currency, rateDate, rate } };
}

/**
 * Validate a rateDate as a real ISO-8601 calendar day (YYYY-MM-DD) and return it
 * unchanged, or null. Rejects the right shape but impossible days (2026-02-30)
 * by round-tripping through UTC. No window bounds — the lookup slice owns those
 * (grilling Q5).
 */
function normaliseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Reject rolled-over dates (JS coerces 2026-02-30 → 2026-03-02).
  if (parsed.toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed;
}

/** Human, form-ready text for each refusal reason (grilling Q4: USD is refused
 *  with an explicit message, never a silent skip). Lives with the domain so the
 *  wording stays beside the closed error set it mirrors. */
export function rateValidationMessage(error: RateValidationError): string {
  switch (error) {
    case "usd-not-allowed":
      return "USD needs no rate — it converts 1:1.";
    case "invalid-currency":
      return "Pick a valid ISO 4217 currency.";
    case "invalid-date":
      return "Enter a valid date.";
    case "invalid-rate":
      return "Enter a positive rate with up to 10 whole and 8 decimal digits.";
  }
}

/**
 * The local currency to autopopulate when the user picks a country in the
 * country-first entry UX (ADR-0041). Any ISO country is allowed — the study's
 * market countries are merely pre-suggested — so this maps any canonical country
 * to its default currency, or null for input that is not a country. USD-country
 * picks still return "USD"; validateRateInput refuses that at save.
 */
export function currencyForCountry(country: string): string | null {
  const canonical = canonicalCountry(country);
  return canonical === null ? null : defaultCurrencyForCountry(canonical);
}

/**
 * Validate a raw rate string and return it normalised (whitespace and a leading
 * `+` stripped), or null if it is not a positive decimal fitting Decimal(18,8):
 * up to ten integer digits and up to eight fractional digits. Kept string-exact
 * so no float rounding touches the stored value (grilling Q6).
 */
function normaliseRate(raw: string): string | null {
  const trimmed = raw.trim().replace(/^\+/, "");
  const match = /^(\d{1,10})(?:\.(\d{1,8}))?$/.exec(trimmed);
  if (match === null) return null;
  // Positive only — reject an all-zero value (0, 0.0, 0.00000000).
  if (Number(trimmed) === 0) return null;
  return trimmed;
}
