import { describe, it, expect } from "vitest";
import { canCreateStudy } from "./studies";
import type { InternalPrincipal, ClientPrincipal } from "./principal";

const internal = (role: InternalPrincipal["role"]): InternalPrincipal => ({
  kind: "internal",
  userId: "staff",
  role,
});

const clientUser: ClientPrincipal = {
  kind: "client",
  userId: "cu",
  tenantId: "t1",
};

describe("canCreateStudy — shared internal-setup capability (grilling Q5)", () => {
  it("allows Engagement Managers and Analysts", () => {
    expect(canCreateStudy(internal("EngagementManager"))).toBe(true);
    expect(canCreateStudy(internal("Analyst"))).toBe(true);
  });

  it("forbids the Admin (user-administration only, glossary intact)", () => {
    expect(canCreateStudy(internal("Admin"))).toBe(false);
  });

  it("forbids Researchers", () => {
    expect(canCreateStudy(internal("Researcher"))).toBe(false);
  });

  it("forbids client users (viewer-only)", () => {
    expect(canCreateStudy(clientUser)).toBe(false);
  });
});
