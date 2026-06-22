import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createMarketQuote,
  addQuoteLine,
  submitLine,
  type MarketQuoteHeaderFields,
} from "./repository";
import { fillPendingConversions } from "./conversion-fill";
import { createStudy } from "@/lib/studies/repository";
import { assignResearchers } from "@/lib/assignments/repository";
import { InMemoryRateProvider } from "@/domains/quotes/rate-provider";
import type { InternalPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the deferred FX sweep (#10, ADR-0013/0026). Conversion is
// now per MARKET QUOTE (one rate per document), with each line's USD derived from
// it. The math/rules are unit-tested in the pure core; this proves the data paths:
// the selection predicate (pending + date closed in UTC), that resolved figures
// pin on the document AND its lines, and that the date guard and a manual override
// are both left untouched. Runs via `npm run test:integration`.

const prisma = new PrismaClient();

const NOW = new Date("2026-06-10T09:00:00Z"); // cutoff = 2026-06-10T00:00:00Z
const CLOSED_DATE = new Date("2026-06-01T00:00:00Z"); // strictly before cutoff
const SAME_DAY = new Date("2026-06-10T00:00:00Z"); // == cutoff → not yet closed

let tenantId: string;
let em: InternalPrincipal;
let studyId: string;
let itemId: string;
let researcher: InternalPrincipal;

// A complete document header except dateQuoteReceived, which each test sets.
const header: Omit<MarketQuoteHeaderFields, "dateQuoteReceived"> = {
  sourceName: "Acme Equipment",
  sourceLocation: "Munich",
  currency: "EUR",
};
const line = { competitorBrand: "Caterpillar", price: 1250.5, quantityQuoted: 1 };

/** Create a one-line document dated `dateQuoteReceived` and submit it → pending. */
async function submittedPending(dateQuoteReceived: Date): Promise<{ docId: string; lineId: string }> {
  const doc = await createMarketQuote(researcher, studyId, "Germany", { ...header, dateQuoteReceived });
  const { id: lineId } = await addQuoteLine(researcher, doc.id, itemId, line);
  const result = await submitLine(researcher, lineId);
  if (!result.ok) throw new Error("seed line failed to submit");
  return { docId: doc.id, lineId };
}

beforeAll(async () => {
  const client = await prisma.client.create({ data: { name: "Tenant (fill test)" } });
  tenantId = client.id;

  const emId = randomUUID();
  await prisma.user.create({
    data: { id: emId, name: "EM", email: `em-${emId}@example.test`, emailVerified: true, kind: "internal", role: "EngagementManager", status: "active" },
  });
  em = { kind: "internal", userId: emId, role: "EngagementManager" };

  studyId = (await createStudy(em, { name: "Fill study", clientId: tenantId, qcThreshold: 0.25 })).id;
  itemId = (
    await prisma.benchmarkItem.create({
      data: { studyId, clientId: tenantId, country: "Germany", clientItemNumber: "PN-1", clientItemNumberKey: "pn-1", itemDescription: "Widget", requiredQuotes: 1, clientPrice: "123.4500" },
    })
  ).id;

  const rId = randomUUID();
  await prisma.user.create({
    data: { id: rId, name: "Researcher", email: `r-${rId}@example.test`, emailVerified: true, kind: "internal", role: "Researcher", status: "active" },
  });
  researcher = { kind: "internal", userId: rId, role: "Researcher" };
  await assignResearchers(em, studyId, "Germany", [researcher.userId]);
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { studyId } });
  await prisma.quoteLine.deleteMany({ where: { studyId } });
  await prisma.marketQuote.deleteMany({ where: { studyId } });
  await prisma.quoteNumberSequence.deleteMany({ where: { studyId } });
  await prisma.countryAssignment.deleteMany({ where: { studyId } });
  await prisma.benchmarkItem.deleteMany({ where: { studyId } });
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: [em.userId, researcher.userId] } } });
  await prisma.client.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("fillPendingConversions", () => {
  it("pins an auto conversion on the document and derives each line's USD", async () => {
    const { docId, lineId } = await submittedPending(CLOSED_DATE);
    const provider = new InMemoryRateProvider().set("EUR", CLOSED_DATE, 1.08);

    await fillPendingConversions(provider, NOW);

    const doc = await prisma.marketQuote.findUnique({ where: { id: docId } });
    expect(doc?.conversionStatus).toBe("auto");
    expect(Number(doc?.exchangeRate)).toBeCloseTo(1.08, 8);
    expect(doc?.rateDate?.toISOString().slice(0, 10)).toBe("2026-06-01");
    const row = await prisma.quoteLine.findUnique({ where: { id: lineId } });
    expect(Number(row?.convertedUsdPrice)).toBeCloseTo(1350.54, 4);
    expect(Number(row?.convertedUsdPricePerUnit)).toBeCloseTo(1350.54, 4);
  });

  it("leaves a document pending when its date has not yet closed (UTC guard)", async () => {
    const { docId } = await submittedPending(SAME_DAY);
    const provider = new InMemoryRateProvider().set("EUR", SAME_DAY, 1.08);

    await fillPendingConversions(provider, NOW);

    const doc = await prisma.marketQuote.findUnique({ where: { id: docId } });
    expect(doc?.conversionStatus).toBe("pending");
    expect(doc?.exchangeRate).toBeNull();
  });

  it("leaves a document pending when no rate is found in the window", async () => {
    const { docId } = await submittedPending(CLOSED_DATE);
    const provider = new InMemoryRateProvider();

    await fillPendingConversions(provider, NOW);

    const doc = await prisma.marketQuote.findUnique({ where: { id: docId } });
    expect(doc?.conversionStatus).toBe("pending");
  });

  it("never overwrites a sticky manual override", async () => {
    const { docId } = await submittedPending(CLOSED_DATE);
    await prisma.marketQuote.update({
      where: { id: docId },
      data: { conversionStatus: "manual", exchangeRate: "1.50000000", rateDate: CLOSED_DATE },
    });
    const provider = new InMemoryRateProvider().set("EUR", CLOSED_DATE, 1.08);

    await fillPendingConversions(provider, NOW);

    const doc = await prisma.marketQuote.findUnique({ where: { id: docId } });
    expect(doc?.conversionStatus).toBe("manual");
    expect(Number(doc?.exchangeRate)).toBeCloseTo(1.5, 8);
  });
});
