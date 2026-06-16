import { describe, it, expect } from "vitest";
import {
  toPrincipal,
  isInternal,
  isClient,
  isRole,
  isInternalRole,
  canViewClientDashboard,
  INTERNAL_ROLES,
  type InternalRole,
  type Principal,
  type PrincipalRow,
} from "./principal";

const internalRow: PrincipalRow = {
  userId: "u1",
  kind: "internal",
  role: "Analyst",
  tenantId: null,
};

const clientRow: PrincipalRow = {
  userId: "u2",
  kind: "client",
  role: null,
  tenantId: "t1",
};

describe("toPrincipal — valid rows", () => {
  it("builds an internal principal carrying its role and no tenant", () => {
    const r = toPrincipal(internalRow);
    expect(r).toEqual({
      ok: true,
      principal: { kind: "internal", userId: "u1", role: "Analyst" },
    });
  });

  it("builds a client principal carrying its tenant and no role", () => {
    const r = toPrincipal(clientRow);
    expect(r).toEqual({
      ok: true,
      principal: { kind: "client", userId: "u2", tenantId: "t1" },
    });
  });

  it("accepts every internal role including Admin", () => {
    for (const role of INTERNAL_ROLES) {
      expect(toPrincipal({ ...internalRow, role }).ok).toBe(true);
    }
  });
});

describe("toPrincipal — rejects illegal states (the isolation invariant)", () => {
  it("rejects an internal user with a tenant", () => {
    expect(toPrincipal({ ...internalRow, tenantId: "t1" })).toEqual({
      ok: false,
      error: "internal-forbids-tenant",
    });
  });

  it("rejects an internal user with no role", () => {
    expect(toPrincipal({ ...internalRow, role: null })).toEqual({
      ok: false,
      error: "internal-requires-role",
    });
  });

  it("rejects an internal user with an unrecognised role", () => {
    expect(toPrincipal({ ...internalRow, role: "Superuser" })).toEqual({
      ok: false,
      error: "internal-invalid-role",
    });
  });

  it("rejects a client user carrying a staff role", () => {
    expect(toPrincipal({ ...clientRow, role: "Analyst" })).toEqual({
      ok: false,
      error: "client-forbids-role",
    });
  });

  it("rejects a client user with no tenant", () => {
    expect(toPrincipal({ ...clientRow, tenantId: null })).toEqual({
      ok: false,
      error: "client-requires-tenant",
    });
  });

  it("rejects an unknown kind", () => {
    expect(
      toPrincipal({ ...internalRow, kind: "robot" as PrincipalRow["kind"] }),
    ).toEqual({ ok: false, error: "unknown-kind" });
  });
});

describe("guards", () => {
  it("narrows internal vs client", () => {
    const internal = toPrincipal(internalRow);
    const client = toPrincipal(clientRow);
    if (!internal.ok || !client.ok) throw new Error("setup");

    expect(isInternal(internal.principal)).toBe(true);
    expect(isClient(internal.principal)).toBe(false);
    expect(isClient(client.principal)).toBe(true);
    expect(isInternal(client.principal)).toBe(false);
  });

  it("isRole only matches internal principals of that role", () => {
    const internal = toPrincipal(internalRow);
    const client = toPrincipal(clientRow);
    if (!internal.ok || !client.ok) throw new Error("setup");

    expect(isRole(internal.principal, "Analyst")).toBe(true);
    expect(isRole(internal.principal, "Admin")).toBe(false);
    expect(isRole(client.principal, "Analyst")).toBe(false);
  });

  it("isInternalRole validates the role vocabulary", () => {
    expect(isInternalRole("Admin")).toBe(true);
    expect(isInternalRole("Researcher")).toBe(true);
    expect(isInternalRole("Client")).toBe(false);
    expect(isInternalRole(null)).toBe(false);
  });
});

describe("canViewClientDashboard", () => {
  const internal = (role: InternalRole): Principal => ({
    kind: "internal",
    userId: "u1",
    role,
  });

  it("blocks an internal Researcher — the anti-anchoring fail-closed case (ADR-0003)", () => {
    expect(canViewClientDashboard(internal("Researcher"))).toBe(false);
  });

  it("admits every non-Researcher internal role (EM/Analyst/Admin preview is retained)", () => {
    expect(canViewClientDashboard(internal("EngagementManager"))).toBe(true);
    expect(canViewClientDashboard(internal("Analyst"))).toBe(true);
    expect(canViewClientDashboard(internal("Admin"))).toBe(true);
  });

  it("admits a Client User (their own tenant's released output)", () => {
    const client: Principal = { kind: "client", userId: "u2", tenantId: "t1" };
    expect(canViewClientDashboard(client)).toBe(true);
  });
});
