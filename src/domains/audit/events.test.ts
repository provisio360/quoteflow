import { describe, it, expect } from "vitest";
import {
  auditDocumentSubmit,
  auditQuoteLifecycle,
  auditManualRateOverride,
  auditActionLabel,
  type AuditAction,
} from "./events";

describe("audit subject/action mapping — Market Quote / Quote Line re-point (#92, ADR-0026)", () => {
  it("auditDocumentSubmit targets the Market Quote document, one per submit, no monetary delta", () => {
    expect(
      auditDocumentSubmit({
        actorId: "researcher-1",
        studyId: "study-1",
        marketQuoteId: "market-quote-1",
      }),
    ).toEqual({
      action: "submit",
      actorId: "researcher-1",
      studyId: "study-1",
      subjectType: "MarketQuote",
      subjectId: "market-quote-1",
      beforeValue: null,
      afterValue: null,
    });
  });

  it.each<"approve" | "reject">(["approve", "reject"])(
    "auditQuoteLifecycle(%s) targets the Quote Line, no monetary delta",
    (action) => {
      expect(
        auditQuoteLifecycle(action, {
          actorId: "analyst-1",
          studyId: "study-1",
          lineId: "quote-line-1",
        }),
      ).toEqual({
        action,
        actorId: "analyst-1",
        studyId: "study-1",
        subjectType: "QuoteLine",
        subjectId: "quote-line-1",
        beforeValue: null,
        afterValue: null,
      });
    },
  );
});

describe("auditManualRateOverride", () => {
  it("records a Market Quote-subject manual override carrying the new USD total as after", () => {
    expect(
      auditManualRateOverride({
        actorId: "analyst-1",
        studyId: "study-1",
        marketQuoteId: "market-quote-1",
        after: 1375.55,
      }),
    ).toEqual({
      action: "manualRateOverride",
      actorId: "analyst-1",
      studyId: "study-1",
      subjectType: "MarketQuote",
      subjectId: "market-quote-1",
      beforeValue: null,
      afterValue: 1375.55,
    });
  });
});

describe("auditActionLabel — human display vocabulary (issue #72)", () => {
  it.each<[AuditAction, string]>([
    ["submit", "Submitted"],
    ["approve", "Approved"],
    ["reject", "Rejected"],
    ["release", "Released"],
    ["reopen", "Reopened"],
    ["import", "Imported"],
    ["clientPriceChange", "Client Price changed"],
    ["manualRateOverride", "Manual rate override"],
    ["assign", "Assigned"],
  ])("labels %s as %s", (action, label) => {
    expect(auditActionLabel(action)).toBe(label);
  });
});
