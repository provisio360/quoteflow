import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { importBenchmarkItems, BenchmarkItemAccessError } from "./repository";
import { createStudy } from "@/lib/studies/repository";
import type { ClientPrincipal, InternalPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the import upsert (ADR-0009) and its all-or-nothing
// persistence: a failed validation must leave the study untouched. Runs via
// `npm run test:integration`.

const prisma = new PrismaClient();

const HEADERS = [
  "Country", "Client Part Number", "Item Description", "Configuration Comment",
  "Quantity", "Machine/Model", "Required Quotes", "Client Price",
];
const row = (over: Partial<Record<string, string>> = {}) => {
  const base: Record<string, string> = {
    Country: "Germany", "Client Part Number": "PN-100", "Item Description": "Pump",
    "Configuration Comment": "", Quantity: "10", "Machine/Model": "X1",
    "Required Quotes": "3", "Client Price": "1000",
  };
  return HEADERS.map((h) => ({ ...base, ...over })[h]!);
};

let tenant: string;
let emUserId: string;
let studyId: string;
let em: InternalPrincipal;
let clientUser: ClientPrincipal;

beforeAll(async () => {
  const c = await prisma.client.create({ data: { name: "Tenant (import test)" } });
  tenant = c.id;
  emUserId = randomUUID();
  await prisma.user.create({
    data: {
      id: emUserId, name: "EM", email: `em-${emUserId}@example.test`,
      emailVerified: true, kind: "internal", role: "EngagementManager", status: "active",
    },
  });
  em = { kind: "internal", userId: emUserId, role: "EngagementManager" };
  clientUser = { kind: "client", userId: randomUUID(), tenantId: tenant };
  studyId = (await createStudy(em, { name: "Import study", clientId: tenant, qcThresholdPct: 25 })).id;
});

afterAll(async () => {
  await prisma.benchmarkItem.deleteMany({ where: { studyId } });
  await prisma.study.deleteMany({ where: { clientId: tenant } });
  await prisma.user.deleteMany({ where: { id: emUserId } });
  await prisma.client.deleteMany({ where: { id: tenant } });
  await prisma.$disconnect();
});

describe("importBenchmarkItems — upsert (ADR-0009)", () => {
  it("inserts new items on a valid first import", async () => {
    const grid = [HEADERS, row({ "Client Part Number": "PN-100" }), row({ "Client Part Number": "PN-200" })];
    const result = await importBenchmarkItems(em, studyId, grid);

    expect(result).toEqual({ ok: true, inserted: 2, updated: 0 });
    const items = await prisma.benchmarkItem.findMany({ where: { studyId } });
    expect(items).toHaveLength(2);
  });

  it("re-import overwrites brief fields but PRESERVES Client Price (analyst-owned, ADR-0015)", async () => {
    // PN-100 exists -> update: Item Description overwrites, but Client Price is
    // NOT touched by re-import (stays 1000 despite the sheet saying 1500).
    // PN-200 absent -> untouched; PN-300 new -> insert.
    const grid = [
      HEADERS,
      row({ "Client Part Number": "PN-100", "Client Price": "1500", "Item Description": "Pump v2" }),
      row({ "Client Part Number": "PN-300" }),
    ];
    const result = await importBenchmarkItems(em, studyId, grid);

    expect(result).toEqual({ ok: true, inserted: 1, updated: 1 });
    const pn100 = await prisma.benchmarkItem.findFirst({
      where: { studyId, clientPartNumberKey: "pn-100" },
    });
    expect(Number(pn100?.clientPrice)).toBe(1000); // preserved — re-import never writes it
    expect(pn100?.itemDescription).toBe("Pump v2"); // other brief fields DO overwrite
    // PN-200 (absent from this file) still present — import never deletes.
    expect(await prisma.benchmarkItem.findFirst({ where: { studyId, clientPartNumberKey: "pn-200" } })).not.toBeNull();
    expect(await prisma.benchmarkItem.count({ where: { studyId } })).toBe(3);
  });

  it("writes NOTHING when the file is invalid (all-or-nothing persistence)", async () => {
    const before = await prisma.benchmarkItem.count({ where: { studyId } });
    const grid = [
      HEADERS,
      row({ "Client Part Number": "PN-100", "Client Price": "9999" }), // would-be update
      row({ "Client Part Number": "PN-999", Country: "Atlantis" }), // invalid
    ];
    const result = await importBenchmarkItems(em, studyId, grid);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ row: 3, field: "country" }));
    // The valid would-be update must NOT have been applied.
    const pn100 = await prisma.benchmarkItem.findFirst({ where: { studyId, clientPartNumberKey: "pn-100" } });
    expect(Number(pn100?.clientPrice)).toBe(1000); // unchanged: re-import never writes Client Price
    expect(await prisma.benchmarkItem.count({ where: { studyId } })).toBe(before);
  });
});

describe("importBenchmarkItems — authorization", () => {
  it("forbids a client user (viewer-only)", async () => {
    await expect(importBenchmarkItems(clientUser, studyId, [HEADERS, row()])).rejects.toBeInstanceOf(
      BenchmarkItemAccessError,
    );
  });

  it("rejects an unknown study id", async () => {
    await expect(importBenchmarkItems(em, "nonexistent", [HEADERS, row()])).rejects.toBeInstanceOf(
      BenchmarkItemAccessError,
    );
  });
});
