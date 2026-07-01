import { describe, it, expect } from "vitest";
import { canManageStudyRates } from "./exchange-rates";
import type { InternalPrincipal, ClientPrincipal } from "./principal";

const internal = (role: InternalPrincipal["role"]): InternalPrincipal => ({
  kind: "internal",
  userId: "staff",
  role,
});

const clientUser: ClientPrincipal = { kind: "client", userId: "cu", tenantId: "t1" };

describe("canManageStudyRates — Study Exchange Rate read+write gate (#160, ADR-0041)", () => {
  it("allows Engagement Managers and Analysts (the study-setup pair)", () => {
    expect(canManageStudyRates(internal("EngagementManager"))).toBe(true);
    expect(canManageStudyRates(internal("Analyst"))).toBe(true);
  });

  it("forbids Researchers — read-only, reach rates only via later conversion", () => {
    expect(canManageStudyRates(internal("Researcher"))).toBe(false);
  });

  it("forbids the Admin (user-administration only)", () => {
    expect(canManageStudyRates(internal("Admin"))).toBe(false);
  });

  it("forbids a Client User", () => {
    expect(canManageStudyRates(clientUser)).toBe(false);
  });
});
