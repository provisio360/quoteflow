import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { InternalPrincipal } from "@/domains/authz/principal";
import { listBenchmarkItemsForResearcher } from "./repository";
import { listStudies, getStudyDetail } from "@/lib/studies/repository";

// The Researcher assigned-Country read scope (ADR-0025 / #62), proven against a
// live Postgres: a Researcher's reads are confined to the (study, country) pairs
// they hold a Country Assignment in. Studies they have no pair in are not-found;
// within an assigned study, only assigned-country items are loaded (the old
// "locked" cross-boundary row is gone). EM is unaffected (full `all`).

const stamp = Date.now();

// R1 is assigned to (S1, France) only. R0 has no assignments at all (fails closed).
const r1: InternalPrincipal = { kind: "internal", userId: `rscope-r1-${stamp}`, role: "Researcher" };
const r0: InternalPrincipal = { kind: "internal", userId: `rscope-r0-${stamp}`, role: "Researcher" };
const em: InternalPrincipal = { kind: "internal", userId: `rscope-em-${stamp}`, role: "EngagementManager" };

let tenantId: string;
let s1: string;
let s2: string;

async function seedUser(p: InternalPrincipal, name: string) {
  await prisma.user.create({
    data: { id: p.userId, name, email: `${p.userId}@x.com`, kind: "internal", role: p.role, status: "active" },
  });
}

async function seedItem(studyId: string, country: string, cpn: string) {
  await prisma.benchmarkItem.create({
    data: {
      studyId, clientId: tenantId, country, clientPartNumber: cpn, clientPartNumberKey: cpn.toLowerCase(),
      itemDescription: "widget", machineModel: "M", requiredQuotes: 1,
    },
  });
}

beforeAll(async () => {
  const client = await prisma.client.create({ data: { name: `RScope Co ${stamp}` } });
  tenantId = client.id;
  await seedUser(em, "EM");
  await seedUser(r1, "R1");
  await seedUser(r0, "R0");

  const study1 = await prisma.study.create({
    data: { name: "RScope S1", clientId: tenantId, createdById: em.userId, qcThresholdPct: 25 },
  });
  const study2 = await prisma.study.create({
    data: { name: "RScope S2", clientId: tenantId, createdById: em.userId, qcThresholdPct: 25 },
  });
  s1 = study1.id;
  s2 = study2.id;

  // S1 has France + Germany items; S2 has Spain items.
  await seedItem(s1, "France", "S1F1");
  await seedItem(s1, "Germany", "S1G1");
  await seedItem(s2, "Spain", "S2E1");

  // R1 is assigned to (S1, France) ONLY — not S1/Germany, not S2 at all.
  await prisma.countryAssignment.create({
    data: { studyId: s1, clientId: tenantId, country: "France", researcherId: r1.userId, assignedById: em.userId },
  });
});

afterAll(async () => {
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.client.deleteMany({ where: { id: tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: [em.userId, r1.userId, r0.userId] } } });
});

describe("Researcher study-list scope (ADR-0025)", () => {
  it("a Researcher sees only studies they hold >=1 Country Assignment in", async () => {
    const ids = (await listStudies(r1)).map((s) => s.id);
    expect(ids).toContain(s1);
    expect(ids).not.toContain(s2);
  });

  it("a Researcher with NO assignments sees no studies (fails closed, never everything)", async () => {
    expect(await listStudies(r0)).toHaveLength(0);
  });

  it("an Engagement Manager still sees every study (unaffected)", async () => {
    const ids = (await listStudies(em)).map((s) => s.id);
    expect(ids).toContain(s1);
    expect(ids).toContain(s2);
  });
});

describe("Researcher item scope — only assigned countries are loaded", () => {
  it("within an assigned study, only the assigned Country's items are returned (no 'locked' Germany row)", async () => {
    const items = await listBenchmarkItemsForResearcher(r1, s1);
    const countries = items.map((i) => i.country);
    expect(countries).toContain("France");
    expect(countries).not.toContain("Germany");
  });

  it("a Researcher loads nothing from a study they have no assignment in", async () => {
    expect(await listBenchmarkItemsForResearcher(r1, s2)).toHaveLength(0);
  });

  it("an Engagement Manager loads all of a study's items (unaffected)", async () => {
    const countries = (await listBenchmarkItemsForResearcher(em, s1)).map((i) => i.country);
    expect(countries).toContain("France");
    expect(countries).toContain("Germany");
  });
});

describe("Researcher study-detail scope", () => {
  it("returns the study for one the Researcher is assigned in", async () => {
    expect((await getStudyDetail(r1, s1))?.id).toBe(s1);
  });

  it("returns null (-> notFound) for a study the Researcher has no assignment in", async () => {
    expect(await getStudyDetail(r1, s2)).toBeNull();
  });

  it("an Engagement Manager sees detail for any study (unaffected)", async () => {
    expect((await getStudyDetail(em, s2))?.id).toBe(s2);
  });
});
