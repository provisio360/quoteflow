import { describe, it, expect } from "vitest";
import { canImportBenchmarkItems } from "./benchmark-items";
import type { InternalPrincipal, ClientPrincipal } from "./principal";

const internal = (role: InternalPrincipal["role"]): InternalPrincipal => ({
  kind: "internal",
  userId: "staff",
  role,
});

const clientUser: ClientPrincipal = { kind: "client", userId: "cu", tenantId: "t1" };

describe("canImportBenchmarkItems — shared internal-setup capability", () => {
  it("allows Engagement Managers and Analysts (mirrors study creation)", () => {
    expect(canImportBenchmarkItems(internal("EngagementManager"))).toBe(true);
    expect(canImportBenchmarkItems(internal("Analyst"))).toBe(true);
  });

  it("forbids the Admin (user-administration only)", () => {
    expect(canImportBenchmarkItems(internal("Admin"))).toBe(false);
  });

  it("forbids Researchers", () => {
    expect(canImportBenchmarkItems(internal("Researcher"))).toBe(false);
  });

  it("forbids client users (viewer-only, never write)", () => {
    expect(canImportBenchmarkItems(clientUser)).toBe(false);
  });
});
