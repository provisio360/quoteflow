import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { listAuditEventsForStudy, AuditAccessError } from "./repository";
import { createStudy } from "@/lib/studies/repository";
import { setClientPrice } from "@/lib/benchmark-items/repository";
import type { ClientPrincipal, InternalPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the audit-log READ path (issue #72 / ADR-0024): the
// internal, per-study view over the Audit Event stream ADR-0019 shipped
// write-only. Gated to Client-Price viewers (Analyst + EM); study-scoped;
// newest-first; capped. Runs via `npm run test:integration`.

const prisma = new PrismaClient();

let tenant: string;
let analyst: InternalPrincipal;
let em: InternalPrincipal;
let researcher: InternalPrincipal;
let admin: InternalPrincipal;
let clientUser: ClientPrincipal;
const userIds: string[] = [];
let studyId: string;

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
  tenant = (await prisma.client.create({ data: { name: "Tenant (audit-read test)" } })).id;
  analyst = await makeUser("Analyst");
  em = await makeUser("EngagementManager");
  researcher = await makeUser("Researcher");
  admin = await makeUser("Admin");
  clientUser = { kind: "client", userId: randomUUID(), tenantId: tenant };
  studyId = (await createStudy(analyst, { name: "Audit study", clientId: tenant, qcThreshold: 0.25 })).id;
});

beforeEach(async () => {
  await prisma.auditEvent.deleteMany({ where: { studyId } });
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { studyId } });
  await prisma.study.deleteMany({ where: { clientId: tenant } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.client.deleteMany({ where: { id: tenant } });
  await prisma.$disconnect();
});

/** Append a raw AuditEvent with a fixed createdAt, for ordering control. */
async function seedEvent(opts: {
  action?: string;
  createdAt?: Date;
  subjectType?: string;
  subjectId?: string;
}) {
  await prisma.auditEvent.create({
    data: {
      action: (opts.action ?? "submit") as never,
      actorId: analyst.userId,
      studyId,
      subjectType: (opts.subjectType ?? "Quote") as never,
      subjectId: opts.subjectId ?? randomUUID(),
      createdAt: opts.createdAt ?? new Date(),
    },
  });
}

describe("listAuditEventsForStudy — the audit-log read path (issue #72)", () => {
  it("returns a study's events newest-first", async () => {
    await seedEvent({ action: "submit", createdAt: new Date("2026-01-01T00:00:00Z") });
    await seedEvent({ action: "approve", createdAt: new Date("2026-01-03T00:00:00Z") });
    await seedEvent({ action: "reject", createdAt: new Date("2026-01-02T00:00:00Z") });

    const events = await listAuditEventsForStudy(analyst, studyId);

    expect(events.map((e) => e.action)).toEqual(["approve", "reject", "submit"]);
  });

  it("returns only the requested study's events, never another study's", async () => {
    const other = await createStudy(analyst, {
      name: "Other study", clientId: tenant, qcThreshold: 0.25,
    });
    await prisma.auditEvent.create({
      data: {
        action: "submit", actorId: analyst.userId, studyId: other.id,
        subjectType: "Quote", subjectId: randomUUID(),
      },
    });
    await seedEvent({ action: "approve" });

    const events = await listAuditEventsForStudy(analyst, studyId);

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("approve");

    await prisma.auditEvent.deleteMany({ where: { studyId: other.id } });
  });
});

describe("listAuditEventsForStudy — authz gate (ADR-0024, TC040)", () => {
  it.each([
    ["an Analyst", () => analyst],
    ["an Engagement Manager", () => em],
  ])("allows %s (they may view Client Price)", async (_label, who) => {
    await expect(listAuditEventsForStudy(who(), studyId)).resolves.toEqual([]);
  });

  it.each([
    ["a Researcher (Client Price is hidden from them, ADR-0003)", () => researcher],
    ["the Admin (user-administration only)", () => admin],
    ["a client user (TC040 — never reachable by clients)", () => clientUser],
  ])("forbids %s", async (_label, who) => {
    await expect(listAuditEventsForStudy(who(), studyId)).rejects.toBeInstanceOf(AuditAccessError);
  });
});

