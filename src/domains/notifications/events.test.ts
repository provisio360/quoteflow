import { describe, expect, it } from "vitest";
import { notifyQuoteRejected, notifyCountryReleased } from "./events";

// Pure shape of the two v1 push events (ADR-0020). Recipient resolution and
// persistence live in src/lib/notifications; here we only prove each builder
// stamps the right kind/subject and snapshots the ephemeral display text.

describe("notifyQuoteRejected", () => {
  it("targets the recipient with a Quote subject and snapshots the reason", () => {
    const input = notifyQuoteRejected({
      recipientId: "author-1",
      studyId: "study-1",
      quoteId: "quote-1",
      reason: "Price higher than expected",
    });

    expect(input).toEqual({
      recipientId: "author-1",
      kind: "quoteRejected",
      studyId: "study-1",
      subjectType: "Quote",
      subjectId: "quote-1",
      reason: "Price higher than expected",
      country: null,
    });
  });
});

describe("notifyCountryReleased", () => {
  it("targets the recipient with a CountryRelease subject and snapshots the country", () => {
    const input = notifyCountryReleased({
      recipientId: "client-user-1",
      studyId: "study-1",
      countryReleaseId: "release-1",
      country: "Germany",
    });

    expect(input).toEqual({
      recipientId: "client-user-1",
      kind: "countryReleased",
      studyId: "study-1",
      subjectType: "CountryRelease",
      subjectId: "release-1",
      reason: null,
      country: "Germany",
    });
  });
});
