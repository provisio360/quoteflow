import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  setClientPrice,
  listBenchmarkItemsForAnalyst,
  BenchmarkItemAccessError,
} from "./repository";
import { createStudy } from "@/lib/studies/repository";
import type { ClientPrincipal, InternalPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the analyst's in-app Client Price maintenance (issue
// #12 / ADR-0015): an Analyst may set or clear it; everyone else is refused, and
// the refusal leaves the value untouched. Runs via `npm run test:integration`.

const prisma = new PrismaClient();

let tenant: string;
let analyst: InternalPrincipal;
let em: InternalPrincipal;
let researcher: InternalPrincipal;
let clientUser: ClientPrincipal;
const userIds: string[] = [];
let studyId: string;
let itemId: string;

async function makeUser(role: InternalPrincipal["role"]): Promise<InternalPrincipal> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id, name: role, email: `${role}-${id}@example.test`,
      emailVerified: true, kind: "internal", role, status: "active",
    },
  });
  userIds.push(id);
  return { kind: "internal", userId: id, role };
}

beforeAll(async () => {
  tenant = (await prisma.client.create({ data: { name: "Tenant (set-cp test)" } })).id;
  analyst = await makeUser("Analyst");
  em = await makeUser("EngagementManager");
  researcher = await makeUser("Researcher");
  clientUser = { kind: "client", userId: randomUUID(), tenantId: tenant };
  studyId = (await createStudy(analyst, { name: "CP study", clientId: tenant, qcThresholdPct: 25 })).id;
});

beforeEach(async () => {
  // A fresh item seeded with a brief Client Price of 1000 before each test.
  await prisma.benchmarkItem.deleteMany({ where: { studyId } });
  itemId = (await prisma.benchmarkItem.create({
    data: {
      studyId, country: "Germany", clientPartNumber: "PN-1", clientPartNumberKey: "pn-1",
      itemDescription: "Pump", machineModel: "X1", requiredQuotes: 3, clientPrice: 1000,
    },
  })).id;
});

afterAll(async () => {
  await prisma.benchmarkItem.deleteMany({ where: { studyId } });
  await prisma.study.deleteMany({ where: { clientId: tenant } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.client.deleteMany({ where: { id: tenant } });
  await prisma.$disconnect();
});

const priceOf = async (id: string) =>
  Number((await prisma.benchmarkItem.findUnique({ where: { id } }))?.clientPrice);

describe("setClientPrice — Analyst maintenance (ADR-0015)", () => {
  it("lets an Analyst change the Client Price", async () => {
    const result = await setClientPrice(analyst, itemId, 1500);
    expect(result).toEqual({ clientPrice: 1500 });
    expect(await priceOf(itemId)).toBe(1500);
  });

  it("lets an Analyst clear the Client Price (item becomes unpriced)", async () => {
    const result = await setClientPrice(analyst, itemId, null);
    expect(result).toEqual({ clientPrice: null });
    const stored = await prisma.benchmarkItem.findUnique({ where: { id: itemId } });
    expect(stored?.clientPrice).toBeNull();
  });
});

describe("setClientPrice — authorization (Analyst only, ADR-0003)", () => {
  it("forbids an Engagement Manager and leaves the value untouched", async () => {
    await expect(setClientPrice(em, itemId, 1500)).rejects.toBeInstanceOf(BenchmarkItemAccessError);
    expect(await priceOf(itemId)).toBe(1000);
  });

  it("forbids a Researcher (Client Price is hidden from them)", async () => {
    await expect(setClientPrice(researcher, itemId, 1500)).rejects.toBeInstanceOf(BenchmarkItemAccessError);
    expect(await priceOf(itemId)).toBe(1000);
  });

  it("forbids a client user (viewer-only)", async () => {
    await expect(setClientPrice(clientUser, itemId, 1500)).rejects.toBeInstanceOf(BenchmarkItemAccessError);
    expect(await priceOf(itemId)).toBe(1000);
  });

  it("rejects an unknown item id", async () => {
    await expect(setClientPrice(analyst, "nonexistent", 1500)).rejects.toBeInstanceOf(BenchmarkItemAccessError);
  });
});

describe("listBenchmarkItemsForAnalyst — the QC list surface (Analyst only)", () => {
  it("returns the study's items with Client Price for an Analyst", async () => {
    const items = await listBenchmarkItemsForAnalyst(analyst, studyId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: itemId,
      country: "Germany",
      clientPartNumber: "PN-1",
      requiredQuotes: 3,
      clientPrice: 1000,
    });
  });

  it("reports a null Client Price for an unpriced item", async () => {
    await setClientPrice(analyst, itemId, null);
    const items = await listBenchmarkItemsForAnalyst(analyst, studyId);
    expect(items[0].clientPrice).toBeNull();
  });

  it.each([
    ["an Engagement Manager", () => em],
    ["a Researcher", () => researcher],
    ["a client user", () => clientUser],
  ])("forbids %s (Client Price is Analyst-only, ADR-0003)", async (_label, who) => {
    await expect(listBenchmarkItemsForAnalyst(who(), studyId)).rejects.toBeInstanceOf(
      BenchmarkItemAccessError,
    );
  });
});
