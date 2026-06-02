import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { InternalRole } from "@/domains/authz/principal";

// Account creation + lifecycle adapter. User creation goes through Better Auth's
// internal context (not the disabled public sign-up) so password hashing and the
// credential account are produced exactly as Better Auth expects (ADR-0007:
// authn separated from the principal). The role/tenant fields are written here,
// server-side only — never client-supplied.

interface InternalFields {
  kind: "internal";
  role: InternalRole;
  tenantId: null;
}
interface ClientFields {
  kind: "client";
  role: null;
  tenantId: string;
}
type IdentityFields = InternalFields | ClientFields;

export interface CreateCredentialUserInput {
  email: string;
  name: string;
  password: string;
  identity: IdentityFields;
}

/**
 * Create a verified email/password user with QuoteFlow identity fields.
 * `emailVerified: true` because the only caller paths (invite acceptance, the
 * seed bootstrap) have already proven email ownership — acceptance IS the
 * verification (grilling Q5).
 */
export async function createCredentialUser(
  input: CreateCredentialUserInput,
): Promise<{ id: string }> {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);

  const user = await ctx.internalAdapter.createUser({
    email: input.email.toLowerCase(),
    name: input.name,
    emailVerified: true,
    kind: input.identity.kind,
    role: input.identity.role,
    tenantId: input.identity.tenantId,
    status: "active",
  });

  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  });

  return { id: user.id };
}

/**
 * Offboarding: reversible deactivation, never deletion (ADR-0006 / grilling Q6).
 * Flips status and deletes every session so access ends on the next request.
 */
export async function deactivateUser(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { status: "deactivated", deactivatedAt: new Date() },
    }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

export async function reactivateUser(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { status: "active", deactivatedAt: null },
  });
}

/**
 * Role is mutable for internal staff (grilling Q6). Only internal users have a
 * role; attempting to set one on a client user violates the DB CHECK and throws.
 */
export async function changeInternalRole(
  userId: string,
  role: InternalRole,
): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { role } });
}
