import { describe, it, expect } from "vitest";
import { transition, missingRequiredFields } from "./lifecycle";
import type { SubmittableQuote, QuoteState, QuoteEvent } from "./lifecycle";

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
    expect(transition("Draft", { kind: "submit", quote: completeDraft })).toEqual({
      ok: true,
      state: "Submitted",
    });
  });

  it("blocks submit when a required field is absent, naming the missing field", () => {
    const noPrice = { ...completeDraft, price: null };
    expect(transition("Draft", { kind: "submit", quote: noPrice })).toEqual({
      ok: false,
      reason: "missing-fields",
      missing: ["price"],
    });
  });

  it("treats a blank or whitespace-only string field as missing", () => {
    const blankDealer = { ...completeDraft, dealerName: "   " };
    expect(transition("Draft", { kind: "submit", quote: blankDealer })).toEqual({
      ok: false,
      reason: "missing-fields",
      missing: ["dealerName"],
    });
  });

  it("rejects submit from an already-Submitted quote as an illegal transition", () => {
    // One-way submit (ADR: lifecycle): even a complete quote can't re-submit.
    expect(transition("Submitted", { kind: "submit", quote: completeDraft })).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
  });

  it("rejects submit from the analyst-verdict states (no submit edge from there)", () => {
    // A Submitted quote re-enters Draft via `revise`, not `submit`.
    const verdictStates: QuoteState[] = ["Approved", "Rejected"];
    for (const from of verdictStates) {
      expect(transition(from, { kind: "submit", quote: completeDraft })).toEqual({
        ok: false,
        reason: "illegal-transition",
      });
    }
  });
});

describe("transition: approve (Submitted → Approved)", () => {
  const approve = (over: Partial<Extract<QuoteEvent, { kind: "approve" }>> = {}) =>
    ({ kind: "approve", conversionStatus: "auto", flagged: false, hasJustification: false, ...over }) as const;

  it("approves a converted, unflagged Submitted quote", () => {
    expect(transition("Submitted", approve())).toEqual({ ok: true, state: "Approved" });
  });

  it("approves a converted quote regardless of conversion provenance (manual)", () => {
    expect(transition("Submitted", approve({ conversionStatus: "manual" }))).toEqual({
      ok: true,
      state: "Approved",
    });
  });

  it("blocks approval while conversion is pending (ADR-0013)", () => {
    expect(transition("Submitted", approve({ conversionStatus: "pending" }))).toEqual({
      ok: false,
      reason: "conversion-pending",
    });
  });

  it("blocks approval of a flagged quote that has no justification (ADR-0014)", () => {
    expect(
      transition("Submitted", approve({ flagged: true, hasJustification: false })),
    ).toEqual({ ok: false, reason: "needs-justification" });
  });

  it("approves a flagged quote once the author has justified it", () => {
    expect(
      transition("Submitted", approve({ flagged: true, hasJustification: true })),
    ).toEqual({ ok: true, state: "Approved" });
  });

  it("rejects approve from any non-Submitted state as illegal", () => {
    for (const from of ["Draft", "Approved", "Rejected"] as QuoteState[]) {
      expect(transition(from, approve())).toEqual({ ok: false, reason: "illegal-transition" });
    }
  });
});

describe("transition: reject (Submitted → Rejected)", () => {
  it("rejects a Submitted quote with a reason", () => {
    expect(transition("Submitted", { kind: "reject", reason: "Dealer location missing" })).toEqual({
      ok: true,
      state: "Rejected",
    });
  });

  it("blocks rejection with no reason", () => {
    expect(transition("Submitted", { kind: "reject", reason: null })).toEqual({
      ok: false,
      reason: "missing-reason",
    });
  });

  it("blocks rejection with a blank/whitespace reason", () => {
    expect(transition("Submitted", { kind: "reject", reason: "   " })).toEqual({
      ok: false,
      reason: "missing-reason",
    });
  });

  it("rejects reject from any non-Submitted state as illegal", () => {
    for (const from of ["Draft", "Approved", "Rejected"] as QuoteState[]) {
      expect(transition(from, { kind: "reject", reason: "x" })).toEqual({
        ok: false,
        reason: "illegal-transition",
      });
    }
  });
});

describe("transition: revise (Rejected → Draft)", () => {
  it("returns a Rejected quote to Draft", () => {
    expect(transition("Rejected", { kind: "revise" })).toEqual({ ok: true, state: "Draft" });
  });

  it("rejects revise from any non-Rejected state as illegal", () => {
    for (const from of ["Draft", "Submitted", "Approved"] as QuoteState[]) {
      expect(transition(from, { kind: "revise" })).toEqual({
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
