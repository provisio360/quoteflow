import { describe, expect, it } from "vitest";
import { renderNotificationEmail } from "./render";

// Pure mapping from a notification to its email subject/body. No Client Price or
// quote figures ever appear (ADR-0003) — a rejection carries only its reason, a
// release only the country + study name.

describe("renderNotificationEmail — quoteRejected", () => {
  it("subjects on the rejection and includes the reason", () => {
    const email = renderNotificationEmail({
      kind: "quoteRejected",
      reason: "Price higher than expected",
      country: null,
      studyName: "Q3 Excavators",
    });
    expect(email.subject).toBe("Your quote was rejected");
    expect(email.body).toContain("Price higher than expected");
    expect(email.body).toContain("Q3 Excavators");
  });
});

describe("renderNotificationEmail — countryReleased", () => {
  it("subjects on the released country and names the study", () => {
    const email = renderNotificationEmail({
      kind: "countryReleased",
      reason: null,
      country: "Germany",
      studyName: "Q3 Excavators",
    });
    expect(email.subject).toBe("Results released: Germany");
    expect(email.body).toContain("Germany");
    expect(email.body).toContain("Q3 Excavators");
  });
});
