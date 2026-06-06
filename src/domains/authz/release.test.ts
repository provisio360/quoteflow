import { describe, it, expect } from "vitest";
import { canReleaseCountry } from "./release";
import type { InternalPrincipal, InternalRole } from "./principal";

// Release / reopen of a Country is an Analyst act (PRD #25/#27), not tenant-scoped
// — mirroring canReviewQuote. The EM runs the study but does not release it.

const internal = (role: InternalRole): InternalPrincipal => ({
  kind: "internal",
  userId: "u1",
  role,
});

describe("canReleaseCountry", () => {
  it("allows an Analyst", () => {
    expect(canReleaseCountry(internal("Analyst"))).toBe(true);
  });

  it("denies other internal roles", () => {
    expect(canReleaseCountry(internal("EngagementManager"))).toBe(false);
    expect(canReleaseCountry(internal("Researcher"))).toBe(false);
    expect(canReleaseCountry(internal("Admin"))).toBe(false);
  });

  it("denies a client user", () => {
    expect(
      canReleaseCountry({ kind: "client", userId: "c1", tenantId: "t1" }),
    ).toBe(false);
  });
});
