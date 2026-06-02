import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createStudy,
  getStudy,
  listStudies,
  StudyAccessError,
} from "./repository";
import type {
  ClientPrincipal,
  InternalPrincipal,
} from "@/domains/authz/principal";

// Real-Postgres proof of tenant isolation (ADR-0008 / grilling Q8). A fake store
// would pass tautologically; only a live DB proves the spec → `where` actually
// filters rows. Runs via `npm run test:integration`.

const prisma = new PrismaClient();

// Two tenants, an internal creator, and the principals that act in the tests.
let tenantA: string;
let tenantB: string;
let emUserId: string;
let studyA: string;
let studyB: string;

let em: InternalPrincipal;
let clientA: ClientPrincipal;
let clientB: ClientPrincipal;

beforeAll(async () => {
  const a = await prisma.client.create({ data: { name: "Tenant A (isolation test)" } });
  const b = await prisma.client.create({ data: { name: "Tenant B (isolation test)" } });
  tenantA = a.id;
  tenantB = b.id;

  emUserId = randomUUID();
  await prisma.user.create({
    data: {
      id: emUserId,
      name: "EM (isolation test)",
      email: `em-${emUserId}@example.test`,
      emailVerified: true,
      kind: "internal",
      role: "EngagementManager",
      status: "active",
    },
  });

  em = { kind: "internal", userId: emUserId, role: "EngagementManager" };
  clientA = { kind: "client", userId: randomUUID(), tenantId: tenantA };
  clientB = { kind: "client", userId: randomUUID(), tenantId: tenantB };

  // Seed one study per tenant *through the repository* (also exercises create).
  studyA = (await createStudy(em, { name: "Study A", clientId: tenantA })).id;
  studyB = (await createStudy(em, { name: "Study B", clientId: tenantB })).id;
});

afterAll(async () => {
  await prisma.study.deleteMany({ where: { clientId: { in: [tenantA, tenantB] } } });
  await prisma.user.deleteMany({ where: { id: emUserId } });
  await prisma.client.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prisma.$disconnect();
});

describe("tenant isolation on reads", () => {
  it("a client user sees only their own tenant's studies", async () => {
    const seen = await listStudies(clientA);
    const ids = seen.map((s) => s.id);
    expect(ids).toContain(studyA);
    expect(ids).not.toContain(studyB);
    expect(seen.every((s) => s.clientId === tenantA)).toBe(true);
  });

  it("a client user CANNOT read another tenant's study — it is not-found", async () => {
    expect(await getStudy(clientA, studyB)).toBeNull();
    // ...and their own resolves normally, proving it's isolation not breakage.
    expect((await getStudy(clientA, studyA))?.id).toBe(studyA);
  });

  it("internal staff read studies across all tenants", async () => {
    const ids = (await listStudies(em)).map((s) => s.id);
    expect(ids).toContain(studyA);
    expect(ids).toContain(studyB);
    expect((await getStudy(em, studyB))?.id).toBe(studyB);
  });
});

describe("creation authorization", () => {
  it("a client user cannot create a study", async () => {
    await expect(
      createStudy(clientA, { name: "Nope", clientId: tenantA }),
    ).rejects.toBeInstanceOf(StudyAccessError);
  });

  it("an Analyst can create a study for a chosen tenant", async () => {
    const analyst: InternalPrincipal = {
      kind: "internal",
      userId: emUserId, // reuse the seeded internal user as createdBy
      role: "Analyst",
    };
    const created = await createStudy(analyst, {
      name: "Analyst study",
      clientId: tenantA,
    });
    expect(created.clientId).toBe(tenantA);
    expect(created.createdById).toBe(emUserId);
  });
});
