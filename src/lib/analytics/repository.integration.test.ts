import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type QuoteState } from "@prisma/client";
import {
  getStudyDashboard,
  getStudyBenchmarkComparison,
  AnalyticsAccessError,
} from "./repository";
import { createStudy } from "@/lib/studies/repository";
import { releaseCountry, reopenCountry } from "@/lib/release/repository";
import type { InternalPrincipal, ClientPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the client dashboards (#14). The Competitor Price Range
// maths is unit-tested in src/domains/analytics; this suite proves the gates the
// pure core can't: dashboards aggregate ONLY released + approved quotes (a
// Draft/Submitted/Rejected quote, and an approved quote in an unreleased or
// reopened country, never count), tenant isolation on the client read, and that
// the internal benchmark comparison (View D) carries Client Price for internal
// staff but is refused to a Client User (ADR-0003). Runs via
// `npm run test:integration`.

const prisma = new PrismaClient();

let clientA: string;
let clientB: string;
let analyst: InternalPrincipal;
let researcher: InternalPrincipal;
let clientUserA: ClientPrincipal;
let studyA: string;
let studyB: string;

async function seedUser(role: InternalPrincipal["role"]): Promise<InternalPrincipal> {
  const id = randomUUID();
  await prisma.user.create({
    data: { id, name: role, email: `${role}-${id}@example.test`, emailVerified: true, kind: "internal", role, status: "active" },
  });
  return { kind: "internal", userId: id, role };
}

async function seedClientUser(tenantId: string): Promise<ClientPrincipal> {
  const id = randomUUID();
  await prisma.user.create({
    data: { id, name: "client-user", email: `cu-${id}@example.test`, emailVerified: true, kind: "client", tenantId, status: "active" },
  });
  return { kind: "client", userId: id, tenantId };
}

/** A quote spec for seeding: its state, competitor brand, and USD price-per-unit
 *  (null = an approved quote with no per-unit figure, excluded from the range). */
interface QuoteSpec {
  state: QuoteState;
  competitorBrand: string | null;
  usdPricePerUnit: string | null;
}

async function seedItem(
  studyId: string,
  country: string,
  clientPartNumber: string,
  requiredQuotes: number,
  clientPrice: string | null,
  quotes: QuoteSpec[],
): Promise<void> {
  const { clientId } = await prisma.study.findUniqueOrThrow({
    where: { id: studyId },
    select: { clientId: true },
  });
  const item = await prisma.benchmarkItem.create({
    data: {
      studyId,
      clientId,
      country,
      clientPartNumber,
      clientPartNumberKey: randomUUID().slice(0, 8),
      itemDescription: `${clientPartNumber} part`,
      machineModel: "M1",
      requiredQuotes,
      clientPrice,
    },
  });
  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    const approved = q.state === "Approved";
    await prisma.quote.create({
      data: {
        benchmarkItemId: item.id,
        clientId,
        quoteNumber: i + 1,
        state: q.state,
        createdById: researcher.userId,
        competitorBrand: q.competitorBrand,
        dealerName: "Acme",
        price: "1000.0000",
        currency: "USD",
        quantityQuoted: 1,
        ...(approved
          ? {
              conversionStatus: "auto",
              exchangeRate: "1.00000000",
              rateDate: new Date("2026-06-01"),
              convertedUsdPrice: q.usdPricePerUnit,
              convertedUsdPricePerUnit: q.usdPricePerUnit,
              reviewedById: analyst.userId,
              reviewedAt: new Date(),
            }
          : {}),
      },
    });
  }
}

beforeAll(async () => {
  clientA = (await prisma.client.create({ data: { name: "Tenant A" } })).id;
  clientB = (await prisma.client.create({ data: { name: "Tenant B" } })).id;

  analyst = await seedUser("Analyst");
  researcher = await seedUser("Researcher");
  clientUserA = await seedClientUser(clientA);

  studyA = (await createStudy(analyst, { name: "Study A", clientId: clientA, qcThresholdPct: 25 })).id;
  studyB = (await createStudy(analyst, { name: "Study B", clientId: clientB, qcThresholdPct: 25 })).id;

  // Germany (will be RELEASED):
  //  PN-G1 — Client Price 1000; approved Caterpillar x2 (1100, 1300) + Komatsu (900),
  //          plus a Rejected quote that must NOT count. (A Draft/Submitted quote
  //          can't coexist here: in-flight work blocks release; only Approved and
  //          Rejected survive into a released country.)
  await seedItem(studyA, "Germany", "PN-G1", 1, "1000.0000", [
    { state: "Approved", competitorBrand: "Caterpillar", usdPricePerUnit: "1100.0000" },
    { state: "Approved", competitorBrand: "Caterpillar", usdPricePerUnit: "1300.0000" },
    { state: "Approved", competitorBrand: "Komatsu", usdPricePerUnit: "900.0000" },
    { state: "Rejected", competitorBrand: "Caterpillar", usdPricePerUnit: null },
  ]);
  //  PN-G2 — no Client Price, Required 0, zero quotes: a released no-data row.
  await seedItem(studyA, "Germany", "PN-G2", 0, null, []);

  // France (NOT released) — an approved quote that must never reach the client.
  await seedItem(studyA, "France", "PN-F1", 1, "500.0000", [
    { state: "Approved", competitorBrand: "Caterpillar", usdPricePerUnit: "500.0000" },
  ]);

  // Spain (released THEN reopened) — approved quote must be excluded once reopened.
  await seedItem(studyA, "Spain", "PN-S1", 1, "700.0000", [
    { state: "Approved", competitorBrand: "Caterpillar", usdPricePerUnit: "700.0000" },
  ]);

  // Study B (other tenant) — a released country, for isolation checks.
  await seedItem(studyB, "Italy", "PN-I1", 1, "800.0000", [
    { state: "Approved", competitorBrand: "Caterpillar", usdPricePerUnit: "800.0000" },
  ]);

  await releaseCountry(analyst, studyA, "Germany");
  await releaseCountry(analyst, studyA, "Spain");
  await reopenCountry(analyst, studyA, "Spain");
  await releaseCountry(analyst, studyB, "Italy");
}, 30_000);

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { studyId: { in: [studyA, studyB] } } });
  await prisma.auditEvent.deleteMany({ where: { studyId: { in: [studyA, studyB] } } });
  await prisma.study.deleteMany({ where: { id: { in: [studyA, studyB] } } });
  await prisma.user.deleteMany({
    where: { id: { in: [analyst.userId, researcher.userId, clientUserA.userId] } },
  });
  await prisma.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  await prisma.$disconnect();
});

