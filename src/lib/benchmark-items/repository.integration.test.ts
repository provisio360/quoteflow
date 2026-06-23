import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { importBenchmarkItems, setClientPrice, BenchmarkItemAccessError } from "./repository";
import { createStudy } from "@/lib/studies/repository";
import type { ClientPrincipal, InternalPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the import upsert (ADR-0009) and its all-or-nothing
// persistence: a failed validation must leave the study untouched. Runs via
// `npm run test:integration`.

const prisma = new PrismaClient();

const HEADERS = [
  "Country", "Client Item Number", "Item Description", "Configuration Comment",
  "Quantity", "Client Source Unit", "Required Quotes",
  "Price Difference Threshold", "Required Competitor 1",
  "Client Item Price", "Client Item Price Currency", "Client Item Price Quantity",
];
const row = (over: Partial<Record<string, string>> = {}) => {
  const base: Record<string, string> = {
    Country: "Germany", "Client Item Number": "PN-100", "Item Description": "Pump",
    "Configuration Comment": "", Quantity: "10", "Client Source Unit": "X1",
    "Required Quotes": "3", "Price Difference Threshold": "0.2", "Required Competitor 1": "Bosch",
    // Trio derives clientPrice = 1000 / 1 = 1000, so the legacy assertions hold.
    "Client Item Price": "1000", "Client Item Price Currency": "USD", "Client Item Price Quantity": "1",
  };
  return HEADERS.map((h) => ({ ...base, ...over })[h] ?? "");
};

let tenant: string;
let emUserId: string;
let analystUserId: string;
let studyId: string;
let em: InternalPrincipal;
let analyst: InternalPrincipal;
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
  analystUserId = randomUUID();
  await prisma.user.create({
    data: {
      id: analystUserId, name: "Analyst", email: `analyst-${analystUserId}@example.test`,
      emailVerified: true, kind: "internal", role: "Analyst", status: "active",
    },
  });
  analyst = { kind: "internal", userId: analystUserId, role: "Analyst" };
  clientUser = { kind: "client", userId: randomUUID(), tenantId: tenant };
  studyId = (await createStudy(em, { name: "Import study", clientId: tenant, qcThreshold: 0.25 })).id;
});

afterAll(async () => {
  // Imports now write audit events (issue #16) pinning the actor; clear them
  // before the user they reference (onDelete: Restrict).
  await prisma.auditEvent.deleteMany({ where: { studyId } });
  await prisma.benchmarkItem.deleteMany({ where: { studyId } });
  await prisma.study.deleteMany({ where: { clientId: tenant } });
  await prisma.user.deleteMany({ where: { id: { in: [emUserId, analystUserId] } } });
  await prisma.client.deleteMany({ where: { id: tenant } });
  await prisma.$disconnect();
});

describe("importBenchmarkItems — upsert (ADR-0009)", () => {
  it("inserts new items on a valid first import", async () => {
    const grid = [HEADERS, row({ "Client Item Number": "PN-100" }), row({ "Client Item Number": "PN-200" })];
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
      row({ "Client Item Number": "PN-100", "Client Item Price": "1500", "Item Description": "Pump v2" }),
      row({ "Client Item Number": "PN-300" }),
    ];
    const result = await importBenchmarkItems(em, studyId, grid);

    expect(result).toEqual({ ok: true, inserted: 1, updated: 1 });
    const pn100 = await prisma.benchmarkItem.findFirst({
      where: { studyId, clientItemNumberKey: "pn-100" },
    });
    expect(Number(pn100?.clientPrice)).toBe(1000); // preserved — re-import never writes it
    expect(pn100?.itemDescription).toBe("Pump v2"); // other brief fields DO overwrite
    // PN-200 (absent from this file) still present — import never deletes.
    expect(await prisma.benchmarkItem.findFirst({ where: { studyId, clientItemNumberKey: "pn-200" } })).not.toBeNull();
    expect(await prisma.benchmarkItem.count({ where: { studyId } })).toBe(3);
  });

  it("writes NOTHING when the file is invalid (all-or-nothing persistence)", async () => {
    const before = await prisma.benchmarkItem.count({ where: { studyId } });
    const grid = [
      HEADERS,
      row({ "Client Item Number": "PN-100", "Client Item Price": "9999" }), // would-be update
      row({ "Client Item Number": "PN-999", Country: "Atlantis" }), // invalid
    ];
    const result = await importBenchmarkItems(em, studyId, grid);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ row: 3, field: "country" }));
    // The valid would-be update must NOT have been applied.
    const pn100 = await prisma.benchmarkItem.findFirst({ where: { studyId, clientItemNumberKey: "pn-100" } });
    expect(Number(pn100?.clientPrice)).toBe(1000); // unchanged: re-import never writes Client Price
    expect(await prisma.benchmarkItem.count({ where: { studyId } })).toBe(before);
  });
});

