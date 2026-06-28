import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createMarketQuote,
  addQuoteLine,
  submitMarketQuote,
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
let itemId2: string;
let researcher: InternalPrincipal;

// A complete document header except dateQuoteReceived, which each test sets.
const header: Omit<MarketQuoteHeaderFields, "dateQuoteReceived"> = {
  sourceName: "Acme Equipment",
  sourceCountry: "Germany",
  sourceLocality: "Munich",
  currency: "EUR",
};
// warrantyOffered answered so the line clears the submit gate (ADR-0037).
const line = { competitorBrand: "Caterpillar", price: 1250.5, quantityQuoted: 1, warrantyOffered: false };

/** Create a one-line document dated `dateQuoteReceived` and submit it → pending. */
async function submittedPending(dateQuoteReceived: Date): Promise<{ docId: string; lineId: string }> {
  const doc = await createMarketQuote(researcher, studyId, "Germany", { ...header, dateQuoteReceived });
  const { id: lineId } = await addQuoteLine(researcher, doc.id, itemId, line);
  const result = await submitMarketQuote(researcher, doc.id);
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
  itemId2 = (
    await prisma.benchmarkItem.create({
      data: { studyId, clientId: tenantId, country: "Germany", clientItemNumber: "PN-2", clientItemNumberKey: "pn-2", itemDescription: "Gadget", requiredQuotes: 1, clientPrice: "123.4500" },
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

  it("pins ONE rate across a multi-line document, deriving each line from it", async () => {
    // Two items priced in one dealer document at different prices/quantities.
    const doc = await createMarketQuote(researcher, studyId, "Germany", { ...header, dateQuoteReceived: CLOSED_DATE });
    const a = await addQuoteLine(researcher, doc.id, itemId, { competitorBrand: "Cat", price: 1250.5, quantityQuoted: 1, warrantyOffered: false });
    const b = await addQuoteLine(researcher, doc.id, itemId2, { competitorBrand: "Cat", price: 800, quantityQuoted: 4, warrantyOffered: false });
    const submitted = await submitMarketQuote(researcher, doc.id);
    if (!submitted.ok) throw new Error("seed doc failed to submit");
    const provider = new InMemoryRateProvider().set("EUR", CLOSED_DATE, 1.08);

    await fillPendingConversions(provider, NOW);

    // One rate pinned on the document...
    const pinned = await prisma.marketQuote.findUnique({ where: { id: doc.id } });
    expect(pinned?.conversionStatus).toBe("auto");
    expect(Number(pinned?.exchangeRate)).toBeCloseTo(1.08, 8);

    // ...and every line's USD derived from that single rate.
    const rowA = await prisma.quoteLine.findUnique({ where: { id: a.id } });
    expect(Number(rowA?.convertedUsdPrice)).toBeCloseTo(1350.54, 4); // 1250.5 × 1.08
    expect(Number(rowA?.convertedUsdPricePerUnit)).toBeCloseTo(1350.54, 4); // ÷ 1
    const rowB = await prisma.quoteLine.findUnique({ where: { id: b.id } });
    expect(Number(rowB?.convertedUsdPrice)).toBeCloseTo(864, 4); // 800 × 1.08
    expect(Number(rowB?.convertedUsdPricePerUnit)).toBeCloseTo(216, 4); // 864 ÷ 4
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
