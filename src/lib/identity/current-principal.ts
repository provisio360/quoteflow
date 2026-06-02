import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  toPrincipal,
  type Principal,
  type InternalPrincipal,
  type ClientPrincipal,
} from "@/domains/authz/principal";

// Resolve the authenticated Principal for the current request from the live
// server-side session (ADR-0006: we read role/tenant/status fresh every request
// rather than trusting a token). This is the seam #4's authorization layer
// consumes — it answers "who is calling", never "what may they see".

export class PrincipalError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "unauthenticated"
      | "deactivated"
      | "malformed-principal",
  ) {
    super(message);
    this.name = "PrincipalError";
  }
}

interface SessionUserShape {
  id: string;
  kind?: string | null;
  role?: string | null;
  tenantId?: string | null;
  status?: string | null;
}

/**
 * Returns the current Principal, or null if no valid active principal exists.
 * Deactivated accounts resolve to null — immediate revocation (ADR-0006): a
 * still-valid session cookie grants nothing once the user is deactivated.
 * A row that violates the role/tenant invariant also resolves to null (fail
 * closed) rather than becoming an over-privileged principal.
 */
export async function getCurrentPrincipal(): Promise<Principal | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const user = session.user as unknown as SessionUserShape;

  // Deactivation bites here, on the next request after offboarding.
  if (user.status === "deactivated") return null;

  if (user.kind !== "internal" && user.kind !== "client") return null;

  const result = toPrincipal({
    userId: user.id,
    kind: user.kind,
    role: user.role ?? null,
    tenantId: user.tenantId ?? null,
  });

  return result.ok ? result.principal : null;
}

/** Like getCurrentPrincipal but throws — for route handlers/actions that require auth. */
export async function requirePrincipal(): Promise<Principal> {
  const principal = await getCurrentPrincipal();
  if (!principal) {
    throw new PrincipalError("Not authenticated", "unauthenticated");
  }
  return principal;
}

/** Require an internal staff principal (any of the four roles). */
export async function requireInternal(): Promise<InternalPrincipal> {
  const principal = await requirePrincipal();
  if (principal.kind !== "internal") {
    throw new PrincipalError("Internal staff only", "unauthenticated");
  }
  return principal;
}

/** Require an internal Admin (user administration). */
export async function requireAdmin(): Promise<InternalPrincipal> {
  const principal = await requireInternal();
  if (principal.role !== "Admin") {
    throw new PrincipalError("Admin only", "unauthenticated");
  }
  return principal;
}

/** Require a Client User principal (bound to one tenant). */
export async function requireClient(): Promise<ClientPrincipal> {
  const principal = await requirePrincipal();
  if (principal.kind !== "client") {
    throw new PrincipalError("Client users only", "unauthenticated");
  }
  return principal;
}
