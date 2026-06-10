import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createInvite, listInvites, revokeInvite } from "./invites";

// listInvites powers the Admin invites screen: it derives each invite's display
// status (pending / accepted / revoked / expired) so the UI can show state and
// offer revoke/resend on pending ones. Status precedence reuses the tested
// evaluateInvite. Runs as the owner like the other repo suites (invite is
// identity substrate — not an RLS table, ADR-0021).

const adminId = `inv-admin-${Date.now()}`;

beforeAll(async () => {
  await prisma.user.create({
    data: { id: adminId, name: "Inv Admin", email: `${adminId}@example.com`, kind: "internal", role: "Admin" },
  });
});

afterAll(async () => {
  await prisma.invite.deleteMany({ where: { email: { startsWith: "inv-" } } });
  await prisma.user.deleteMany({ where: { id: adminId } });
});

describe("listInvites", () => {
  it("lists a freshly-created invite as pending", async () => {
    const created = await createInvite({
      email: "inv-pending@example.com",
      kind: "internal",
      role: "Analyst",
      invitedById: adminId,
    });
    expect(created.ok).toBe(true);

    const found = (await listInvites()).find((i) => i.email === "inv-pending@example.com");
    expect(found).toBeDefined();
    expect(found?.status).toBe("pending");
    expect(found?.role).toBe("Analyst");
  });

  it("shows a revoked invite as revoked", async () => {
    const created = await createInvite({
      email: "inv-revoked@example.com",
      kind: "internal",
      role: "Researcher",
      invitedById: adminId,
    });
    if (!created.ok) throw new Error("setup failed");
    await revokeInvite(created.inviteId);

    const found = (await listInvites()).find((i) => i.email === "inv-revoked@example.com");
    expect(found?.status).toBe("revoked");
  });
});
