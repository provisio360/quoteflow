import { describe, it, expect } from "vitest";
import { evaluateInvite, isWellFormed, inviteExpiry, type InviteState } from "./invite";

const now = new Date("2026-06-02T00:00:00Z");
const future = new Date("2026-06-09T00:00:00Z");
const past = new Date("2026-06-01T00:00:00Z");

const pendingInternal: InviteState = {
  kind: "internal",
  role: "Researcher",
  tenantId: null,
  expiresAt: future,
  acceptedAt: null,
  revokedAt: null,
};

const pendingClient: InviteState = {
  kind: "client",
  role: null,
  tenantId: "t1",
  expiresAt: future,
  acceptedAt: null,
  revokedAt: null,
};

describe("evaluateInvite", () => {
  it("accepts a well-formed, unexpired, unrevoked, unaccepted invite", () => {
    expect(evaluateInvite(pendingInternal, now)).toEqual({ ok: true });
    expect(evaluateInvite(pendingClient, now)).toEqual({ ok: true });
  });

  it("rejects an expired invite", () => {
    expect(evaluateInvite({ ...pendingInternal, expiresAt: past }, now)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("treats the exact expiry instant as expired (boundary)", () => {
    expect(evaluateInvite({ ...pendingInternal, expiresAt: now }, now)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a revoked invite even if otherwise valid", () => {
    expect(evaluateInvite({ ...pendingInternal, revokedAt: past }, now)).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("rejects an already-accepted invite (single-use)", () => {
    expect(evaluateInvite({ ...pendingInternal, acceptedAt: past }, now)).toEqual({
      ok: false,
      reason: "already-accepted",
    });
  });

  it("reports revoked before expired when both apply", () => {
    expect(
      evaluateInvite({ ...pendingInternal, revokedAt: past, expiresAt: past }, now),
    ).toEqual({ ok: false, reason: "revoked" });
  });

  it("rejects a malformed invite (internal carrying a tenant)", () => {
    expect(
      evaluateInvite({ ...pendingInternal, tenantId: "t1" }, now).ok,
    ).toBe(false);
  });
});

describe("isWellFormed", () => {
  it("requires internal invites to carry a valid role and no tenant", () => {
    expect(isWellFormed(pendingInternal)).toBe(true);
    expect(isWellFormed({ ...pendingInternal, role: null })).toBe(false);
    expect(isWellFormed({ ...pendingInternal, tenantId: "t1" })).toBe(false);
    expect(
      isWellFormed({ ...pendingInternal, role: "Nope" as InviteState["role"] }),
    ).toBe(false);
  });

  it("requires client invites to carry a tenant and no role", () => {
    expect(isWellFormed(pendingClient)).toBe(true);
    expect(isWellFormed({ ...pendingClient, tenantId: null })).toBe(false);
    expect(
      isWellFormed({ ...pendingClient, role: "Analyst" as InviteState["role"] }),
    ).toBe(false);
  });
});

describe("inviteExpiry", () => {
  it("adds the configured number of days", () => {
    expect(inviteExpiry(now, 7).toISOString()).toBe("2026-06-09T00:00:00.000Z");
    expect(inviteExpiry(now, 1).toISOString()).toBe("2026-06-03T00:00:00.000Z");
  });
});
