import { describe, it, expect } from "vitest";
import {
  canImportBenchmarkItems,
  canResearch,
  canMaintainClientPrice,
  canViewClientPrice,
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

describe("canResearch — the researcher collection capability (ADR-0038)", () => {
  it("allows a Researcher (uses the Collect / Drafts / Needs-attention surfaces)", () => {
    expect(canResearch(internal("Researcher"))).toBe(true);
  });

  it("forbids Engagement Managers and Analysts (research is a Researcher act)", () => {
    expect(canResearch(internal("EngagementManager"))).toBe(false);
    expect(canResearch(internal("Analyst"))).toBe(false);
  });

  it("forbids the Admin (user-administration only)", () => {
    expect(canResearch(internal("Admin"))).toBe(false);
  });

  it("forbids client users (viewer-only, never write)", () => {
    expect(canResearch(clientUser)).toBe(false);
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

describe("canViewClientPrice — the read boundary (Analyst + EM, ADR-0024)", () => {
  it("allows an Analyst (owns and reads Client Price)", () => {
    expect(canViewClientPrice(internal("Analyst"))).toBe(true);
  });

  it("allows an Engagement Manager (sees Client Price via the Internal Export)", () => {
    expect(canViewClientPrice(internal("EngagementManager"))).toBe(true);
  });

  it("forbids a Researcher (Client Price is hidden from them, ADR-0003)", () => {
    expect(canViewClientPrice(internal("Researcher"))).toBe(false);
  });

  it("forbids the Admin (user-administration only)", () => {
    expect(canViewClientPrice(internal("Admin"))).toBe(false);
  });

  it("forbids client users (TC040 — never reachable by clients)", () => {
    expect(canViewClientPrice(clientUser)).toBe(false);
  });
});
