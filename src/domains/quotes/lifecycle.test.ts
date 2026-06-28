import { describe, it, expect } from "vitest";
import { transition, submitDocument } from "./lifecycle";
import type {
  QuoteState,
  QuoteEvent,
  DocumentHeader,
  SubmittableLine,
} from "./lifecycle";

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

// The shared document facts (one Source, one date, one currency) that every line
// inherits at submit (CONTEXT.md: Market Quote).
const completeHeader: DocumentHeader = {
  sourceName: "Acme Equipment",
  sourceLocality: "Munich",
  sourceCountry: "Germany",
  currency: "EUR",
  dateQuoteReceived: new Date("2026-06-01"),
};

const draftLine = (lineId: string, over: Partial<SubmittableLine> = {}): SubmittableLine => ({
  lineId,
  state: "Draft",
  competitorBrand: "Bosch",
  price: 1250.5,
  quantityQuoted: 2,
  // Default the Warranty Offered? gate to Yes (ADR-0037) so the warranty pairs are
  // coherence-checked exactly as before; the offered-gate cases drive it explicitly.
  warrantyOffered: true,
  warranty1Value: null,
  warranty1Unit: null,
  warranty2Value: null,
  warranty2Unit: null,
  leadTimeValue: null,
  leadTimeUnit: null,
  landedCostIncluded: null,
  ...over,
});

describe("submitDocument (bulk submit guard)", () => {
  it("submits every Draft line when the header and all lines are complete", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1"), draftLine("l2")],
    });
    expect(result).toEqual({ ok: true, toSubmit: ["l1", "l2"] });
  });

  it("is all-or-nothing: one incomplete line blocks the whole submit", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1"), draftLine("l2", { price: null })],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l2", missing: ["price"] }],
    });
  });

  it("reports a missing document field against every Draft line", () => {
    // One missing shared fact (currency) fails all lines at once.
    const result = submitDocument({
      header: { ...completeHeader, currency: "  " },
      lines: [draftLine("l1"), draftLine("l2")],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [
        { lineId: "l1", missing: ["currency"] },
        { lineId: "l2", missing: ["currency"] },
      ],
    });
  });

  it("reports a missing Dealer Country against every Draft line", () => {
    const result = submitDocument({
      header: { ...completeHeader, sourceCountry: null },
      lines: [draftLine("l1"), draftLine("l2")],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [
        { lineId: "l1", missing: ["sourceCountry"] },
        { lineId: "l2", missing: ["sourceCountry"] },
      ],
    });
  });

  it("reports a missing dealer locality against every Draft line", () => {
    const result = submitDocument({
      header: { ...completeHeader, sourceLocality: "  " },
      lines: [draftLine("l1")],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l1", missing: ["sourceLocality"] }],
    });
  });

  it("only targets Draft lines, leaving non-Draft siblings untouched", () => {
    // A revised document: one Draft line among already-actioned siblings.
    const result = submitDocument({
      header: completeHeader,
      lines: [
        draftLine("approved", { state: "Approved" }),
        draftLine("rejected", { state: "Rejected" }),
        draftLine("l3"),
      ],
    });
    expect(result).toEqual({ ok: true, toSubmit: ["l3"] });
  });

  it("rejects a document with no Draft lines rather than silently no-op", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("a", { state: "Submitted" })],
    });
    expect(result).toEqual({ ok: false, reason: "no-draft-lines" });
  });
});

describe("submitDocument: warranty pair-completeness (ADR-0034)", () => {
  it("submits a line with no warranty at all — warranty never gates on presence", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1")],
    });
    expect(result).toEqual({ ok: true, toSubmit: ["l1"] });
  });

  it("submits a line whose warranty pair is fully filled (3 year)", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1", { warranty1Value: 3, warranty1Unit: "year" })],
    });
    expect(result).toEqual({ ok: true, toSubmit: ["l1"] });
  });

  it("blocks a warranty value with no unit, reporting the missing unit half", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1", { warranty1Value: 3, warranty1Unit: null })],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l1", missing: ["warranty1Unit"] }],
    });
  });

  it("blocks a warranty unit with no value, reporting the missing value half", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1", { warranty1Value: null, warranty1Unit: "year" })],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l1", missing: ["warranty1Value"] }],
    });
  });

  it("treats a blank/whitespace unit as absent", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1", { warranty1Value: 3, warranty1Unit: "  " })],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l1", missing: ["warranty1Unit"] }],
    });
  });

  it("checks the second warranty pair independently of the first", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [
        draftLine("l1", {
          warranty1Value: 3,
          warranty1Unit: "year",
          warranty2Value: 4000,
          warranty2Unit: null,
        }),
      ],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l1", missing: ["warranty2Unit"] }],
    });
  });

  it("reports a half warranty pair alongside other missing required fields", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1", { price: null, warranty1Value: null, warranty1Unit: "year" })],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l1", missing: ["price", "warranty1Value"] }],
    });
  });
});

