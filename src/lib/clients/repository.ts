import type { Principal } from "@/domains/authz/principal";
import { canManageClients } from "@/domains/authz/clients";
import { withTenant } from "@/lib/tenant-context";

// Data-access adapter for Clients (tenants, ADR-0001). A Client is created by an
// Admin and listed by internal staff (the EM/Analyst study-creation picker reads
// it). The `client` table is RLS-protected (ADR-0021), so every access runs
// through withTenant — internal staff resolve to the cross-tenant `is_internal`
// context, so they see and create across all tenants.

/** A Client as screens list it. */
export interface ClientSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
}

/** Raised when a principal attempts a Client write it is not authorised for. */
export class ClientAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientAccessError";
  }
}

/** Create a Client (tenant). Admin-only (ADR-0007 / domains/authz/clients). */
export async function createClient(principal: Principal, name: string): Promise<ClientSummary> {
  if (!canManageClients(principal)) {
    throw new ClientAccessError("Only an Admin may create a Client");
  }
  return withTenant(principal, (tx) =>
    tx.client.create({
      data: { name },
      select: { id: true, name: true, createdAt: true },
    }),
  );
}

/** Every Client, newest first — the study-creation picker and the Admin list. */
export function listClients(principal: Principal): Promise<ClientSummary[]> {
  return withTenant(principal, (tx) =>
    tx.client.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true },
    }),
  );
}
