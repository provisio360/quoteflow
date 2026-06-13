import { describe, it, expect } from "vitest";
import { auditManualRateOverride, auditActionLabel, type AuditAction } from "./events";

describe("auditManualRateOverride", () => {
  it("records a Quote-subject manual override carrying the new USD total as after", () => {
    expect(
      auditManualRateOverride({
        actorId: "analyst-1",
        studyId: "study-1",
        quoteId: "quote-1",
        after: 1375.55,
      }),
    ).toEqual({
      action: "manualRateOverride",
      actorId: "analyst-1",
      studyId: "study-1",
      subjectType: "Quote",
      subjectId: "quote-1",
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
