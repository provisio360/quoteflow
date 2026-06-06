import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  getBenchmarkItemForResearcher,
  selfAssignBenchmarkItem,
  BenchmarkItemAccessError,
} from "./repository";
import { createStudy } from "@/lib/studies/repository";
import { assignResearchers } from "@/lib/assignments/repository";
import type { InternalPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the researcher-facing Benchmark Item paths (#7): the
// guidance read view (Client Price field-hidden — ADR-0003) and the self-assign
// claim that makes a Researcher the item's Primary Researcher. The pure role
// rule is unit-tested in src/domains/authz/benchmark-items; this suite proves the
// Client-Price hiding, the Country-pool gate, the first-come atomic claim and
// idempotency hold against live SQL. Runs via `npm run test:integration`.

const prisma = new PrismaClient();

let tenantId: string;
let em: InternalPrincipal;
let studyId: string;
let germanyItemId: string;
let germanyItem2Id: string;
let researcherA: InternalPrincipal; // assigned to Germany
let researcherB: InternalPrincipal; // NOT assigned to Germany
let researcherC: InternalPrincipal; // assigned to Germany (for contention)

async function seedResearcher(label: string): Promise<InternalPrincipal> {
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
  return { kind: "internal", userId: id, role: "Researcher" };
}

beforeAll(async () => {
  const client = await prisma.client.create({
    data: { name: "Tenant (researcher view test)" },
  });
  tenantId = client.id;

  const emId = randomUUID();
  await prisma.user.create({
    data: {
      id: emId,
      name: "EM (researcher view test)",
      email: `em-${emId}@example.test`,
      emailVerified: true,
      kind: "internal",
      role: "EngagementManager",
      status: "active",
    },
  });
  em = { kind: "internal", userId: emId, role: "EngagementManager" };

  studyId = (await createStudy(em, { name: "Researcher view study", clientId: tenantId, qcThresholdPct: 25 })).id;

  germanyItemId = (
    await prisma.benchmarkItem.create({
      data: {
        studyId,
        country: "Germany",
        clientPartNumber: "PN-1",
        clientPartNumberKey: "pn-1",
        itemDescription: "Hydraulic widget",
        configurationComment: "with seal kit",
        quantity: 4,
        machineModel: "M1",
        requiredQuotes: 2,
        clientPrice: "123.4500",
      },
    })
  ).id;

  germanyItem2Id = (
    await prisma.benchmarkItem.create({
      data: {
        studyId,
        country: "Germany",
        clientPartNumber: "PN-2",
        clientPartNumberKey: "pn-2",
        itemDescription: "Spare gasket",
        machineModel: "M2",
        requiredQuotes: 1,
        clientPrice: "9.9900",
      },
    })
  ).id;

  researcherA = await seedResearcher("Researcher A");
  researcherB = await seedResearcher("Researcher B");
  researcherC = await seedResearcher("Researcher C");

  // A and C are in the Germany pool; B is left unassigned to prove the gate.
  await assignResearchers(em, studyId, "Germany", [
    researcherA.userId,
    researcherC.userId,
  ]);
});

afterAll(async () => {
  await prisma.countryAssignment.deleteMany({ where: { studyId } });
  await prisma.benchmarkItem.deleteMany({ where: { studyId } });
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [
          em.userId,
          researcherA.userId,
          researcherB.userId,
          researcherC.userId,
        ],
      },
    },
  });
  await prisma.client.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("getBenchmarkItemForResearcher — guidance view, Client Price hidden", () => {
  it("returns the client guidance fields a researcher needs", async () => {
    const view = await getBenchmarkItemForResearcher(researcherA, germanyItemId);
    expect(view).toMatchObject({
      id: germanyItemId,
      studyId,
      country: "Germany",
      clientPartNumber: "PN-1",
      itemDescription: "Hydraulic widget",
      configurationComment: "with seal kit",
      quantity: 4,
      machineModel: "M1",
      requiredQuotes: 2,
    });
  });

  it("NEVER includes Client Price in the payload (ADR-0003 — verified by test)", async () => {
    const view = await getBenchmarkItemForResearcher(researcherA, germanyItemId);
    expect(view).not.toBeNull();
    // Structural guarantee: the key is absent, not merely undefined/null.
    expect(Object.keys(view!)).not.toContain("clientPrice");
    // And nothing in the serialized payload carries the value.
    expect(JSON.stringify(view)).not.toContain("123.45");
  });
});

describe("selfAssignBenchmarkItem — becoming the Primary Researcher", () => {
  it("an assigned researcher claims an unclaimed item and becomes primary", async () => {
    const result = await selfAssignBenchmarkItem(researcherA, germanyItemId);
    expect(result.primaryResearcherId).toBe(researcherA.userId);

    const view = await getBenchmarkItemForResearcher(researcherA, germanyItemId);
    expect(view?.primaryResearcherId).toBe(researcherA.userId);
  });

  it("re-claiming one's own item is an idempotent no-op (still primary)", async () => {
    // germanyItemId is already A's from the previous test.
    const again = await selfAssignBenchmarkItem(researcherA, germanyItemId);
    expect(again.primaryResearcherId).toBe(researcherA.userId);
  });

  it("first-come: another pool researcher cannot steal an already-claimed lead", async () => {
    // C is in the Germany pool but A already holds germanyItemId.
    await expect(
      selfAssignBenchmarkItem(researcherC, germanyItemId),
    ).rejects.toBeInstanceOf(BenchmarkItemAccessError);

    // The lead is unchanged — still A.
    const view = await getBenchmarkItemForResearcher(researcherC, germanyItemId);
    expect(view?.primaryResearcherId).toBe(researcherA.userId);
  });

  it("rejects a researcher not in the item's Country pool, leaving it unclaimed", async () => {
    // B is not assigned to Germany; germanyItem2Id is still unclaimed.
    await expect(
      selfAssignBenchmarkItem(researcherB, germanyItem2Id),
    ).rejects.toBeInstanceOf(BenchmarkItemAccessError);

    const view = await getBenchmarkItemForResearcher(researcherB, germanyItem2Id);
    expect(view?.primaryResearcherId).toBeNull();
  });

  it("rejects a non-Researcher (an EM may run a study, not self-assign items)", async () => {
    await expect(
      selfAssignBenchmarkItem(em, germanyItem2Id),
    ).rejects.toBeInstanceOf(BenchmarkItemAccessError);
  });

  it("rejects an unknown item id (not-found)", async () => {
    await expect(
      selfAssignBenchmarkItem(researcherA, randomUUID()),
    ).rejects.toBeInstanceOf(BenchmarkItemAccessError);
  });
});