describe("submitDocument: Warranty Offered? gate (ADR-0037)", () => {
  it("blocks a line whose Warranty Offered? is unanswered (null)", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1", { warrantyOffered: null })],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l1", missing: ["warrantyOffered"] }],
    });
  });

  it("submits a line answered No, even if stale warranty pairs linger", () => {
    // Offered = No short-circuits the pair coherence check — a residual half pair
    // that would otherwise block is treated as absent (the save path nulls it).
    const result = submitDocument({
      header: completeHeader,
      lines: [
        draftLine("l1", { warrantyOffered: false, warranty1Value: 3, warranty1Unit: null }),
      ],
    });
    expect(result).toEqual({ ok: true, toSubmit: ["l1"] });
  });

  it("submits a line answered Yes with both pairs empty — Yes does not force a value", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1", { warrantyOffered: true })],
    });
    expect(result).toEqual({ ok: true, toSubmit: ["l1"] });
  });

  it("still checks pair coherence under Yes (a half pair blocks)", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1", { warrantyOffered: true, warranty1Value: 3, warranty1Unit: null })],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l1", missing: ["warranty1Unit"] }],
    });
  });

  it("reports an unanswered Offered alongside other missing required fields", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1", { price: null, warrantyOffered: null })],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l1", missing: ["price", "warrantyOffered"] }],
    });
  });
});

describe("submitDocument: shipping lead time pair-completeness (ADR-0035)", () => {
  it("submits a line with no lead time at all — it never gates on presence", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1")],
    });
    expect(result).toEqual({ ok: true, toSubmit: ["l1"] });
  });

  it("submits a line whose lead time pair is fully filled (3 weeks)", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1", { leadTimeValue: 3, leadTimeUnit: "weeks" })],
    });
    expect(result).toEqual({ ok: true, toSubmit: ["l1"] });
  });

  it("blocks a lead time value with no unit, reporting the missing unit half", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1", { leadTimeValue: 3, leadTimeUnit: null })],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l1", missing: ["leadTimeUnit"] }],
    });
  });

  it("blocks a lead time unit with no value, reporting the missing value half", () => {
    const result = submitDocument({
      header: completeHeader,
      lines: [draftLine("l1", { leadTimeValue: null, leadTimeUnit: "weeks" })],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l1", missing: ["leadTimeValue"] }],
    });
  });
});

describe("submitDocument: landed cost cross-border requirement (ADR-0035)", () => {
  // completeHeader's Dealer Country is Germany; the market Country drives whether
  // landed cost is asked. A cross-border document (dealer != market) must answer
  // Included? on every line; a domestic one (dealer == market) never asks.
  it("blocks a cross-border line whose Included? is unanswered", () => {
    const result = submitDocument({
      header: completeHeader,
      marketCountry: "France",
      lines: [draftLine("l1", { landedCostIncluded: null })],
    });
    expect(result).toEqual({
      ok: false,
      reason: "lines-incomplete",
      perLine: [{ lineId: "l1", missing: ["landedCostIncluded"] }],
    });
  });

  it("submits a cross-border line answered Yes", () => {
    const result = submitDocument({
      header: completeHeader,
      marketCountry: "France",
      lines: [draftLine("l1", { landedCostIncluded: true })],
    });
    expect(result).toEqual({ ok: true, toSubmit: ["l1"] });
  });

  it("submits a cross-border line answered No", () => {
    const result = submitDocument({
      header: completeHeader,
      marketCountry: "France",
      lines: [draftLine("l1", { landedCostIncluded: false })],
    });
    expect(result).toEqual({ ok: true, toSubmit: ["l1"] });
  });

  it("never asks on a domestic document (Dealer Country == market Country)", () => {
    const result = submitDocument({
      header: completeHeader,
      marketCountry: "Germany",
      lines: [draftLine("l1", { landedCostIncluded: null })],
    });
    expect(result).toEqual({ ok: true, toSubmit: ["l1"] });
  });
});
