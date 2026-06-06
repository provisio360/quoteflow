import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDraftQuote, submitQuote, type QuoteFields } from "./repository";
import { fillPendingConversions } from "./conversion-fill";
import { createStudy } from "@/lib/studies/repository";
import { assignResearchers } from "@/lib/assignments/repository";
import { InMemoryRateProvider } from "@/domains/quotes/rate-provider";
import type { InternalPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the deferred FX sweep (#10, ADR-0013). The conversion
// math and pending/auto rules are unit-tested in the pure core; this proves the
// data paths the core can't: the selection predicate (Submitted + pending + date
// closed in UTC), that resolved figures are pinned, and that the date-not-closed
// guard and a manual override are both left untouched. Runs via
// `npm run test:integration`.

const prisma = new PrismaClient();

// A fixed "now" so the UTC date-closed cutoff is deterministic, not wall-clock.
const NOW = new Date("2026-06-10T09:00:00Z"); // cutoff = 2026-06-10T00:00:00Z
const CLOSED_DATE = new Date("2026-06-01T00:00:00Z"); // strictly before cutoff
const SAME_DAY = new Date("2026-06-10T00:00:00Z"); // == cutoff → not yet closed

let tenantId: string;
let em: InternalPrincipal;
let studyId: string;
let itemId: string;
let researcher: InternalPrincipal;

// A complete Draft except dateQuoteReceived, which each test sets.
const base: Omit<QuoteFields, "dateQuoteReceived"> = {
  competitorBrand: "Caterpillar",
  dealerName: "Acme Equipment",
  dealerLocation: "Munich",
  price: 1250.5,
  currency: "EUR",
  quantityQuoted: 1,
};

async function submittedPendingQuote(dateQuoteReceived: Date): Promise<string> {
  const { id } = await createDraftQuote(researcher, itemId, { ...base, dateQuoteReceived });
  const result = await submitQuote(researcher, id);
  if (!result.ok) throw new Error("seed quote failed to submit");
  return id;
}

beforeAll(async () => {
  const client = await prisma.client.create({ data: { name: "Tenant (fill test)" } });
  tenantId = client.id;

  const emId = randomUUID();
  await prisma.user.create({
    data: {
      id: emId,
      name: "EM (fill test)",
      email: `em-${emId}@example.test`,
      emailVerified: true,
      kind: "internal",
      role: "EngagementManager",
      status: "active",
    },
  });
  em = { kind: "internal", userId: emId, role: "EngagementManager" };

  studyId = (await createStudy(em, { name: "Fill study", clientId: tenantId })).id;
  itemId = (
    await prisma.benchmarkItem.create({
      data: {
        studyId,
        country: "Germany",
        clientPartNumber: "PN-1",
        clientPartNumberKey: "pn-1",
        itemDescription: "Hydraulic widget",
        machineModel: "M1",
        requiredQuotes: 1,
        clientPrice: "123.4500",
      },
    })
  ).id;

  const rId = randomUUID();
  await prisma.user.create({
    data: {
      id: rId,
      name: "Researcher (fill test)",
      email: `r-${rId}@example.test`,
      emailVerified: true,
      kind: "internal",
      role: "Researcher",
      status: "active",
    },
  });
  researcher = { kind: "internal", userId: rId, role: "Researcher" };
  await assignResearchers(em, studyId, "Germany", [researcher.userId]);
});

afterAll(async () => {
  await prisma.quote.deleteMany({ where: { benchmarkItem: { studyId } } });
  await prisma.countryAssignment.deleteMany({ where: { studyId } });
  await prisma.benchmarkItem.deleteMany({ where: { studyId } });
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: [em.userId, researcher.userId] } } });
  await prisma.client.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("fillPendingConversions", () => {
  it("pins an auto conversion for a pending quote whose date has closed", async () => {
    const id = await submittedPendingQuote(CLOSED_DATE);
    const provider = new InMemoryRateProvider().set("EUR", CLOSED_DATE, 1.08);

    await fillPendingConversions(provider, NOW);

    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.conversionStatus).toBe("auto");
    expect(Number(row?.exchangeRate)).toBeCloseTo(1.08, 8);
    expect(row?.rateDate?.toISOString().slice(0, 10)).toBe("2026-06-01");
    // 1250.50 * 1.08 = 1350.54 ; / 1 = 1350.54
    expect(Number(row?.convertedUsdPrice)).toBeCloseTo(1350.54, 4);
    expect(Number(row?.convertedUsdPricePerUnit)).toBeCloseTo(1350.54, 4);
  });

  it("leaves a quote pending when its date has not yet closed (UTC guard)", async () => {
    const id = await submittedPendingQuote(SAME_DAY);
    // Provider HAS a rate for that date — proving it's the date guard, not a miss.
    const provider = new InMemoryRateProvider().set("EUR", SAME_DAY, 1.08);

    await fillPendingConversions(provider, NOW);

    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.conversionStatus).toBe("pending");
    expect(row?.exchangeRate).toBeNull();
  });

  it("leaves a quote pending when no rate is found in the window", async () => {
    const id = await submittedPendingQuote(CLOSED_DATE);
    const provider = new InMemoryRateProvider(); // nothing seeded → no rate

    await fillPendingConversions(provider, NOW);

    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.conversionStatus).toBe("pending");
  });

  it("never overwrites a sticky manual override", async () => {
    const id = await submittedPendingQuote(CLOSED_DATE);
    await prisma.quote.update({
      where: { id },
      data: {
        conversionStatus: "manual",
        exchangeRate: "1.50000000",
        rateDate: CLOSED_DATE,
        convertedUsdPrice: "1875.7500",
        convertedUsdPricePerUnit: "1875.7500",
      },
    });
    const provider = new InMemoryRateProvider().set("EUR", CLOSED_DATE, 1.08);

    await fillPendingConversions(provider, NOW);

    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.conversionStatus).toBe("manual");
    expect(Number(row?.exchangeRate)).toBeCloseTo(1.5, 8); // untouched
  });
});
