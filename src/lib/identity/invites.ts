import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { isInternalRole, type InternalRole } from "@/domains/authz/principal";
import { evaluateInvite, isWellFormed, inviteExpiry } from "@/domains/identity/invite";
import { issueToken, hashToken } from "./tokens";
import { createCredentialUser } from "./users";

// Invite lifecycle adapter (CONTEXT.md: Invite). The Admin-only authority check
// is enforced at the route/action boundary (requireAdmin); these functions take
// the acting admin's id and do the persistence + token work.

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

function expiryDays(): number {
  const raw = Number(process.env.INVITE_EXPIRY_DAYS ?? "7");
  return Number.isFinite(raw) && raw > 0 ? raw : 7;
}

export type CreateInviteInput =
  | { email: string; kind: "internal"; role: InternalRole; invitedById: string }
  | { email: string; kind: "client"; tenantId: string; invitedById: string };

export type CreateInviteResult =
  | { ok: true; inviteId: string; rawToken: string; expiresAt: Date }
  | { ok: false; error: "email-in-use" | "invalid-binding" | "pending-invite-exists" };

/**
 * Mint a single-use invite. The raw token is returned (and emailed) once; only
 * its hash is stored. Refuses if the email already has an account or an open
 * (pending, unexpired) invite, so invites can't pile up or shadow a real user.
 */
export async function createInvite(input: CreateInviteInput): Promise<CreateInviteResult> {
  const email = input.email.toLowerCase();
  const role = input.kind === "internal" ? input.role : null;
  const tenantId = input.kind === "client" ? input.tenantId : null;

  // Mirror the role-XOR-tenant invariant before we touch the DB.
  if (!isWellFormed({ kind: input.kind, role, tenantId, expiresAt: new Date(), acceptedAt: null, revokedAt: null })) {
    return { ok: false, error: "invalid-binding" };
  }
  if (input.kind === "internal" && !isInternalRole(input.role)) {
    return { ok: false, error: "invalid-binding" };
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) return { ok: false, error: "email-in-use" };

  const now = new Date();
  const pending = await prisma.invite.findFirst({
    where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
  });
  if (pending) return { ok: false, error: "pending-invite-exists" };

  const { raw, hash } = issueToken();
  const expiresAt = inviteExpiry(now, expiryDays());

  const invite = await prisma.invite.create({
    data: {
      email,
      kind: input.kind,
      role,
      tenantId,
      tokenHash: hash,
      expiresAt,
      invitedById: input.invitedById,
    },
  });

  await sendInviteEmail(email, raw, expiresAt);
  return { ok: true, inviteId: invite.id, rawToken: raw, expiresAt };
}

/** An invite's display state for the Admin list. */
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

/** One invite as the Admin invites screen lists it. Only `pending` invites are
 *  actionable (revoke / resend). */
export interface InviteSummary {
  readonly id: string;
  readonly email: string;
  readonly kind: "internal" | "client";
  readonly role: InternalRole | null;
  readonly tenantId: string | null;
  readonly status: InviteStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/** Derive display status, reusing evaluateInvite's tested precedence (a revoked
 *  or accepted invite is terminal; expiry only matters while otherwise open). */
function inviteStatus(
  invite: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null; kind: "internal" | "client"; role: InternalRole | null; tenantId: string | null },
  now: Date,
): InviteStatus {
  const verdict = evaluateInvite(
    { kind: invite.kind, role: invite.role, tenantId: invite.tenantId, expiresAt: invite.expiresAt, acceptedAt: invite.acceptedAt, revokedAt: invite.revokedAt },
    now,
  );
  if (verdict.ok) return "pending";
  switch (verdict.reason) {
    case "already-accepted":
      return "accepted";
    case "revoked":
      return "revoked";
    default:
      return "expired"; // expired or malformed — terminal, not actionable
  }
}

/** Every invite, newest first, with derived status — the Admin invites list. */
export async function listInvites(): Promise<InviteSummary[]> {
  const now = new Date();
  const rows = await prisma.invite.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    kind: r.kind,
    role: r.role,
    tenantId: r.tenantId,
    status: inviteStatus(r, now),
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }));
}