describe("importBenchmarkItems — extended #86 columns persist", () => {
  it("persists the new descriptive columns, per-item threshold, competitors, and the derived Client Price + seed trio", async () => {
    const grid = [
      HEADERS,
      row({
        "Client Item Number": "EXT-1",
        "Client Source Unit": "BRC8T450X",
        "Price Difference Threshold": "0.15",
        "Required Competitor 1": "Bosch",
        "Client Item Price": "250",
        "Client Item Price Currency": "USD",
        "Client Item Price Quantity": "5",
      }),
    ];
    const result = await importBenchmarkItems(em, studyId, grid);
    expect(result.ok).toBe(true);

    const item = await prisma.benchmarkItem.findFirst({ where: { studyId, clientItemNumberKey: "ext-1" } });
    expect(item?.clientSourceUnit).toBe("BRC8T450X");
    expect(Number(item?.qcThreshold)).toBe(0.15); // stored as a fraction
    expect(item?.requiredCompetitors).toEqual(["Bosch"]);
    expect(Number(item?.clientPrice)).toBe(50); // derived USD/unit = 250 / 5
    expect(Number(item?.clientItemPrice)).toBe(250); // raw seed retained
    expect(item?.clientItemPriceCurrency).toBe("USD");
    expect(Number(item?.clientItemPriceQuantity)).toBe(5);
  });

  it("freezes the WHOLE Client Price group on re-import — derived value and seed trio (ADR-0027)", async () => {
    // First import seeds 250/5 -> clientPrice 50.
    await importBenchmarkItems(em, studyId, [
      HEADERS,
      row({ "Client Item Number": "FRZ-1", "Client Item Price": "250", "Client Item Price Quantity": "5" }),
    ]);
    // Re-import with a DIFFERENT trio and a changed brief field.
    await importBenchmarkItems(em, studyId, [
      HEADERS,
      row({
        "Client Item Number": "FRZ-1",
        "Item Description": "Renamed",
        "Client Item Price": "999",
        "Client Item Price Quantity": "3",
      }),
    ]);

    const item = await prisma.benchmarkItem.findFirst({ where: { studyId, clientItemNumberKey: "frz-1" } });
    expect(item?.itemDescription).toBe("Renamed"); // ordinary brief field overwrites
    expect(Number(item?.clientPrice)).toBe(50); // derived value frozen
    expect(Number(item?.clientItemPrice)).toBe(250); // seed trio frozen too
    expect(Number(item?.clientItemPriceQuantity)).toBe(5);
  });
});

