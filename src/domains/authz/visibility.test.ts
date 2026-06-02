import { describe, it, expect } from "vitest";
import { tenantVisibility, canSee } from "./visibility";
import {
  INTERNAL_ROLES,
  type InternalPrincipal,
  type ClientPrincipal,
} from "./principal";

const client = (tenantId: string): ClientPrincipal => ({
  kind: "client",
  userId: "cu",
  tenantId,
});

const internal = (role: InternalPrincipal["role"]): InternalPrincipal => ({
  kind: "internal",
  userId: "staff",
  role,
});

describe("tenantVisibility — the single isolation primitive", () => {
  it("gives every internal role the cross-tenant `all` scope (ADR-0001)", () => {
    for (const role of INTERNAL_ROLES) {
      expect(tenantVisibility(internal(role))).toEqual({ scope: "all" });
    }
  });

  it("pins a client user to their own tenant", () => {
    expect(tenantVisibility(client("t1"))).toEqual({
      scope: "tenant",
      tenantId: "t1",
    });
  });
});

describe("canSee — post-load predicate", () => {
  it("lets every internal role see a resource of any tenant", () => {
    for (const role of INTERNAL_ROLES) {
      expect(canSee(internal(role), "t1")).toBe(true);
      expect(canSee(internal(role), "t2")).toBe(true);
    }
  });

  it("lets a client see only their own tenant's resource", () => {
    expect(canSee(client("t1"), "t1")).toBe(true);
  });

  it("forbids a client from seeing another tenant's resource", () => {
    expect(canSee(client("t1"), "t2")).toBe(false);
  });
});

describe("canSee — fails closed", () => {
  it("the only path to `true` for a non-matching tenant is internal `all`", () => {
    // A client never gets a free pass: every tenant other than their own denies.
    for (const other of ["t2", "t3", "", "T1"]) {
      expect(canSee(client("t1"), other)).toBe(false);
    }
    // (The unrecognised-scope → deny guarantee is asserted on the adapter's
    // visibilityWhere, where a stray spec variant turns into a zero-row query.)
  });
});
