import { describe, it, expect } from "vitest";
import {
  canImportBenchmarkItems,
  canSelfAssignBenchmarkItem,
  canMaintainClientPrice,
} from "./benchmark-items";
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

describe("canSelfAssignBenchmarkItem — a Researcher-only act", () => {
  it("allows a Researcher (self-assigning to become primary researcher)", () => {
    expect(canSelfAssignBenchmarkItem(internal("Researcher"))).toBe(true);
  });

  it("forbids Engagement Managers and Analysts (self-assign is a Researcher act)", () => {
    expect(canSelfAssignBenchmarkItem(internal("EngagementManager"))).toBe(false);
    expect(canSelfAssignBenchmarkItem(internal("Analyst"))).toBe(false);
  });

  it("forbids the Admin (user-administration only)", () => {
    expect(canSelfAssignBenchmarkItem(internal("Admin"))).toBe(false);
  });

  it("forbids client users (viewer-only, never write)", () => {
    expect(canSelfAssignBenchmarkItem(clientUser)).toBe(false);
  });
});

describe("canMaintainClientPrice — an Analyst-only QC act (ADR-0003/0015)", () => {
  it("allows an Analyst (Client Price is the analyst's QC benchmark)", () => {
    expect(canMaintainClientPrice(internal("Analyst"))).toBe(true);
  });

  it("forbids Engagement Managers (they run the study but don't curate Client Price)", () => {
    expect(canMaintainClientPrice(internal("EngagementManager"))).toBe(false);
  });

  it("forbids Researchers (Client Price is hidden from them, ADR-0003)", () => {
    expect(canMaintainClientPrice(internal("Researcher"))).toBe(false);
  });

  it("forbids the Admin (user-administration only)", () => {
    expect(canMaintainClientPrice(internal("Admin"))).toBe(false);
  });

  it("forbids client users (viewer-only, never write)", () => {
    expect(canMaintainClientPrice(clientUser)).toBe(false);
  });
});
