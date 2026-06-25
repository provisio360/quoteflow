import type { MarketQuoteHeaderFields, QuoteLineFields } from "@/lib/quotes/repository";
import { parseMoneyInput } from "@/domains/quotes/format-money";

// Pure FormData → fields parsing for the Quote entry/edit form (QuoteEditor).
// Kept separate from the client component so it can be unit-tested without
// pulling in React or the server actions the component imports. Empty fields
// become `undefined` so an edit only touches what was actually filled.

export function str(fd: FormData, k: string): string | undefined {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? undefined : v;
}

export function lineFieldsFromForm(fd: FormData): QuoteLineFields {
  const num = (k: string) => {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? undefined : Number(v);
  };
  // A warranty value groups at rest like price (ADR-0034) but unit-agnostically;
  // strip the commas before the bare number is stored.
  const warrantyValue = (k: string) => {
    const v = parseMoneyInput(String(fd.get(k) ?? "").trim());
    return v === "" ? undefined : Number(v);
  };
  // The discount dropdowns are tri-state: blank (unanswered) → undefined, "true"
  // → true, "false" → false. Nested fields ride along only when their parent is
  // "Yes" (and so are only rendered then), so a No/blank parent posts no nested keys.
  const bool = (k: string) => {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? undefined : v === "true";
  };
  return {
    competitorBrand: str(fd, "competitorBrand"),
    competitorPartNumber: str(fd, "competitorPartNumber"),
    competitorPartDescription: str(fd, "competitorPartDescription"),
    stockStatus: str(fd, "stockStatus"),
    warranty1Value: warrantyValue("warranty1Value"),
    warranty1Unit: str(fd, "warranty1Unit"),
    warranty2Value: warrantyValue("warranty2Value"),
    warranty2Unit: str(fd, "warranty2Unit"),
    discountAvailable: bool("discountAvailable"),
    discountApplied: bool("discountApplied"),
    discountValue: num("discountValue"),
    discountType: str(fd, "discountType"),
    notes: str(fd, "notes"),
    justification: str(fd, "justification"),
    // The input groups at rest (ADR-0033 amendment); strip the thousands commas
    // before the bare number reaches storage/conversion.
    price: ((p) => (p === undefined ? undefined : parseMoneyInput(p)))(str(fd, "price")),
    quantityQuoted: num("quantityQuoted"),
  };
}

export function headerFieldsFromForm(fd: FormData): MarketQuoteHeaderFields {
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
