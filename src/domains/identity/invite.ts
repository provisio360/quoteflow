// Pure decision core — no framework, DB, or network imports.
//
// Invite eligibility: given a stored invite's lifecycle timestamps and "now",
// decide whether it may still be accepted. Keeping this pure means the
// expired / revoked / already-accepted rules are unit-tested in isolation; the
// adapter (src/lib/identity) only loads the row and calls in here.

import { isInternalRole, type InternalRole } from "@/domains/authz/principal";

export type InviteKind = "internal" | "client";

/** The lifecycle-relevant shape of a stored invite. */
export interface InviteState {
  kind: InviteKind;
  role: InternalRole | null;
  tenantId: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export type InviteRejection =
  | "revoked"
  | "already-accepted"
  | "expired"
  | "malformed";

export type InviteEvaluation =
  | { ok: true }
  | { ok: false; reason: InviteRejection };

/**
 * Is this invite acceptable right now? Order matters: a revoked or
 * already-accepted invite is reported as such even if also expired, because
 * that is the more actionable message. "malformed" guards the same role-XOR-
 * tenant invariant as the principal, so an invite can never mint an illegal user.
 */
export function evaluateInvite(invite: InviteState, now: Date): InviteEvaluation {
  if (!isWellFormed(invite)) return { ok: false, reason: "malformed" };
  if (invite.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (invite.acceptedAt !== null) return { ok: false, reason: "already-accepted" };
  if (invite.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** Mirrors the role-XOR-tenant invariant for invites (CONTEXT.md: Invite). */
export function isWellFormed(invite: InviteState): boolean {
  if (invite.kind === "internal") {
    return (
      invite.tenantId === null &&
      invite.role !== null &&
      isInternalRole(invite.role)
    );
  }
  if (invite.kind === "client") {
    return invite.role === null && invite.tenantId !== null;
  }
  return false;
}

/** Expiry instant for a new invite, `days` after `now`. Days comes from config. */
export function inviteExpiry(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
