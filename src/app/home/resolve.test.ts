import { describe, it, expect } from "vitest";
import { resolveHomeView } from "./resolve";
import {
  INTERNAL_ROLES,
  type InternalRole,
  type Principal,
} from "@/domains/authz/principal";

const internal = (role: InternalRole): Principal => ({
  kind: "internal",
  userId: "u1",
  role,
});

describe("resolveHomeView", () => {
  it("maps an unauthenticated request to the logged-out home", () => {
    expect(resolveHomeView(null)).toBe("logged-out");
  });

  it("maps a Client User to the client home", () => {
    expect(
      resolveHomeView({ kind: "client", userId: "u1", tenantId: "t1" }),
    ).toBe("client");
  });

  it("maps each internal role to its own view", () => {
    expect(resolveHomeView(internal("Admin"))).toBe("admin");
    expect(resolveHomeView(internal("EngagementManager"))).toBe("engagement-manager");
    expect(resolveHomeView(internal("Researcher"))).toBe("researcher");
    expect(resolveHomeView(internal("Analyst"))).toBe("analyst");
  });

  it("resolves a distinct internal view for every internal role (no gaps)", () => {
    const views = INTERNAL_ROLES.map((role) => resolveHomeView(internal(role)));
    expect(new Set(views).size).toBe(INTERNAL_ROLES.length);
    expect(views).not.toContain("logged-out");
    expect(views).not.toContain("client");
  });
});