describe("listAuditEventsForStudy — subject label resolution (issue #72 Q2)", () => {
  it("resolves each subject type to its human label, raw id when dangling", async () => {
    const item = await prisma.benchmarkItem.create({
      data: {
        studyId, clientId: tenant, country: "Germany",
        clientItemNumber: "PN-42", clientItemNumberKey: "pn-42",
        itemDescription: "Pump", clientSourceUnit: "X1", requiredQuotes: 3,
      },
    });
    const doc = await prisma.marketQuote.create({
      data: {
        studyId, clientId: tenant, country: "Germany", marketQuoteNumber: 1,
        createdById: researcher.userId,
      },
    });
    const quote = await prisma.quoteLine.create({
      data: {
        marketQuoteId: doc.id, benchmarkItemId: item.id, clientId: tenant,
        studyId, country: "Germany", quoteLineNumber: 7, createdById: researcher.userId,
      },
    });
    const release = await prisma.countryRelease.create({
      data: {
        studyId, clientId: tenant, country: "France",
        state: "released", releasedById: analyst.userId, releasedAt: new Date(),
      },
    });
    const assignment = await prisma.countryAssignment.create({
      data: {
        studyId, clientId: tenant, country: "Spain",
        researcherId: researcher.userId, assignedById: em.userId,
      },
    });
    const danglingId = randomUUID();

    await seedEvent({ subjectType: "QuoteLine", subjectId: quote.id, createdAt: new Date("2026-02-05") });
    await seedEvent({ subjectType: "BenchmarkItem", subjectId: item.id, createdAt: new Date("2026-02-04") });
    await seedEvent({ subjectType: "CountryRelease", subjectId: release.id, createdAt: new Date("2026-02-03") });
    await seedEvent({ subjectType: "CountryAssignment", subjectId: assignment.id, createdAt: new Date("2026-02-02") });
    await seedEvent({ subjectType: "QuoteLine", subjectId: danglingId, createdAt: new Date("2026-02-01") });

    const labels = (await listAuditEventsForStudy(analyst, studyId)).map((e) => e.subjectLabel);

    // researcher's display name is "Researcher" (set in makeUser).
    expect(labels).toEqual([
      "Line 7",
      "PN-42 · Germany",
      "France",
      "Researcher · Spain",
      danglingId,
    ]);

    await prisma.quoteLine.deleteMany({ where: { benchmarkItemId: item.id } });
    await prisma.marketQuote.deleteMany({ where: { id: doc.id } });
    await prisma.benchmarkItem.deleteMany({ where: { id: item.id } });
    await prisma.countryRelease.deleteMany({ where: { id: release.id } });
    await prisma.countryAssignment.deleteMany({ where: { id: assignment.id } });
  });
});

describe("listAuditEventsForStudy — before/after monetary pair (issue #72 Q3)", () => {
  it("surfaces the before/after pair for a clientPriceChange, null for actions without one", async () => {
    await prisma.auditEvent.create({
      data: {
        action: "clientPriceChange", actorId: analyst.userId, studyId,
        subjectType: "BenchmarkItem", subjectId: randomUUID(),
        beforeValue: 1000, afterValue: 1500, createdAt: new Date("2026-03-02"),
      },
    });
    await seedEvent({ action: "submit", createdAt: new Date("2026-03-01") });

    const [change, submit] = await listAuditEventsForStudy(analyst, studyId);

    expect(change.action).toBe("clientPriceChange");
    expect(change.beforeValue).toBe(1000);
    expect(change.afterValue).toBe(1500);
    expect(submit.action).toBe("submit");
    expect(submit.beforeValue).toBeNull();
    expect(submit.afterValue).toBeNull();
  });
});

describe("listAuditEventsForStudy — end-to-end (issue #72: perform, then read back)", () => {
  it("reads back a real Client Price change with its label and before/after", async () => {
    const item = await prisma.benchmarkItem.create({
      data: {
        studyId, clientId: tenant, country: "Italy",
        clientItemNumber: "PN-99", clientItemNumberKey: "pn-99",
        itemDescription: "Valve", clientSourceUnit: "Z9", requiredQuotes: 2, clientPrice: 1000,
      },
    });

    await setClientPrice(analyst, item.id, 1750);

    const events = await listAuditEventsForStudy(analyst, studyId);
    const change = events.find((e) => e.action === "clientPriceChange");
    expect(change).toBeDefined();
    expect(change!.actorName).toBe("Analyst");
    expect(change!.subjectType).toBe("BenchmarkItem");
    expect(change!.subjectLabel).toBe("PN-99 · Italy");
    expect(change!.beforeValue).toBe(1000);
    expect(change!.afterValue).toBe(1750);

    await prisma.benchmarkItem.deleteMany({ where: { id: item.id } });
  });
});

describe("listAuditEventsForStudy — cap (issue #72 Q6 / ADR-0024)", () => {
  it("returns at most the 200 most-recent events", async () => {
    const base = new Date("2026-04-01T00:00:00Z").getTime();
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 201 }, (_, i) => ({
        action: "submit" as const, actorId: analyst.userId, studyId,
        subjectType: "Quote" as const, subjectId: randomUUID(),
        createdAt: new Date(base + i * 60_000),
      })),
    });

    const events = await listAuditEventsForStudy(analyst, studyId);

    expect(events).toHaveLength(200);
    // Newest-first + capped → the single oldest event (i=0) is the one dropped.
    const oldest = new Date(base).getTime();
    expect(events.every((e) => e.createdAt.getTime() > oldest)).toBe(true);
  });
});
