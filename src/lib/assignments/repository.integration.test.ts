import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  assignResearchers,
  listAssignmentsForResearcher,
  listAssignmentsForStudy,
  AssignmentAccessError,
} from "./repository";
import { createStudy } from "@/lib/studies/repository";
import type {
  ClientPrincipal,
  InternalPrincipal,
} from "@/domains/authz/principal";

// Real-Postgres proof of the Country-assignment write path (#6). The pure EM-only
// rule is unit-tested in src/domains/authz/assignments; this suite proves the
// repository's existence checks, eligibility, idempotency and read scoping hold
// against live SQL. Runs via `npm run test:integration`.

const prisma = new PrismaClient();

let tenantId: string;
let em: InternalPrincipal;
let studyId: string;
let researcherA: string;
let researcherB: string;

// Seed an active internal Researcher and return its id.
async function seedResearcher(label: string): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: label,
      email: `${label}-${id}@example.test`,
      emailVerified: true,
      kind: "internal",
      role: "Researcher",
      status: "active",
    },
  });
  return id;
}

beforeAll(async () => {
  const client = await prisma.client.create({
    data: { name: "Tenant (assignment test)" },
  });
  tenantId = client.id;

  const emId = randomUUID();
  await prisma.user.create({
    data: {
      id: emId,
      name: "EM (assignment test)",
      email: `em-${emId}@example.test`,
      emailVerified: true,
      kind: "internal",
      role: "EngagementManager",
      status: "active",
    },
  });
  em = { kind: "internal", userId: emId, role: "EngagementManager" };

  studyId = (await createStudy(em, { name: "Assignment study", clientId: tenantId })).id;

  // A study's countries are defined by its Benchmark Items (ADR-0009). Seed one
  // item in Germany so that country is assignable.
  await prisma.benchmarkItem.create({
    data: {
      studyId,
      country: "Germany",
      clientPartNumber: "PN-1",
      clientPartNumberKey: "pn-1",
      itemDescription: "Widget",
      machineModel: "M1",
      requiredQuotes: 1,
      clientPrice: "10.0000",
    },
  });

  researcherA = await seedResearcher("Researcher A");
  researcherB = await seedResearcher("Researcher B");
});

afterAll(async () => {
  await prisma.countryAssignment.deleteMany({ where: { studyId } });
  await prisma.benchmarkItem.deleteMany({ where: { studyId } });
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.user.deleteMany({
    where: { id: { in: [em.userId, researcherA, researcherB] } },
  });
  await prisma.client.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("assignResearchers — happy path", () => {
  it("an EM assigns a researcher to a country that has Benchmark Items", async () => {
    const result = await assignResearchers(em, studyId, "Germany", [researcherA]);
    expect(result.assigned).toBe(1);

    const onStudy = await listAssignmentsForStudy(em, studyId);
    expect(onStudy).toHaveLength(1);
    expect(onStudy[0]).toMatchObject({
      studyId,
      country: "Germany",
      researcherId: researcherA,
      assignedById: em.userId,
    });
  });

  it("is additive & idempotent — re-assigning is a no-op, a second researcher adds", async () => {
    // researcherA already on Germany from the previous test. Re-assign + add B.
    await assignResearchers(em, studyId, "Germany", [researcherA, researcherB]);

    const onStudy = await listAssignmentsForStudy(em, studyId);
    const researchers = onStudy
      .filter((a) => a.country === "Germany")
      .map((a) => a.researcherId)
      .sort();
    expect(researchers).toEqual([researcherA, researcherB].sort());
    // No duplicate row for A despite being assigned twice.
    expect(onStudy.filter((a) => a.researcherId === researcherA)).toHaveLength(1);
  });
});

describe("listAssignmentsForResearcher — self only", () => {
  it("a researcher sees their own assigned countries, never another's", async () => {
    // Both A and B are on Germany from earlier tests.
    const aPrincipal: InternalPrincipal = {
      kind: "internal",
      userId: researcherA,
      role: "Researcher",
    };
    const mine = await listAssignmentsForResearcher(aPrincipal);

    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((a) => a.researcherId === researcherA)).toBe(true);
    expect(mine.some((a) => a.researcherId === researcherB)).toBe(false);
  });
});

describe("assignResearchers — authorization & validation", () => {
  const analyst = (): InternalPrincipal => ({
    kind: "internal",
    userId: randomUUID(),
    role: "Analyst",
  });
  const client = (): ClientPrincipal => ({
    kind: "client",
    userId: randomUUID(),
    tenantId,
  });

  it("rejects a non-EM internal (Analyst) — running is EM-only", async () => {
    await expect(
      assignResearchers(analyst(), studyId, "Germany", [researcherA]),
    ).rejects.toBeInstanceOf(AssignmentAccessError);
  });

  it("rejects a client user (viewer-only)", async () => {
    await expect(
      assignResearchers(client(), studyId, "Germany", [researcherA]),
    ).rejects.toBeInstanceOf(AssignmentAccessError);
  });

  it("rejects a country with no Benchmark Items in the study", async () => {
    await expect(
      assignResearchers(em, studyId, "France", [researcherA]),
    ).rejects.toBeInstanceOf(AssignmentAccessError);
  });

  it("rejects an unknown study id (not-found)", async () => {
    await expect(
      assignResearchers(em, randomUUID(), "Germany", [researcherA]),
    ).rejects.toBeInstanceOf(AssignmentAccessError);
  });

  it("rejects the WHOLE batch if any target is not an active Researcher, writing nothing", async () => {
    // em.userId is an EngagementManager, not a Researcher — ineligible target.
    await expect(
      assignResearchers(em, studyId, "Germany", [researcherA, em.userId]),
    ).rejects.toBeInstanceOf(AssignmentAccessError);

    // All-or-nothing: the ineligible EM was never assigned.
    const leaked = await prisma.countryAssignment.findFirst({
      where: { studyId, researcherId: em.userId },
    });
    expect(leaked).toBeNull();
  });

  it("rejects a deactivated researcher", async () => {
    const deactivatedId = randomUUID();
    await prisma.user.create({
      data: {
        id: deactivatedId,
        name: "Ex-researcher",
        email: `ex-${deactivatedId}@example.test`,
        emailVerified: true,
        kind: "internal",
        role: "Researcher",
        status: "deactivated",
        deactivatedAt: new Date(),
      },
    });
    try {
      await expect(
        assignResearchers(em, studyId, "Germany", [deactivatedId]),
      ).rejects.toBeInstanceOf(AssignmentAccessError);
    } finally {
      await prisma.user.deleteMany({ where: { id: deactivatedId } });
    }
  });
});

describe("listAssignmentsForStudy — internal only", () => {
  it("a client user cannot read a study's assignments (internal staffing data)", async () => {
    const client: ClientPrincipal = {
      kind: "client",
      userId: randomUUID(),
      tenantId,
    };
    await expect(
      listAssignmentsForStudy(client, studyId),
    ).rejects.toBeInstanceOf(AssignmentAccessError);
  });
});
