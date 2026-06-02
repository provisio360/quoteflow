import { describe, expect, it } from "vitest";
import { canAssignResearchers } from "./assignments";
import type { ClientPrincipal, InternalPrincipal } from "./principal";

const internal = (role: InternalPrincipal["role"]): InternalPrincipal => ({
  kind: "internal",
  userId: "u1",
  role,
});

describe("canAssignResearchers", () => {
  it("an Engagement Manager may assign researchers (running a study)", () => {
    expect(canAssignResearchers(internal("EngagementManager"))).toBe(true);
  });

  it("an Analyst may NOT assign — setup is shared, but running is EM-only", () => {
    expect(canAssignResearchers(internal("Analyst"))).toBe(false);
  });

  it("an Admin (user-administration only) may not assign", () => {
    expect(canAssignResearchers(internal("Admin"))).toBe(false);
  });

  it("a Researcher may not assign other researchers", () => {
    expect(canAssignResearchers(internal("Researcher"))).toBe(false);
  });

  it("a client user (viewer-only) may not assign", () => {
    const client: ClientPrincipal = {
      kind: "client",
      userId: "c1",
      tenantId: "t1",
    };
    expect(canAssignResearchers(client)).toBe(false);
  });
});