describe("importBenchmarkItems — seeds Client Price onto a truly-unpriced item (ADR-0030)", () => {
  it("re-import seeds Client Price when the existing item is unpriced (null clientPrice AND null trio)", async () => {
    // First import creates the item with a BLANK price trio -> unpriced.
    await importBenchmarkItems(em, studyId, [
      HEADERS,
      row({
        "Client Item Number": "SEED-1",
        "Client Item Price": "",
        "Client Item Price Currency": "",
        "Client Item Price Quantity": "",
      }),
    ]);
    const created = await prisma.benchmarkItem.findFirst({ where: { studyId, clientItemNumberKey: "seed-1" } });
    expect(created?.clientPrice).toBeNull();
    expect(created?.clientItemPrice).toBeNull();

    // Re-import the SAME item, now carrying a price -> the update path seeds it.
    await importBenchmarkItems(em, studyId, [
      HEADERS,
      row({
        "Client Item Number": "SEED-1",
        "Client Item Price": "300",
        "Client Item Price Currency": "USD",
        "Client Item Price Quantity": "3",
      }),
    ]);
    const seeded = await prisma.benchmarkItem.findFirst({ where: { studyId, clientItemNumberKey: "seed-1" } });
    expect(Number(seeded?.clientPrice)).toBe(100); // derived USD/unit = 300 / 3, seeded on update
    expect(Number(seeded?.clientItemPrice)).toBe(300); // raw seed trio written too
    expect(Number(seeded?.clientItemPriceQuantity)).toBe(3);
  });

  it("does NOT resurrect a price the analyst CLEARED (null clientPrice but trio still present)", async () => {
    // Insert priced, then the analyst clears it: clientPrice -> null, but the
    // seed trio remains (setClientPrice clears only the derived value). That is
    // "cleared", NOT "never priced" — a re-import must leave it alone.
    await importBenchmarkItems(em, studyId, [
      HEADERS,
      row({ "Client Item Number": "CLR-1", "Client Item Price": "400", "Client Item Price Quantity": "2" }),
    ]);
    const priced = await prisma.benchmarkItem.findFirst({ where: { studyId, clientItemNumberKey: "clr-1" } });
    await setClientPrice(analyst, priced!.id, null);
    const cleared = await prisma.benchmarkItem.findFirst({ where: { studyId, clientItemNumberKey: "clr-1" } });
    expect(cleared?.clientPrice).toBeNull();
    expect(Number(cleared?.clientItemPrice)).toBe(400); // trio survives the clear

    // Re-import carrying a price -> must NOT seed; the cleared state is preserved.
    await importBenchmarkItems(em, studyId, [
      HEADERS,
      row({ "Client Item Number": "CLR-1", "Client Item Price": "999", "Client Item Price Quantity": "3" }),
    ]);
    const after = await prisma.benchmarkItem.findFirst({ where: { studyId, clientItemNumberKey: "clr-1" } });
    expect(after?.clientPrice).toBeNull(); // cleared value preserved (ADR-0030)
    expect(Number(after?.clientItemPrice)).toBe(400); // original trio frozen, not overwritten by 999
  });

  it("audits a seed-on-update as a Client Price change (null -> value), alongside the import event", async () => {
    const priceEvents = () =>
      prisma.auditEvent.findMany({ where: { studyId, action: "clientPriceChange" } });

    // Create unpriced, then re-import with a price so it is seeded on update.
    await importBenchmarkItems(em, studyId, [
      HEADERS,
      row({ "Client Item Number": "AUD-1", "Client Item Price": "", "Client Item Price Currency": "", "Client Item Price Quantity": "" }),
    ]);
    const before = (await priceEvents()).length;
    await importBenchmarkItems(em, studyId, [
      HEADERS,
      row({ "Client Item Number": "AUD-1", "Client Item Price": "500", "Client Item Price Currency": "USD", "Client Item Price Quantity": "5" }),
    ]);

    const item = await prisma.benchmarkItem.findFirst({ where: { studyId, clientItemNumberKey: "aud-1" } });
    const events = await priceEvents();
    expect(events.length - before).toBe(1);
    const seedEvent = events.find((e) => e.subjectId === item!.id);
    expect(seedEvent?.beforeValue).toBeNull();
    expect(Number(seedEvent?.afterValue)).toBe(100); // 500 / 5
  });

  it("logs NO Client Price change when the brief is also unpriced for the row (null -> null)", async () => {
    const priceEvents = () => prisma.auditEvent.count({ where: { studyId, action: "clientPriceChange" } });

    await importBenchmarkItems(em, studyId, [
      HEADERS,
      row({ "Client Item Number": "NOOP-1", "Client Item Price": "", "Client Item Price Currency": "", "Client Item Price Quantity": "" }),
    ]);
    const before = await priceEvents();
    // Re-import the same item still unpriced -> null stays null, nothing to audit.
    await importBenchmarkItems(em, studyId, [
      HEADERS,
      row({ "Client Item Number": "NOOP-1", "Item Description": "Renamed", "Client Item Price": "", "Client Item Price Currency": "", "Client Item Price Quantity": "" }),
    ]);

    expect(await priceEvents()).toBe(before);
    const item = await prisma.benchmarkItem.findFirst({ where: { studyId, clientItemNumberKey: "noop-1" } });
    expect(item?.itemDescription).toBe("Renamed"); // brief field still overwrote
    expect(item?.clientPrice).toBeNull();
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

describe("importBenchmarkItems — audit recording, per affected row (issue #16 / ADR-0019)", () => {
  const importEvents = () =>
    prisma.auditEvent.findMany({ where: { studyId, action: "import" } });

  it("records one import event per inserted item, on the item as subject", async () => {
    const before = (await importEvents()).length;
    await importBenchmarkItems(em, studyId, [
      HEADERS,
      row({ "Client Item Number": "PN-700" }),
      row({ "Client Item Number": "PN-800" }),
    ]);
    const events = await importEvents();
    expect(events.length - before).toBe(2);

    const inserted = await prisma.benchmarkItem.findMany({
      where: { studyId, clientItemNumberKey: { in: ["pn-700", "pn-800"] } },
      select: { id: true },
    });
    const subjects = new Set(events.map((e) => e.subjectId));
    for (const item of inserted) expect(subjects.has(item.id)).toBe(true);
    expect(events.every((e) => e.subjectType === "BenchmarkItem" && e.actorId === em.userId)).toBe(true);
  });

  it("records one import event per updated item on re-import (a row was written)", async () => {
    const before = (await importEvents()).length;
    await importBenchmarkItems(em, studyId, [HEADERS, row({ "Client Item Number": "PN-700" })]);
    expect((await importEvents()).length - before).toBe(1);
  });

  it("writes no audit event when the file is invalid (all-or-nothing)", async () => {
    const before = await prisma.auditEvent.count({ where: { studyId } });
    const result = await importBenchmarkItems(em, studyId, [
      HEADERS,
      row({ "Client Item Number": "PN-700" }), // valid would-be update
      row({ "Client Item Number": "PN-901", Country: "Atlantis" }), // invalid
    ]);
    expect(result.ok).toBe(false);
    expect(await prisma.auditEvent.count({ where: { studyId } })).toBe(before);
  });
});
