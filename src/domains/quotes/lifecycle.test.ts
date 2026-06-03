import { describe, it, expect } from "vitest";
import { transition, missingRequiredFields } from "./lifecycle";
import type { SubmittableQuote, QuoteState } from "./lifecycle";

// A Draft carrying every required-to-submit field (ADR-0011 / CONTEXT.md: Draft).
// Optional fields (dealerUrl, stockStatus, leadTime, warranty, discount, notes)
// are deliberately absent — they never gate submit.
const completeDraft: SubmittableQuote = {
  competitorBrand: "Caterpillar",
  dealerName: "Acme Equipment",
  dealerLocation: "Munich, Germany",
  price: 1250.5,
  currency: "EUR",
  quantityQuoted: 1,
  dateQuoteReceived: new Date("2026-06-01"),
};

describe("transition: Draft → Submitted", () => {
  it("submits a Draft that has every required field", () => {
    expect(transition("Draft", "submit", completeDraft)).toEqual({
      ok: true,
      state: "Submitted",
    });
  });

  it("blocks submit when a required field is absent, naming the missing field", () => {
    const noPrice = { ...completeDraft, price: null };
    expect(transition("Draft", "submit", noPrice)).toEqual({
      ok: false,
      reason: "missing-fields",
      missing: ["price"],
    });
  });

  it("treats a blank or whitespace-only string field as missing", () => {
    const blankDealer = { ...completeDraft, dealerName: "   " };
    expect(transition("Draft", "submit", blankDealer)).toEqual({
      ok: false,
      reason: "missing-fields",
      missing: ["dealerName"],
    });
  });

  it("rejects submit from an already-Submitted quote as an illegal transition", () => {
    // One-way submit (ADR: lifecycle): even a complete quote can't re-submit.
    expect(transition("Submitted", "submit", completeDraft)).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
  });

  it("rejects submit from the analyst-verdict states (no submit edge in v1)", () => {
    // Approved/Rejected exist in the type but have no legal submit edge yet (#11).
    const verdictStates: QuoteState[] = ["Approved", "Rejected"];
    for (const from of verdictStates) {
      expect(transition(from, "submit", completeDraft)).toEqual({
        ok: false,
        reason: "illegal-transition",
      });
    }
  });
});

describe("missingRequiredFields", () => {
  it("lists every required field, in order, for an empty Draft", () => {
    const empty: SubmittableQuote = {
      competitorBrand: null,
      dealerName: null,
      dealerLocation: null,
      price: null,
      currency: null,
      quantityQuoted: null,
      dateQuoteReceived: null,
    };
    expect(missingRequiredFields(empty)).toEqual([
      "competitorBrand",
      "dealerName",
      "dealerLocation",
      "price",
      "currency",
      "quantityQuoted",
      "dateQuoteReceived",
    ]);
  });

  it("returns nothing when every required field is present, regardless of optional fields", () => {
    expect(missingRequiredFields(completeDraft)).toEqual([]);
  });
});
