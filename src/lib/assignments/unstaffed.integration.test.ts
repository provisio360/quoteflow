import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  assignResearchers,
  countUnstaffedCountries,
  AssignmentAccessError,
} from "./repository";
import { createStudy } from "@/lib/studies/repository";
import type {
  ClientPrincipal,
  InternalPrincipal,
} from "@/domains/authz/principal";

// Real-Postgres proof of the EM home's "unstaffed countries" signal (#57): the
// count of distinct (study, country) pairs that have Benchmark Items but no
// Country Assignment yet — the EM's open setup backlog. The count is GLOBAL
// (internal staff see every tenant, "all" scope), so the shared test DB carries
// pollution from other suites; every assertion is a DELTA around a known
// mutation, never an absolute total.

const prisma = new PrismaClient();

let tenantId: string;
let em: InternalPrincipal;

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

// Seed one Benchmark Item (so the country exists) in a study. Distinct part
// numbers keep the (study, country, partKey) unique key happy.
async function seedItem(studyId: string, country: string, pn: string): Promise<void> {
  await prisma.benchmarkItem.create({
    data: {
      studyId,
      clientId: tenantId,
      country,
      clientItemNumber: pn,
      clientItemNumberKey: pn.toLowerCase(),
      itemDescription: "Widget",
      clientSourceUnit: "M1",
      requiredQuotes: 1,
    },
  });
}

beforeAll(async () => {
  const client = await prisma.client.create({
    data: { name: "Tenant (unstaffed test)" },
  });
  tenantId = client.id;

  const emId = randomUUID();
  await prisma.user.create({
    data: {
      id: emId,
      name: "EM (unstaffed test)",
      email: `em-${emId}@example.test`,
      emailVerified: true,
      kind: "internal",
      role: "EngagementManager",
      status: "active",
    },
  });
  em = { kind: "internal", userId: emId, role: "EngagementManager" };
});

afterAll(async () => {
  const studies = await prisma.study.findMany({
    where: { clientId: tenantId },
    select: { id: true },
  });
  const studyIds = studies.map((s) => s.id);
  await prisma.auditEvent.deleteMany({ where: { studyId: { in: studyIds } } });
  await prisma.countryAssignment.deleteMany({ where: { clientId: tenantId } });
  await prisma.benchmarkItem.deleteMany({ where: { clientId: tenantId } });
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.user.deleteMany({ where: { id: em.userId } });
  await prisma.client.deleteMany({ where: { id: tenantId } });
});

describe("countUnstaffedCountries — the EM setup backlog signal", () => {
  it("a country with Benchmark Items and no assignment raises the count by one", async () => {
    const before = await countUnstaffedCountries(em);

    const studyId = (
      await createStudy(em, { name: "S1", clientId: tenantId, qcThreshold: 0.25 })
    ).id;
    await seedItem(studyId, "Germany", "PN-1");

    const after = await countUnstaffedCountries(em);
    expect(after - before).toBe(1);
  });

  it("assigning a researcher staffs the country — the count drops by one", async () => {
    const studyId = (
      await createStudy(em, { name: "S2", clientId: tenantId, qcThreshold: 0.25 })
    ).id;
    await seedItem(studyId, "France", "PN-1");
    const researcher = await seedResearcher("R-staff");

    const before = await countUnstaffedCountries(em);
    await assignResearchers(em, studyId, "France", [researcher]);
    const after = await countUnstaffedCountries(em);

    expect(before - after).toBe(1);
  });

  it("a single (study, country) with several Benchmark Items counts once", async () => {
    const studyId = (
      await createStudy(em, { name: "S3", clientId: tenantId, qcThreshold: 0.25 })
    ).id;

    const before = await countUnstaffedCountries(em);
    await seedItem(studyId, "Spain", "PN-1");
    await seedItem(studyId, "Spain", "PN-2");
    await seedItem(studyId, "Spain", "PN-3");
    const after = await countUnstaffedCountries(em);

    expect(after - before).toBe(1);
  });

  it("the same country name in two studies counts as two distinct pairs", async () => {
    const studyA = (
      await createStudy(em, { name: "S4a", clientId: tenantId, qcThreshold: 0.25 })
    ).id;
    const studyB = (
      await createStudy(em, { name: "S4b", clientId: tenantId, qcThreshold: 0.25 })
    ).id;

    const before = await countUnstaffedCountries(em);
    await seedItem(studyA, "Italy", "PN-1");
    await seedItem(studyB, "Italy", "PN-1");
    const after = await countUnstaffedCountries(em);

    expect(after - before).toBe(2);
  });

  it("rejects a client user — staffing data is internal-only", async () => {
    const client: ClientPrincipal = { kind: "client", userId: randomUUID(), tenantId };
    await expect(countUnstaffedCountries(client)).rejects.toBeInstanceOf(
      AssignmentAccessError,
    );
  });
});
