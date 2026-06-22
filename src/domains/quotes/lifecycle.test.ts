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
  sourceLocation: "Munich, Germany",
  currency: "EUR",
  dateQuoteReceived: new Date("2026-06-01"),
};

const draftLine = (lineId: string, over: Partial<SubmittableLine> = {}): SubmittableLine => ({
  lineId,
  state: "Draft",
  competitorBrand: "Bosch",
  price: 1250.5,
  quantityQuoted: 2,
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
