import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { countInviteHygiene, createInvite, listInvites, revokeInvite } from "./invites";

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

describe("countInviteHygiene", () => {
  // The Admin-home signals (#56). Asserted as deltas off a baseline because the
  // count is global (the whole invite table), and earlier suites in this file
  // seed their own rows — absolute numbers would be brittle.
  it("counts a fresh invite as pending and a lapsed one as expired, ignoring revoked", async () => {
    const base = await countInviteHygiene();

    const pendingOne = await createInvite({
      email: "inv-hygiene-pending@example.com",
      kind: "internal",
      role: "Analyst",
      invitedById: adminId,
    });
    if (!pendingOne.ok) throw new Error("setup failed");

    const lapsed = await createInvite({
      email: "inv-hygiene-expired@example.com",
      kind: "internal",
      role: "Researcher",
      invitedById: adminId,
    });
    if (!lapsed.ok) throw new Error("setup failed");
    // Backdate expiry so the otherwise-open invite reads as expired-unaccepted.
    await prisma.invite.update({
      where: { id: lapsed.inviteId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // A revoked invite must count as neither — it's terminal, not a resend candidate.
    const revoked = await createInvite({
      email: "inv-hygiene-revoked@example.com",
      kind: "internal",
      role: "Researcher",
      invitedById: adminId,
    });
    if (!revoked.ok) throw new Error("setup failed");
    await revokeInvite(revoked.inviteId);

    const after = await countInviteHygiene();
    expect(after.pending - base.pending).toBe(1);
    expect(after.expired - base.expired).toBe(1);
  });
});
