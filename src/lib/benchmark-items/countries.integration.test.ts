import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Principal } from "@/domains/authz/principal";
import { listStudyCountries } from "./repository";

// listStudyCountries gives the distinct Countries of a study, derived from its
// Benchmark Items (ADR-0009) — the set the EM assigns researchers to and the
// Analyst releases. Available to any internal staff (no Client Price), unlike the
// analyst-only item list. Runs as the owner.

const em: Principal = { kind: "internal", userId: "countries-em", role: "EngagementManager" };
const stamp = Date.now();
let tenantId: string;
let studyId: string;

beforeAll(async () => {
  const client = await prisma.client.create({ data: { name: `Countries Co ${stamp}` } });
  tenantId = client.id;
  const user = await prisma.user.create({
    data: { id: `countries-u-${stamp}`, name: "U", email: `countries-${stamp}@x.com`, kind: "internal", role: "Analyst" },
  });
  const study = await prisma.study.create({
    data: { name: "Countries study", clientId: tenantId, createdById: user.id, qcThresholdPct: 25 },
  });
  studyId = study.id;
  await prisma.benchmarkItem.createMany({
    data: [
      { studyId, clientId: tenantId, country: "Germany", clientPartNumber: "G1", clientPartNumberKey: "g1", itemDescription: "x", machineModel: "M", requiredQuotes: 1 },
      { studyId, clientId: tenantId, country: "Germany", clientPartNumber: "G2", clientPartNumberKey: "g2", itemDescription: "x", machineModel: "M", requiredQuotes: 1 },
      { studyId, clientId: tenantId, country: "France", clientPartNumber: "F1", clientPartNumberKey: "f1", itemDescription: "x", machineModel: "M", requiredQuotes: 1 },
    ],
  });
});

afterAll(async () => {
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.client.deleteMany({ where: { id: tenantId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "countries-" } } });
});

describe("listStudyCountries", () => {
  it("returns the study's distinct Countries", async () => {
    const got = await listStudyCountries(em, studyId);
    expect(new Set(got)).toEqual(new Set(["Germany", "France"]));
  });
});
