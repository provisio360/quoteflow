import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Principal } from "@/domains/authz/principal";
import { listBenchmarkItemsForResearcher } from "./repository";

// The researcher-facing item list for a study (#7): the guidance view, grouped
// work, and crucially NO Client Price (ADR-0003) — the type structurally lacks
// it and the query never selects it. Carries primaryResearcherId so the UI can
// show claim / mine / claimed-by-other.

const researcher: Principal = { kind: "internal", userId: "ritems-res", role: "Researcher" };
const stamp = Date.now();
let tenantId: string;
let studyId: string;

beforeAll(async () => {
  const client = await prisma.client.create({ data: { name: `RItems Co ${stamp}` } });
  tenantId = client.id;
  const u = await prisma.user.create({
    data: { id: `ritems-u-${stamp}`, name: "U", email: `ritems-${stamp}@x.com`, kind: "internal", role: "Analyst" },
  });
  const study = await prisma.study.create({
    data: { name: "RItems study", clientId: tenantId, createdById: u.id, qcThresholdPct: 25 },
  });
  studyId = study.id;
  await prisma.benchmarkItem.create({
    data: {
      studyId, clientId: tenantId, country: "Germany", clientPartNumber: "G1", clientPartNumberKey: "g1",
      itemDescription: "widget", machineModel: "M", requiredQuotes: 2,
      clientPrice: "999.0000", // set, but must NOT surface to a researcher
    },
  });
});

afterAll(async () => {
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.client.deleteMany({ where: { id: tenantId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "ritems-" } } });
});

describe("listBenchmarkItemsForResearcher", () => {
  it("returns the study's items, with no Client Price field", async () => {
    const items = await listBenchmarkItemsForResearcher(researcher, studyId);
    const item = items.find((i) => i.clientPartNumber === "G1");
    expect(item).toBeDefined();
    expect(item?.requiredQuotes).toBe(2);
    expect("clientPrice" in (item as object)).toBe(false);
  });
});
