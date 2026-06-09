// Pure decision core — no framework, DB, or network imports.
//
// Client (tenant) authorization. Creating a Client is administration of the
// tenant lifecycle, so it is the Admin's job (CONTEXT.md: "Admin is
// user-administration only"; ADR-0007). The engagement roles (EM/Analyst/
// Researcher) run the work *inside* a tenant but never mint one, and a client
// user is viewer-only. Listing Clients is a broader read (the EM/Analyst
// study-creation picker needs it) and is allowed to any internal staff.

import type { Principal } from "./principal";

/** Who may create a Client (tenant): the Admin only. */
export function canManageClients(principal: Principal): boolean {
  return principal.kind === "internal" && principal.role === "Admin";
}