describe("getStudyDashboard — View A & B over released + approved only", () => {
  it("aggregates only released countries' approved quotes, as a per-item range and by-competitor breakdown", async () => {
    const items = await getStudyDashboard(clientUserA, studyA);

    // Only Germany is currently released; France (never released) and Spain
    // (reopened) contribute nothing.
    expect(items.map((i) => `${i.country}/${i.clientPartNumber}`)).toEqual([
      "Germany/PN-G1",
      "Germany/PN-G2",
    ]);

    const g1 = items[0];
    // View A: range over the three APPROVED quotes (900, 1100, 1300); the
    // Rejected quote is excluded.
    expect(g1.range).toEqual({ hasData: true, min: 900, max: 1300, median: 1100, count: 3 });
    // View B: partitioned by competitor.
    expect(g1.byCompetitor).toEqual([
      { competitor: "Caterpillar", range: { hasData: true, min: 1100, max: 1300, median: 1200, count: 2 } },
      { competitor: "Komatsu", range: { hasData: true, min: 900, max: 900, median: 900, count: 1 } },
    ]);

    // A released item with zero approved quotes is shown as an explicit no-data row.
    expect(items[1].range).toEqual({ hasData: false });
    expect(items[1].byCompetitor).toEqual([]);
  });

  it("never leaks another tenant's study to a client user (tenant isolation)", async () => {
    expect(await getStudyDashboard(clientUserA, studyB)).toEqual([]);
  });
});

describe("getStudyBenchmarkComparison — internal View D", () => {
  it("carries Client Price for internal staff, not comparable when the item has none", async () => {
    const items = await getStudyBenchmarkComparison(analyst, studyA);
    const byPart = new Map(items.map((i) => [i.clientPartNumber, i]));

    expect(byPart.get("PN-G1")?.comparison).toEqual({ comparable: true, clientPrice: 1000 });
    // PN-G2 has no Client Price → not comparable (mirrors the Price Flag).
    expect(byPart.get("PN-G2")?.comparison).toEqual({ comparable: false });
  });

  it("refuses the benchmark comparison to a Client User (Client Price is internal-only)", async () => {
    await expect(getStudyBenchmarkComparison(clientUserA, studyA)).rejects.toBeInstanceOf(
      AnalyticsAccessError,
    );
  });

  it("refuses a Researcher — Client Price is hidden from researchers (ADR-0003)", async () => {
    await expect(getStudyBenchmarkComparison(researcher, studyA)).rejects.toBeInstanceOf(
      AnalyticsAccessError,
    );
  });
});
