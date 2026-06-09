import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Principal } from "@/domains/authz/principal";
import { ClientAccessError, createClient, listClients } from "./repository";

// Clients (tenants) are created by an Admin and listed by any internal staff
// (the EM/Analyst study-creation picker needs the list). Like the other repo
// suites this runs as the owner; RLS-as-the-app-role is proven separately in
// src/lib/rls. clientId is the tenant binding (ADR-0001), so these run through
// withTenant like every tenant-table access (ADR-0021).

const admin: Principal = { kind: "internal", userId: "clients-test-admin", role: "Admin" };

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: "RepoTest " } } });
});

describe("clients repository", () => {
  it("an Admin creates a Client and it appears in the list", async () => {
    const created = await createClient(admin, "RepoTest Globex");
    expect(created.name).toBe("RepoTest Globex");

    const names = (await listClients(admin)).map((c) => c.name);
    expect(names).toContain("RepoTest Globex");
  });

  it("a non-Admin cannot create a Client", async () => {
    const researcher: Principal = {
      kind: "internal",
      userId: "clients-test-researcher",
      role: "Researcher",
    };
    await expect(createClient(researcher, "RepoTest Nope")).rejects.toBeInstanceOf(
      ClientAccessError,
    );
  });
});
