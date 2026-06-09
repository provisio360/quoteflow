import { describe, it, expect } from "vitest";
import { canManageClients } from "./clients";
import type { InternalPrincipal, ClientPrincipal } from "./principal";

const internal = (role: InternalPrincipal["role"]): InternalPrincipal => ({
  kind: "internal",
  userId: "staff",
  role,
});

const clientUser: ClientPrincipal = { kind: "client", userId: "cu", tenantId: "t1" };

describe("canManageClients — tenant lifecycle is Admin administration", () => {
  it("allows the Admin", () => {
    expect(canManageClients(internal("Admin"))).toBe(true);
  });

  it("forbids the engagement roles (they run work inside a tenant, never mint one)", () => {
    expect(canManageClients(internal("EngagementManager"))).toBe(false);
    expect(canManageClients(internal("Analyst"))).toBe(false);
    expect(canManageClients(internal("Researcher"))).toBe(false);
  });

  it("forbids client users (viewer-only)", () => {
    expect(canManageClients(clientUser)).toBe(false);
  });
});