/** The two derived invite-hygiene signals the Admin home shows (#56): open
 *  offers still awaiting acceptance, and the lapsed-unaccepted ones — the
 *  resend candidates. */
export interface InviteHygiene {
  readonly pending: number;
  readonly expired: number;
}

/** Count pending and expired-unaccepted invites for the Admin home. Derives
 *  from listInvites so the pending/expired precedence stays owned by the tested
 *  evaluateInvite, not re-encoded as a second ad-hoc predicate here (#56). At
 *  Admin invite volumes loading the rows to count them is a non-issue. */
export async function countInviteHygiene(): Promise<InviteHygiene> {
  const invites = await listInvites();
  let pending = 0;
  let expired = 0;
  for (const i of invites) {
    if (i.status === "pending") pending++;
    else if (i.status === "expired") expired++;
  }
  return { pending, expired };
}

export type AcceptInviteResult =
  | { ok: true; userId: string }
  | { ok: false; error: "invalid-token" | "revoked" | "already-accepted" | "expired" | "malformed" | "email-in-use" };

/**
 * Accept an invite: create the verified user + credential and mark the invite
 * used. Single-use — the acceptedAt stamp makes a second use fail evaluation.
 * Does not establish the session itself; a thin server action signs the user in
 * afterward (keeps this unit-testable without request/cookie context).
 */
export async function acceptInvite(input: {
  token: string;
  name: string;
  password: string;
}): Promise<AcceptInviteResult> {
  const tokenHash = hashToken(input.token);
  const invite = await prisma.invite.findUnique({ where: { tokenHash } });
  if (!invite) return { ok: false, error: "invalid-token" };

  const verdict = evaluateInvite(
    {
      kind: invite.kind,
      role: invite.role,
      tenantId: invite.tenantId,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt,
      revokedAt: invite.revokedAt,
    },
    new Date(),
  );
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  // Re-check email isn't taken (race: someone else accepted/created meanwhile).
  const existing = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existing) return { ok: false, error: "email-in-use" };

  const identity =
    invite.kind === "internal"
      ? { kind: "internal" as const, role: invite.role as InternalRole, tenantId: null }
      : { kind: "client" as const, role: null, tenantId: invite.tenantId as string };

  const user = await createCredentialUser({
    email: invite.email,
    name: input.name,
    password: input.password,
    identity,
  });

  // Mark used only after the account exists. Conditional update guards against a
  // concurrent second acceptance (acceptedAt must still be null).
  const marked = await prisma.invite.updateMany({
    where: { id: invite.id, acceptedAt: null },
    data: { acceptedAt: new Date() },
  });
  if (marked.count === 0) {
    // Lost the race; another request already consumed this invite.
    return { ok: false, error: "already-accepted" };
  }

  return { ok: true, userId: user.id };
}

/** Revoke a pending invite (Admin). No-op-safe if already accepted/revoked. */
export async function revokeInvite(inviteId: string): Promise<void> {
  await prisma.invite.updateMany({
    where: { id: inviteId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export type ResendInviteResult =
  | { ok: true; rawToken: string; expiresAt: Date }
  | { ok: false; error: "not-found" | "already-accepted" };

/** Resend = issue a fresh token and reset expiry on an unaccepted invite. */
export async function resendInvite(inviteId: string): Promise<ResendInviteResult> {
  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite) return { ok: false, error: "not-found" };
  if (invite.acceptedAt) return { ok: false, error: "already-accepted" };

  const { raw, hash } = issueToken();
  const expiresAt = inviteExpiry(new Date(), expiryDays());
  await prisma.invite.update({
    where: { id: inviteId },
    data: { tokenHash: hash, expiresAt, revokedAt: null },
  });

  await sendInviteEmail(invite.email, raw, expiresAt);
  return { ok: true, rawToken: raw, expiresAt };
}

async function sendInviteEmail(email: string, rawToken: string, expiresAt: Date): Promise<void> {
  const url = `${appUrl}/accept-invite?token=${encodeURIComponent(rawToken)}`;
  await sendEmail({
    to: email,
    subject: "You've been invited to QuoteFlow",
    body: `You've been invited to QuoteFlow.\n\nAccept the invite and set your password here (expires ${expiresAt.toISOString()}):\n${url}\n\nIf you weren't expecting this, you can ignore this email.`,
  });
}
