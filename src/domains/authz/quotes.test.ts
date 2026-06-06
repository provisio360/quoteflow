import { describe, it, expect } from "vitest";
import { canCreateQuote, canReviewQuote } from "./quotes";
import type { Principal } from "./principal";

const researcher: Principal = { kind: "internal", userId: "u1", role: "Researcher" };
const analyst: Principal = { kind: "internal", userId: "u2", role: "Analyst" };
const em: Principal = { kind: "internal", userId: "u3", role: "EngagementManager" };
const admin: Principal = { kind: "internal", userId: "u4", role: "Admin" };
const clientUser: Principal = { kind: "client", userId: "u5", tenantId: "t1" };

describe("canCreateQuote", () => {
  it("permits a Researcher (collecting quotes is a Researcher act)", () => {
    expect(canCreateQuote(researcher)).toBe(true);
  });

  it("denies every non-Researcher role and the client user", () => {
    expect(canCreateQuote(analyst)).toBe(false);
    expect(canCreateQuote(em)).toBe(false);
    expect(canCreateQuote(admin)).toBe(false);
    expect(canCreateQuote(clientUser)).toBe(false);
  });
});

describe("canReviewQuote", () => {
  it("permits an Analyst (reviewing/approving quotes is the Analyst's act)", () => {
    expect(canReviewQuote(analyst)).toBe(true);
  });

  it("denies every non-Analyst role and the client user", () => {
    expect(canReviewQuote(researcher)).toBe(false);
    expect(canReviewQuote(em)).toBe(false);
    expect(canReviewQuote(admin)).toBe(false);
    expect(canReviewQuote(clientUser)).toBe(false);
  });
});
