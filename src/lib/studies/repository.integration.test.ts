import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createStudy,
  getStudy,
  getStudyDetail,
  listStudies,
  listStudiesWithReleasedCounts,
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
  studyA = (await createStudy(em, { name: "Study A", clientId: tenantA, qcThreshold: 0.25 })).id;
  studyB = (await createStudy(em, { name: "Study B", clientId: tenantB, qcThreshold: 0.25 })).id;
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

describe("shell read projection (issue #24)", () => {
  it("listStudies carries each study's client name for the shell", async () => {
    const seen = await listStudies(em);
    const a = seen.find((s) => s.id === studyA);
    expect(a?.clientName).toBe("Tenant A (isolation test)");
  });

  it("getStudyDetail returns the study with its client name", async () => {
    const detail = await getStudyDetail(em, studyA);
    expect(detail?.id).toBe(studyA);
    expect(detail?.clientName).toBe("Tenant A (isolation test)");
  });

  it("getStudyDetail is tenant-scoped — another tenant's study is not-found", async () => {
    expect(await getStudyDetail(clientA, studyB)).toBeNull();
    expect((await getStudyDetail(clientA, studyA))?.id).toBe(studyA);
  });
});

describe("released-country counts for the client home (issue #60)", () => {
  // Seed a CountryRelease row directly (the release path itself is proven in
  // release/repository.integration.test.ts; here we only exercise the count).
  async function seedRelease(
    studyId: string,
    clientId: string,
    country: string,
    state: "released" | "reopened",
  ) {
    await prisma.countryRelease.create({
      data: {
        studyId,
        clientId,
        country,
        state,
        releasedById: emUserId,
        releasedAt: new Date(),
      },
    });
  }

  // A dedicated study per tenant so these rows don't perturb the other blocks.
  let countStudyA: string;
  let countStudyB: string;
  let emptyStudyA: string;

  beforeAll(async () => {
    countStudyA = (await createStudy(em, { name: "Counts A", clientId: tenantA, qcThreshold: 0.25 })).id;
    countStudyB = (await createStudy(em, { name: "Counts B", clientId: tenantB, qcThreshold: 0.25 })).id;
    emptyStudyA = (await createStudy(em, { name: "Empty A", clientId: tenantA, qcThreshold: 0.25 })).id;

    // countStudyA: two released, one reopened (excluded). countStudyB (other
    // tenant): one released — must never leak into tenant A's counts.
    await seedRelease(countStudyA, tenantA, "France", "released");
    await seedRelease(countStudyA, tenantA, "Germany", "released");
    await seedRelease(countStudyA, tenantA, "Spain", "reopened");
    await seedRelease(countStudyB, tenantB, "Italy", "released");
    // emptyStudyA: no release rows at all.
  });

  it("counts only currently-released countries, excluding reopened and absent", async () => {
    const seen = await listStudiesWithReleasedCounts(clientA);
    const a = seen.find((s) => s.id === countStudyA);
    expect(a?.releasedCountryCount).toBe(2);
  });

  it("a study with zero released countries is still listed, with count 0", async () => {
    const seen = await listStudiesWithReleasedCounts(clientA);
    const empty = seen.find((s) => s.id === emptyStudyA);
    expect(empty).toBeDefined();
    expect(empty?.releasedCountryCount).toBe(0);
  });

  it("another tenant's released countries never contribute — and their study is absent", async () => {
    const seen = await listStudiesWithReleasedCounts(clientA);
    expect(seen.map((s) => s.id)).not.toContain(countStudyB);
    expect(seen.every((s) => s.clientId === tenantA)).toBe(true);
    // Tenant B sees its own count, proving isolation not breakage.
    const bSeen = await listStudiesWithReleasedCounts(clientB);
    expect(bSeen.find((s) => s.id === countStudyB)?.releasedCountryCount).toBe(1);
  });
});

describe("creation authorization", () => {
  it("a client user cannot create a study", async () => {
    await expect(
      createStudy(clientA, { name: "Nope", clientId: tenantA, qcThreshold: 0.25 }),
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
      qcThreshold: 0.3,
    });
    expect(created.clientId).toBe(tenantA);
    expect(created.createdById).toBe(emUserId);
    expect(Number(created.qcThreshold)).toBe(0.3);
  });
});
