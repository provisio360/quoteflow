import { describe, it, expect } from "vitest";
import { auditManualRateOverride } from "./events";

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
