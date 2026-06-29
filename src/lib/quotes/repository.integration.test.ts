import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createMarketQuote,
  addQuoteLine,
  seedMarketQuote,
  updateDraftLine,
  batchUpdateDraftLines,
  updateMarketQuote,
  deleteDraftLine,
  listLinesForItem,
  listDraftMarketQuotesForResearcher,
  listRejectedLinesForResearcher,
  submitMarketQuote,
  approveLine,
  rejectLine,
  reviseLine,
  setMarketQuoteManualRate,
  listReviewQueue,
  QuoteAccessError,
  QuoteValidationError,
  type MarketQuoteHeaderFields,
  type QuoteLineFields,
} from "./repository";
import { createStudy } from "@/lib/studies/repository";
import { assignResearchers } from "@/lib/assignments/repository";
import type { InternalPrincipal } from "@/domains/authz/principal";
import {
  batchStampFields,
  landedCostGroup,
  leadTimeGroup,
  warrantyGroup,
} from "@/domains/quotes/batch-line-fill";

// Real-Postgres proof of the Market Quote aggregate data paths (#87 / ADR-0026).
// The pure numbering/folding spec is unit-tested in src/domains/quotes/numbering;
// the state machine in src/domains/quotes/lifecycle. This suite proves the gates
// the cores can't: the two atomic per-(study, country) counters with permanent
// gaps, one-line-per-item, the Country-pool + owner-only writes, Draft privacy on
// the line (ADR-0011), and the ported per-line lifecycle. Runs via
// `npm run test:integration`.

const prisma = new PrismaClient();

let tenantId: string;
let em: InternalPrincipal;
let studyId: string;
let itemG1: string; // Germany
let itemG2: string; // Germany
let itemF1: string; // France
let researcherA: InternalPrincipal; // Germany + France pool
let researcherB: InternalPrincipal; // Germany pool
let researcherC: InternalPrincipal; // NOT in any pool
let analyst: InternalPrincipal;

const completeHeader: MarketQuoteHeaderFields = {
  sourceName: "Acme Equipment",
  sourceCountry: "Germany",
  sourceLocality: "Munich",
  currency: "EUR",
  dateQuoteReceived: new Date("2026-06-01"),
};
const completeLine: QuoteLineFields = {
  competitorBrand: "Caterpillar",
  price: 1250.5,
  quantityQuoted: 1,
  // Warranty Offered? is required to submit (ADR-0037); a "complete" line answers it.
  warrantyOffered: false,
};

async function seedItem(country: string, n: string): Promise<string> {
  const row = await prisma.benchmarkItem.create({
    data: {
      studyId,
      clientId: tenantId,
      country,
      clientItemNumber: n,
      clientItemNumberKey: n.toLowerCase(),
      itemDescription: `Item ${n}`,
      requiredQuotes: 2,
      requiredCompetitors: [],
      clientPrice: "123.4500",
    },
  });
  return row.id;
}

async function seedResearcher(label: string): Promise<InternalPrincipal> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: label,
      email: `${label}-${id}@example.test`,
      emailVerified: true,
      kind: "internal",
      role: "Researcher",
      status: "active",
    },
  });
  return { kind: "internal", userId: id, role: "Researcher" };
}

/** Drive a line to Submitted-and-converted, simulating the deferred worker by
 *  pinning the document `auto` and the line's USD figure directly. */
async function submittedConverted(
  researcher: InternalPrincipal,
  itemId: string,
  usdPerUnit: number,
): Promise<string> {
  const doc = await createMarketQuote(researcher, studyId, itemCountry(itemId), completeHeader);
  const { id } = await addQuoteLine(researcher, doc.id, itemId, completeLine);
  await submitMarketQuote(researcher, doc.id);
  await prisma.marketQuote.update({
    where: { id: doc.id },
    data: { conversionStatus: "auto", exchangeRate: "1.00000000", rateDate: new Date("2026-06-01") },
  });
  await prisma.quoteLine.update({
    where: { id },
    data: { convertedUsdPrice: usdPerUnit.toFixed(4), convertedUsdPricePerUnit: usdPerUnit.toFixed(4) },
  });
  return id;
}

function itemCountry(itemId: string): string {
  return itemId === itemF1 ? "France" : "Germany";
}

beforeAll(async () => {
  const client = await prisma.client.create({ data: { name: "Tenant (mq test)" } });
  tenantId = client.id;

  const emId = randomUUID();
  await prisma.user.create({
    data: { id: emId, name: "EM", email: `em-${emId}@example.test`, emailVerified: true, kind: "internal", role: "EngagementManager", status: "active" },
  });
  em = { kind: "internal", userId: emId, role: "EngagementManager" };

  studyId = (await createStudy(em, { name: "MQ study", clientId: tenantId, qcThreshold: 0.25 })).id;
  itemG1 = await seedItem("Germany", "G1");
  itemG2 = await seedItem("Germany", "G2");
  itemF1 = await seedItem("France", "F1");

  researcherA = await seedResearcher("Researcher A");
  researcherB = await seedResearcher("Researcher B");
  researcherC = await seedResearcher("Researcher C");
  await assignResearchers(em, studyId, "Germany", [researcherA.userId, researcherB.userId]);
  await assignResearchers(em, studyId, "France", [researcherA.userId]);

  const analystId = randomUUID();
  await prisma.user.create({
    data: { id: analystId, name: "Analyst", email: `analyst-${analystId}@example.test`, emailVerified: true, kind: "internal", role: "Analyst", status: "active" },
  });
  analyst = { kind: "internal", userId: analystId, role: "Analyst" };
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { studyId } });
  await prisma.auditEvent.deleteMany({ where: { studyId } });
  await prisma.quoteLine.deleteMany({ where: { studyId } });
  await prisma.marketQuote.deleteMany({ where: { studyId } });
  await prisma.quoteNumberSequence.deleteMany({ where: { studyId } });
  await prisma.countryAssignment.deleteMany({ where: { studyId } });
  await prisma.benchmarkItem.deleteMany({ where: { studyId } });
  await prisma.study.deleteMany({ where: { id: studyId } });
  await prisma.user.deleteMany({
    where: { id: { in: [em.userId, researcherA.userId, researcherB.userId, researcherC.userId, analyst.userId] } },
  });
  await prisma.client.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("Market Quote Number allocation", () => {
  it("runs 1..N per market and restarts for a different country", async () => {
    const d1 = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const d2 = await createMarketQuote(researcherB, studyId, "Germany", completeHeader);
    const f1 = await createMarketQuote(researcherA, studyId, "France", completeHeader);
    expect(d1.marketQuoteNumber).toBe(1);
    expect(d2.marketQuoteNumber).toBe(2);
    expect(f1.marketQuoteNumber).toBe(1); // France restarts
  });
});

describe("Quote Line Number allocation", () => {
  it("is flat 1..N across documents within a market", async () => {
    const d1 = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const l1 = await addQuoteLine(researcherA, d1.id, itemG1, completeLine);
    const l2 = await addQuoteLine(researcherA, d1.id, itemG2, completeLine);
    const d2 = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const l3 = await addQuoteLine(researcherA, d2.id, itemG1, completeLine);
    // Flat and strictly increasing across the two documents (gaps tolerated from
    // other tests' lines, so assert ordering, not exact values).
    expect(l1.quoteLineNumber).toBeLessThan(l2.quoteLineNumber);
    expect(l2.quoteLineNumber).toBeLessThan(l3.quoteLineNumber);
  });

  it("leaves a permanent gap when a Draft line is discarded (never reused)", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const gapped = await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await deleteDraftLine(researcherA, gapped.id);
    const next = await addQuoteLine(researcherA, d.id, itemG2, completeLine);
    expect(next.quoteLineNumber).toBeGreaterThan(gapped.quoteLineNumber);
  });
});

describe("one Quote Line per Benchmark Item per document", () => {
  it("rejects a second line for the same item in the same document", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await expect(addQuoteLine(researcherA, d.id, itemG1, completeLine)).rejects.toThrow(
      QuoteAccessError,
    );
  });

  it("allows the same item across two different documents", async () => {
    const d1 = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const d2 = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, d1.id, itemG2, completeLine);
    await expect(addQuoteLine(researcherA, d2.id, itemG2, completeLine)).resolves.toBeTruthy();
  });
});

describe("Country-pool + owner-only write gates", () => {
  it("refuses a researcher not in the (study, country) pool", async () => {
    await expect(createMarketQuote(researcherC, studyId, "Germany", completeHeader)).rejects.toThrow(
      QuoteAccessError,
    );
  });

  it("refuses a non-author adding a line to someone else's document", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await expect(addQuoteLine(researcherB, d.id, itemG1, completeLine)).rejects.toThrow(
      QuoteAccessError,
    );
  });

  it("refuses a line whose Benchmark Item is in a different country than the document", async () => {
    const d = await createMarketQuote(researcherA, studyId, "France", completeHeader);
    await expect(addQuoteLine(researcherA, d.id, itemG1, completeLine)).rejects.toThrow(
      QuoteAccessError,
    );
  });
});

describe("implicit Primary Researcher claim on first line-fill (ADR-0038)", () => {
  async function primaryOf(itemId: string): Promise<string | null> {
    const row = await prisma.benchmarkItem.findUnique({
      where: { id: itemId },
      select: { primaryResearcherId: true },
    });
    return row?.primaryResearcherId ?? null;
  }

  it("filing the first line for an unclaimed item makes the filer its Primary", async () => {
    const item = await seedItem("Germany", `AC1-${randomUUID().slice(0, 8)}`);
    expect(await primaryOf(item)).toBeNull();

    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, d.id, item, completeLine);

    expect(await primaryOf(item)).toBe(researcherA.userId);
  });

  it("a second filer on an already-claimed item does not take over the Primary", async () => {
    const item = await seedItem("Germany", `AC2-${randomUUID().slice(0, 8)}`);
    // A claims it by filing the first line.
    const dA = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, dA.id, item, completeLine);
    expect(await primaryOf(item)).toBe(researcherA.userId);

    // B (also Germany pool) contributes a line on their own document — Primary stays A.
    const dB = await createMarketQuote(researcherB, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherB, dB.id, item, completeLine);

    expect(await primaryOf(item)).toBe(researcherA.userId);
  });

  it("contributing to a claimed item still records the contributor's authorship", async () => {
    const item = await seedItem("Germany", `AC3-${randomUUID().slice(0, 8)}`);
    const dA = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, dA.id, item, completeLine);

    const dB = await createMarketQuote(researcherB, studyId, "Germany", completeHeader);
    const bLine = await addQuoteLine(researcherB, dB.id, item, completeLine);

    // Primary is unchanged (A) but B authored B's line — authorship is independent
    // of the lead (rejection routing/notifications follow createdById, ADR-0038).
    expect(await primaryOf(item)).toBe(researcherA.userId);
    const row = await prisma.quoteLine.findUnique({
      where: { id: bLine.id },
      select: { createdById: true },
    });
    expect(row?.createdById).toBe(researcherB.userId);
  });
});

describe("seedMarketQuote — Quote Group Collect seam (ADR-0038, #140)", () => {
  async function primaryOf(itemId: string): Promise<string | null> {
    const row = await prisma.benchmarkItem.findUnique({
      where: { id: itemId },
      select: { primaryResearcherId: true },
    });
    return row?.primaryResearcherId ?? null;
  }

  it("seeds one Draft Market Quote with one blank Draft line per selected part", async () => {
    const i1 = await seedItem("Germany", `SD1a-${randomUUID().slice(0, 8)}`);
    const i2 = await seedItem("Germany", `SD1b-${randomUUID().slice(0, 8)}`);

    const doc = await seedMarketQuote(researcherA, studyId, "Germany", completeHeader, [i1, i2]);

    const lines = await prisma.quoteLine.findMany({
      where: { marketQuoteId: doc.id },
      select: { benchmarkItemId: true, state: true, price: true },
    });
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((l) => l.benchmarkItemId))).toEqual(new Set([i1, i2]));
    // With no batch stamp passed, lines start blank (no line fields) but valid Draft.
    expect(lines.every((l) => l.state === "Draft")).toBe(true);
    expect(lines.every((l) => l.price === null)).toBe(true);
  });

  it("auto-claims each unclaimed selected part for the seeding researcher (#138)", async () => {
    const i1 = await seedItem("Germany", `SD2a-${randomUUID().slice(0, 8)}`);
    const i2 = await seedItem("Germany", `SD2b-${randomUUID().slice(0, 8)}`);
    expect(await primaryOf(i1)).toBeNull();
    expect(await primaryOf(i2)).toBeNull();

    await seedMarketQuote(researcherA, studyId, "Germany", completeHeader, [i1, i2]);

    expect(await primaryOf(i1)).toBe(researcherA.userId);
    expect(await primaryOf(i2)).toBe(researcherA.userId);
  });

  it("does not take over a part a peer already leads (no-takeover); still files the line", async () => {
    const item = await seedItem("Germany", `SD3-${randomUUID().slice(0, 8)}`);
    // A claims it first.
    const dA = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, dA.id, item, completeLine);
    expect(await primaryOf(item)).toBe(researcherA.userId);

    // B seeds a Collect document including the same part — Primary stays A, line still files.
    const doc = await seedMarketQuote(researcherB, studyId, "Germany", completeHeader, [item]);

    expect(await primaryOf(item)).toBe(researcherA.userId);
    const line = await prisma.quoteLine.findFirst({
      where: { marketQuoteId: doc.id, benchmarkItemId: item },
      select: { createdById: true },
    });
    expect(line?.createdById).toBe(researcherB.userId);
  });

  it("enforces the cross-Country boundary and is atomic — an off-Country part rejects the whole seed (ADR-0025)", async () => {
    // A fresh Germany part precedes itemF1 in the list, so its line is created and the
    // France part then fails the same-Country gate — proving the rollback.
    const gFresh = await seedItem("Germany", `SD4-${randomUUID().slice(0, 8)}`);

    // researcherA is in the France pool too, but itemF1 cannot join a GERMANY document.
    await expect(
      seedMarketQuote(researcherA, studyId, "Germany", completeHeader, [gFresh, itemF1]),
    ).rejects.toThrow(QuoteAccessError);

    // Atomic: the whole document rolled back — the fresh part's line never persisted.
    const lines = await prisma.quoteLine.findMany({ where: { benchmarkItemId: gFresh } });
    expect(lines).toHaveLength(0);
    expect(await primaryOf(gFresh)).toBeNull();
  });

  // The dealer + batch step (ADR-0038, #141): the five Batch Line-Fill groups are
  // captured once in the entry session's transient UI state and stamped onto EACH
  // line at creation. Nothing new is persisted — the fields stay line-level.
  const crossBorderHeader: MarketQuoteHeaderFields = { ...completeHeader, sourceCountry: "France" };

  it("stamp-on-create: pre-stamps every seeded line with the batch fields", async () => {
    const i1 = await seedItem("Germany", `SD5a-${randomUUID().slice(0, 8)}`);
    const i2 = await seedItem("Germany", `SD5b-${randomUUID().slice(0, 8)}`);

    // A cross-border (France dealer → Germany market) document, so Landed Cost applies.
    const stamp = batchStampFields(
      {
        stockStatus: "In stock",
        leadTimeValue: "3",
        leadTimeUnit: "weeks",
        warrantyOffered: "true",
        warranty1Value: "12",
        warranty1Unit: "months",
        warranty2Value: "",
        warranty2Unit: "",
        landedCostIncluded: "true",
        landedCostNote: "ships DDP",
        discountAvailable: "false",
        discountType: "",
        discountApplied: "",
        discountValue: "",
      },
      true,
    );

    const doc = await seedMarketQuote(researcherA, studyId, "Germany", crossBorderHeader, [i1, i2], stamp);

    const lines = await prisma.quoteLine.findMany({
      where: { marketQuoteId: doc.id },
      select: {
        state: true,
        stockStatus: true,
        leadTimeValue: true,
        leadTimeUnit: true,
        warrantyOffered: true,
        warranty1Value: true,
        landedCostIncluded: true,
        landedCostNote: true,
        discountAvailable: true,
      },
    });
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.state).toBe("Draft");
      expect(l.stockStatus).toBe("In stock");
      expect(l.leadTimeValue?.toString()).toBe("3");
      expect(l.leadTimeUnit).toBe("weeks");
      expect(l.warrantyOffered).toBe(true);
      expect(l.warranty1Value?.toString()).toBe("12");
      expect(l.landedCostIncluded).toBe(true);
      expect(l.landedCostNote).toBe("ships DDP");
      expect(l.discountAvailable).toBe(false);
    }
  });

  it("domestic: never stamps Landed Cost even when its values are present", async () => {
    const i1 = await seedItem("Germany", `SD6-${randomUUID().slice(0, 8)}`);
    // Same-country (Germany dealer → Germany market): the merge drops Landed Cost.
    const stamp = batchStampFields(
      {
        stockStatus: "In stock",
        leadTimeValue: "",
        leadTimeUnit: "",
        warrantyOffered: "",
        warranty1Value: "",
        warranty1Unit: "",
        warranty2Value: "",
        warranty2Unit: "",
        landedCostIncluded: "true",
        landedCostNote: "ignored domestically",
        discountAvailable: "",
        discountType: "",
        discountApplied: "",
        discountValue: "",
      },
      false,
    );

    const doc = await seedMarketQuote(researcherA, studyId, "Germany", completeHeader, [i1], stamp);

    const line = await prisma.quoteLine.findFirst({
      where: { marketQuoteId: doc.id },
      select: { stockStatus: true, landedCostIncluded: true, landedCostNote: true },
    });
    expect(line?.stockStatus).toBe("In stock");
    expect(line?.landedCostIncluded).toBeNull();
    expect(line?.landedCostNote).toBeNull();
  });

  it("stateless: a part added in a LATER session inherits no batch defaults (ADR-0036/0038)", async () => {
    const i1 = await seedItem("Germany", `SD7a-${randomUUID().slice(0, 8)}`);
    const later = await seedItem("Germany", `SD7b-${randomUUID().slice(0, 8)}`);
    const stamp = batchStampFields(
      {
        stockStatus: "In stock",
        leadTimeValue: "3",
        leadTimeUnit: "weeks",
        warrantyOffered: "",
        warranty1Value: "",
        warranty1Unit: "",
        warranty2Value: "",
        warranty2Unit: "",
        landedCostIncluded: "",
        landedCostNote: "",
        discountAvailable: "",
        discountType: "",
        discountApplied: "",
        discountValue: "",
      },
      false,
    );

    const doc = await seedMarketQuote(researcherA, studyId, "Germany", completeHeader, [i1], stamp);
    // The batch held no document-level template, so a part added afterward is blank.
    await addQuoteLine(researcherA, doc.id, later);

    const lateLine = await prisma.quoteLine.findFirst({
      where: { marketQuoteId: doc.id, benchmarkItemId: later },
      select: { stockStatus: true, leadTimeValue: true },
    });
    expect(lateLine?.stockStatus).toBeNull();
    expect(lateLine?.leadTimeValue).toBeNull();
  });
});

describe("Draft privacy on the line (ADR-0011)", () => {
  it("hides another author's Draft but shows it once submitted", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const line = await addQuoteLine(researcherA, d.id, itemG1, completeLine);

    // B sees nothing of A's Draft.
    let bSees = await listLinesForItem(researcherB, itemG1);
    expect(bSees.some((l) => l.id === line.id)).toBe(false);
    // A sees their own Draft.
    const aSees = await listLinesForItem(researcherA, itemG1);
    expect(aSees.some((l) => l.id === line.id)).toBe(true);

    // Once submitted, B sees it.
    await submitMarketQuote(researcherA, d.id);
    bSees = await listLinesForItem(researcherB, itemG1);
    expect(bSees.some((l) => l.id === line.id)).toBe(true);
  });
});

describe("Quote Line view carries the parent document currency (ADR-0033)", () => {
  it("exposes the Market Quote's currency on each line so local price can be minor-unit formatted", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const line = await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    const lines = await listLinesForItem(researcherA, itemG1);
    expect(lines.find((l) => l.id === line.id)?.currency).toBe("EUR");
  });
});

describe("Draft-edit (owner-only, Draft-only)", () => {
  it("lets the author edit their own Draft line", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const line = await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await updateDraftLine(researcherA, line.id, { competitorBrand: "Komatsu" });
    const lines = await listLinesForItem(researcherA, itemG1);
    expect(lines.find((l) => l.id === line.id)?.competitorBrand).toBe("Komatsu");
  });

  it("refuses an edit by a non-author", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const line = await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await expect(updateDraftLine(researcherB, line.id, { competitorBrand: "X" })).rejects.toThrow(
      QuoteAccessError,
    );
  });

  it("refuses an edit once the line has left Draft", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const line = await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await submitMarketQuote(researcherA, d.id);
    await expect(updateDraftLine(researcherA, line.id, { competitorBrand: "X" })).rejects.toThrow(
      QuoteAccessError,
    );
  });
});

describe("batch line-fill (#128 / ADR-0036)", () => {
  it("stamps the group onto every Draft line of the document (overwrite-all, not fill-blanks)", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const l1 = await addQuoteLine(researcherA, d.id, itemG1, { ...completeLine, stockStatus: "In stock" });
    const l2 = await addQuoteLine(researcherA, d.id, itemG2, completeLine); // no stock status

    await batchUpdateDraftLines(researcherA, d.id, { stockStatus: "Out of stock" });

    const lines = await prisma.quoteLine.findMany({
      where: { id: { in: [l1.id, l2.id] } },
      select: { stockStatus: true },
    });
    expect(lines.map((l) => l.stockStatus)).toEqual(["Out of stock", "Out of stock"]);
  });

  it("touches only Draft lines, leaving a Submitted sibling untouched", async () => {
    // Two documents for the same author: one stays Draft, one is submitted. Batch
    // the submitted document — its line has left Draft, so nothing changes.
    const draftDoc = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const draftLine = await addQuoteLine(researcherA, draftDoc.id, itemG1, { ...completeLine, stockStatus: "In stock" });

    const subDoc = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const subLine = await addQuoteLine(researcherA, subDoc.id, itemG2, { ...completeLine, stockStatus: "In stock" });
    await submitMarketQuote(researcherA, subDoc.id); // subLine → Submitted

    await batchUpdateDraftLines(researcherA, subDoc.id, { stockStatus: "Out of stock" });

    const sub = await prisma.quoteLine.findUnique({ where: { id: subLine.id }, select: { state: true, stockStatus: true } });
    expect(sub).toMatchObject({ state: "Submitted", stockStatus: "In stock" }); // untouched

    // And the Draft document still fills normally (control).
    await batchUpdateDraftLines(researcherA, draftDoc.id, { stockStatus: "Out of stock" });
    const drafted = await prisma.quoteLine.findUnique({ where: { id: draftLine.id }, select: { stockStatus: true } });
    expect(drafted?.stockStatus).toBe("Out of stock");
  });

  it("stamps each value+unit pair group onto every Draft line (#129)", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const l1 = await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    const l2 = await addQuoteLine(researcherA, d.id, itemG2, completeLine);

    await batchUpdateDraftLines(researcherA, d.id, leadTimeGroup("3", "weeks"));
    await batchUpdateDraftLines(
      researcherA,
      d.id,
      warrantyGroup("true", "12,000", "miles", "5", "years"),
    );

    const lines = await prisma.quoteLine.findMany({
      where: { id: { in: [l1.id, l2.id] } },
      orderBy: { id: "asc" },
      select: {
        leadTimeValue: true,
        leadTimeUnit: true,
        warrantyOffered: true,
        warranty1Value: true,
        warranty1Unit: true,
        warranty2Value: true,
        warranty2Unit: true,
      },
    });
    for (const line of lines) {
      expect({
        leadTimeValue: Number(line.leadTimeValue),
        leadTimeUnit: line.leadTimeUnit,
        warrantyOffered: line.warrantyOffered,
        warranty1Value: Number(line.warranty1Value),
        warranty1Unit: line.warranty1Unit,
        warranty2Value: Number(line.warranty2Value),
        warranty2Unit: line.warranty2Unit,
      }).toEqual({
        leadTimeValue: 3,
        leadTimeUnit: "weeks",
        warrantyOffered: true,
        warranty1Value: 12000,
        warranty1Unit: "miles",
        warranty2Value: 5,
        warranty2Unit: "years",
      });
    }
  });

  it("Offered=No nulls all warranty pairs in one stamp (#129/ADR-0037)", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const l1 = await addQuoteLine(researcherA, d.id, itemG1, completeLine);

    // First give the line a warranty, then stamp Offered=No — the pairs must clear.
    await batchUpdateDraftLines(
      researcherA,
      d.id,
      warrantyGroup("true", "3", "year", "", ""),
    );
    await batchUpdateDraftLines(researcherA, d.id, warrantyGroup("false", "", "", "", ""));

    const after = await prisma.quoteLine.findUnique({
      where: { id: l1.id },
      select: {
        warrantyOffered: true,
        warranty1Value: true,
        warranty1Unit: true,
        warranty2Value: true,
        warranty2Unit: true,
      },
    });
    expect(after).toEqual({
      warrantyOffered: false,
      warranty1Value: null,
      warranty1Unit: null,
      warranty2Value: null,
      warranty2Unit: null,
    });
  });

  it("stamps a half-pair (value, no unit), leaving submit to catch it (#129)", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const l1 = await addQuoteLine(researcherA, d.id, itemG1, completeLine);

    await batchUpdateDraftLines(researcherA, d.id, leadTimeGroup("3", ""));

    const after = await prisma.quoteLine.findUnique({
      where: { id: l1.id },
      select: { leadTimeValue: true, leadTimeUnit: true },
    });
    expect({ value: Number(after?.leadTimeValue), unit: after?.leadTimeUnit }).toEqual({
      value: 3,
      unit: null,
    });
  });

  it("stamps the landed-cost chain (Included? + Note) onto every Draft line (#130)", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const l1 = await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    const l2 = await addQuoteLine(researcherA, d.id, itemG2, completeLine);

    await batchUpdateDraftLines(researcherA, d.id, landedCostGroup("true", "ships DDP"));

    const lines = await prisma.quoteLine.findMany({
      where: { id: { in: [l1.id, l2.id] } },
      select: { landedCostIncluded: true, landedCostNote: true },
    });
    for (const line of lines) {
      expect(line).toMatchObject({ landedCostIncluded: true, landedCostNote: "ships DDP" });
    }
  });

  it("clears a stale note when the chain is re-stamped as No (#130)", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const l1 = await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await batchUpdateDraftLines(researcherA, d.id, landedCostGroup("true", "ships DDP"));

    await batchUpdateDraftLines(researcherA, d.id, landedCostGroup("false", ""));

    const after = await prisma.quoteLine.findUnique({
      where: { id: l1.id },
      select: { landedCostIncluded: true, landedCostNote: true },
    });
    expect(after).toMatchObject({ landedCostIncluded: false, landedCostNote: null });
  });

  it("refuses a non-author and writes nothing", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const line = await addQuoteLine(researcherA, d.id, itemG1, { ...completeLine, stockStatus: "In stock" });

    await expect(
      batchUpdateDraftLines(researcherB, d.id, { stockStatus: "Out of stock" }),
    ).rejects.toThrow(QuoteAccessError);

    const after = await prisma.quoteLine.findUnique({ where: { id: line.id }, select: { stockStatus: true } });
    expect(after?.stockStatus).toBe("In stock"); // unchanged
  });

  it("refuses a non-internal principal", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    const clientUser = { kind: "client", userId: randomUUID(), tenantId } as const;
    await expect(
      batchUpdateDraftLines(clientUser, d.id, { stockStatus: "Out of stock" }),
    ).rejects.toThrow(QuoteAccessError);
  });

  it("stamps a blank value through, clearing the field on every Draft line (ADR-0036)", async () => {
    // Overwrite-all means a blank in the group CLEARS — a per-group apply is total,
    // unlike a partial per-line edit (which omits empty fields). null reaches the DB.
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const line = await addQuoteLine(researcherA, d.id, itemG1, { ...completeLine, stockStatus: "In stock" });

    await batchUpdateDraftLines(researcherA, d.id, { stockStatus: null });

    const after = await prisma.quoteLine.findUnique({ where: { id: line.id }, select: { stockStatus: true } });
    expect(after?.stockStatus).toBeNull();
  });

  it("produces no audit event (a Draft write is not in the audited set, ADR-0036)", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await addQuoteLine(researcherA, d.id, itemG2, completeLine);

    const before = await prisma.auditEvent.count({ where: { studyId } });
    await batchUpdateDraftLines(researcherA, d.id, { stockStatus: "Out of stock" });
    const after = await prisma.auditEvent.count({ where: { studyId } });

    expect(after).toBe(before); // batch pushes nothing to the audit log
  });
});

describe("ported per-line lifecycle", () => {
  it("blocks submit until required fields are present, then submits", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const line = await addQuoteLine(researcherA, d.id, itemG1, { competitorBrand: "Cat" }); // no price/qty
    const blocked = await submitMarketQuote(researcherA, d.id);
    expect(blocked.ok).toBe(false);

    // Also answer Warranty Offered? — required to submit (ADR-0037).
    await updateDraftLine(researcherA, line.id, { price: 100, quantityQuoted: 1, warrantyOffered: false });
    const ok = await submitMarketQuote(researcherA, d.id);
    expect(ok.ok).toBe(true);
    // Submitting marks the parent document pending.
    const doc = await prisma.marketQuote.findUnique({ where: { id: d.id }, select: { conversionStatus: true } });
    expect(doc?.conversionStatus).toBe("pending");
  });

  it("approves a converted line and rejects→revises another", async () => {
    const approveId = await submittedConverted(researcherA, itemG1, 123.45); // in range
    const approved = await approveLine(analyst, approveId);
    expect(approved.ok).toBe(true);

    const rejectId = await submittedConverted(researcherA, itemG2, 123.45);
    const rejected = await rejectLine(analyst, rejectId, "Please re-check the source.");
    expect(rejected.ok).toBe(true);
    const revised = await reviseLine(researcherA, rejectId);
    expect(revised.ok).toBe(true);
    const after = await prisma.quoteLine.findUnique({ where: { id: rejectId }, select: { state: true } });
    expect(after?.state).toBe("Draft");
  });

  it("sets a manual rate on a pending document, deriving each line's USD", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const line = await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await submitMarketQuote(researcherA, d.id); // document → pending
    const result = await setMarketQuoteManualRate(analyst, d.id, "1.10");
    expect(result.ok).toBe(true);
    const row = await prisma.quoteLine.findUnique({
      where: { id: line.id },
      select: { convertedUsdPrice: true },
    });
    expect(Number(row?.convertedUsdPrice)).toBeCloseTo(1250.5 * 1.1, 2);
  });
});

describe("bulk submit over a Market Quote document (#88)", () => {
  it("transitions every Draft line together and marks the document pending", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const l1 = await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    const l2 = await addQuoteLine(researcherA, d.id, itemG2, completeLine);

    const result = await submitMarketQuote(researcherA, d.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.toSubmit].sort()).toEqual([l1.id, l2.id].sort());

    const lines = await prisma.quoteLine.findMany({
      where: { marketQuoteId: d.id },
      select: { state: true },
    });
    expect(lines.map((l) => l.state)).toEqual(["Submitted", "Submitted"]);

    const doc = await prisma.marketQuote.findUnique({
      where: { id: d.id },
      select: { conversionStatus: true },
    });
    expect(doc?.conversionStatus).toBe("pending");

    // Exactly one submit Audit Event, subject the Market Quote document (ADR-0026).
    const events = await prisma.auditEvent.findMany({
      where: { action: "submit", subjectId: d.id },
      select: { subjectType: true },
    });
    expect(events).toEqual([{ subjectType: "MarketQuote" }]);
  });

  it("is all-or-nothing: one incomplete line blocks the whole document", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await addQuoteLine(researcherA, d.id, itemG2, { competitorBrand: "Cat" }); // no price/qty

    const result = await submitMarketQuote(researcherA, d.id);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "lines-incomplete") {
      expect(result.perLine).toHaveLength(1);
    }

    // Nothing transitioned, the document was not marked pending, nothing audited.
    const lines = await prisma.quoteLine.findMany({
      where: { marketQuoteId: d.id },
      select: { state: true },
    });
    expect(lines.every((l) => l.state === "Draft")).toBe(true);
    const doc = await prisma.marketQuote.findUnique({
      where: { id: d.id },
      select: { conversionStatus: true },
    });
    expect(doc?.conversionStatus).toBeNull();
    const events = await prisma.auditEvent.count({ where: { action: "submit", subjectId: d.id } });
    expect(events).toBe(0);
  });

  it("re-derives a revised line's USD from the pinned rate without re-pinning (ADR-0028)", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const l1 = await addQuoteLine(researcherA, d.id, itemG1, completeLine); // price 1250.5
    const l2 = await addQuoteLine(researcherA, d.id, itemG2, completeLine); // price 1250.5
    await submitMarketQuote(researcherA, d.id); // → pending

    // Simulate the worker pinning ONE rate (2.0) across the document and deriving USD.
    await prisma.marketQuote.update({
      where: { id: d.id },
      data: { conversionStatus: "auto", exchangeRate: "2.00000000", rateDate: new Date("2026-06-01") },
    });
    await prisma.quoteLine.updateMany({
      where: { marketQuoteId: d.id },
      data: { convertedUsdPrice: "2501.0000", convertedUsdPricePerUnit: "2501.0000" },
    });

    // Analyst rejects l2; author revises, corrects the price, and resubmits.
    await rejectLine(analyst, l2.id, "Please re-check the price.");
    await reviseLine(researcherA, l2.id);
    await updateDraftLine(researcherA, l2.id, { price: 1000 });
    const resubmit = await submitMarketQuote(researcherA, d.id);
    expect(resubmit.ok).toBe(true);
    if (resubmit.ok) expect(resubmit.toSubmit).toEqual([l2.id]); // only the Draft line

    // The document's rate is NOT re-pinned (still auto @ 2.0)...
    const doc = await prisma.marketQuote.findUnique({
      where: { id: d.id },
      select: { conversionStatus: true, exchangeRate: true },
    });
    expect(doc?.conversionStatus).toBe("auto");
    expect(Number(doc?.exchangeRate)).toBe(2);

    // ...but l2's USD is re-derived from that rate at the corrected price (1000 × 2),
    // while the untouched sibling l1 keeps its figure.
    const after = await prisma.quoteLine.findMany({
      where: { id: { in: [l1.id, l2.id] } },
      select: { id: true, convertedUsdPrice: true },
    });
    const byId = Object.fromEntries(after.map((r) => [r.id, Number(r.convertedUsdPrice)]));
    expect(byId[l2.id]).toBe(2000);
    expect(byId[l1.id]).toBe(2501);
  });
});

describe("audit + notification re-point to Market Quote / Quote Line (#92 / ADR-0026)", () => {
  it("approve writes one per-line audit event, subject the Quote Line", async () => {
    const lineId = await submittedConverted(researcherA, itemG1, 123.45); // in range
    const approved = await approveLine(analyst, lineId);
    expect(approved.ok).toBe(true);

    const events = await prisma.auditEvent.findMany({
      where: { action: "approve", subjectId: lineId },
      select: { subjectType: true, beforeValue: true, afterValue: true },
    });
    expect(events).toEqual([{ subjectType: "QuoteLine", beforeValue: null, afterValue: null }]);
  });

  it("reject writes one per-line audit event, subject the Quote Line", async () => {
    const lineId = await submittedConverted(researcherA, itemG2, 123.45);
    const rejected = await rejectLine(analyst, lineId, "Please re-check the source.");
    expect(rejected.ok).toBe(true);

    const events = await prisma.auditEvent.findMany({
      where: { action: "reject", subjectId: lineId },
      select: { subjectType: true, beforeValue: true, afterValue: true },
    });
    expect(events).toEqual([{ subjectType: "QuoteLine", beforeValue: null, afterValue: null }]);
  });

  it("manualRateOverride writes one per-document event whose after is the document-total USD summed across lines", async () => {
    // Two lines with DIFFERENT prices, so the audited total is provably a SUM,
    // not a single line's figure (the per-quote → document-total amendment).
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, d.id, itemG1, { competitorBrand: "Caterpillar", price: 1000, quantityQuoted: 1, warrantyOffered: false });
    await addQuoteLine(researcherA, d.id, itemG2, { competitorBrand: "Caterpillar", price: 250.5, quantityQuoted: 1, warrantyOffered: false });
    await submitMarketQuote(researcherA, d.id); // document → pending

    const result = await setMarketQuoteManualRate(analyst, d.id, "1.10");
    expect(result.ok).toBe(true);

    // The expected after = sum of each line's freshly-pinned convertedUsdPrice.
    const lines = await prisma.quoteLine.findMany({
      where: { marketQuoteId: d.id },
      select: { convertedUsdPrice: true },
    });
    const docTotal = lines.reduce((sum, l) => sum + Number(l.convertedUsdPrice), 0);
    expect(docTotal).toBeCloseTo((1000 + 250.5) * 1.1, 2); // sanity: spans both lines

    const events = await prisma.auditEvent.findMany({
      where: { action: "manualRateOverride", subjectId: d.id },
      select: { subjectType: true, beforeValue: true, afterValue: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0].subjectType).toBe("MarketQuote");
    expect(events[0].beforeValue).toBeNull();
    expect(Number(events[0].afterValue)).toBeCloseTo(docTotal, 4);
  });
});

describe("Price Flag + Justification gate (#90 / ADR-0014)", () => {
  // Client Price on every seeded item is 123.45; the study default QC Threshold is
  // 0.25 (25%). The flag uses the SYMMETRIC relative difference
  //   |usd - clientPrice| / ((usd + clientPrice) / 2)
  // (price-flag.ts) — keep test usd figures consistent with that, not "% of CP".

  it("blocks approval of a flagged line until a Justification exists, then approves through the revise loop", async () => {
    // usd 1250.5 vs CP 123.45 ⇒ symmetric diff ≫ 0.25 ⇒ flagged (direction above).
    const lineId = await submittedConverted(researcherA, itemG1, 1250.5);

    // 1. Flagged + no justification ⇒ approval blocked.
    const blocked = await approveLine(analyst, lineId);
    expect(blocked).toEqual({ ok: false, reason: "needs-justification" });

    // 2. Analyst returns the line for justification, stating only the DIRECTION —
    //    never the Client Price value (ADR-0003). The reason is what the author reads.
    const reason = "Quoted price is higher than expected — please justify or correct.";
    const returned = await rejectLine(analyst, lineId, reason);
    expect(returned.ok).toBe(true);
    const rejected = await prisma.quoteLine.findUnique({
      where: { id: lineId },
      select: { state: true, rejectionReason: true },
    });
    expect(rejected?.state).toBe("Rejected");
    expect(rejected?.rejectionReason).toBe(reason);
    expect(rejected?.rejectionReason).not.toContain("123"); // no Client Price leak

    // 3. Author revises → Draft, supplies a Justification, and resubmits.
    await reviseLine(researcherA, lineId);
    await updateDraftLine(researcherA, lineId, {
      justification: "Genuine premium part; dealer is sole regional supplier.",
    });
    const resubmit = await submitMarketQuote(
      researcherA,
      (await prisma.quoteLine.findUnique({ where: { id: lineId }, select: { marketQuoteId: true } }))!
        .marketQuoteId,
    );
    expect(resubmit.ok).toBe(true);

    // 4. The justification PERSISTS across resubmit; the rejection reason is cleared.
    const afterResubmit = await prisma.quoteLine.findUnique({
      where: { id: lineId },
      select: { state: true, rejectionReason: true, justification: true },
    });
    expect(afterResubmit?.state).toBe("Submitted");
    expect(afterResubmit?.rejectionReason).toBeNull();
    expect(afterResubmit?.justification).toContain("Genuine premium part");

    // 5. Still flagged, but now justified ⇒ approval succeeds.
    const approved = await approveLine(analyst, lineId);
    expect(approved).toEqual({ ok: true, state: "Approved" });
  });

  it("approves an in-range (unflagged) line straight through, no justification needed", async () => {
    // usd 130 vs CP 123.45 ⇒ symmetric diff ≈ 0.052 < 0.25 ⇒ not flagged.
    const lineId = await submittedConverted(researcherA, itemG1, 130);
    const approved = await approveLine(analyst, lineId);
    expect(approved).toEqual({ ok: true, state: "Approved" });
  });

  it("uses the per-item QC Threshold over the study default (fallback override)", async () => {
    // A tight per-item threshold (0.05) on an item the study default (0.25) would
    // pass: usd 150 vs CP 123.45 ⇒ symmetric diff ≈ 0.194 — inside 0.25 but outside
    // 0.05. Flagged ⇒ the per-item value was resolved, not the study default.
    const tight = await prisma.benchmarkItem.create({
      data: {
        studyId,
        clientId: tenantId,
        country: "Germany",
        clientItemNumber: "TIGHT",
        clientItemNumberKey: "tight",
        itemDescription: "Tight-tolerance item",
        requiredQuotes: 2,
        requiredCompetitors: [],
        clientPrice: "123.4500",
        qcThreshold: "0.0500",
      },
    });
    const lineId = await submittedConverted(researcherA, tight.id, 150);
    const blocked = await approveLine(analyst, lineId);
    expect(blocked).toEqual({ ok: false, reason: "needs-justification" });
  });
});

describe("listDraftMarketQuotesForResearcher (#97 — document-grouped Draft view)", () => {
  it("groups my-authored documents that have a Draft line, carrying doc facts and item labels", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await addQuoteLine(researcherA, d.id, itemG2, completeLine);

    const groups = await listDraftMarketQuotesForResearcher(researcherA, studyId);
    const mine = groups.find((g) => g.marketQuoteId === d.id);
    expect(mine).toBeDefined();
    expect(mine!.country).toBe("Germany");
    expect(mine!.sourceName).toBe("Acme Equipment");
    expect(mine!.currency).toBe("EUR");
    expect(mine!.conversionStatus).toBeNull(); // never submitted
    // Both Draft lines, each with its Benchmark Item label for the panel row.
    expect(mine!.lines.map((l) => l.itemLabel).sort()).toEqual(["G1 Item G1", "G2 Item G2"]);
  });

  it("shows only the Draft lines of a partially-submitted document", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const l1 = await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    const l2 = await addQuoteLine(researcherA, d.id, itemG2, completeLine);
    await submitMarketQuote(researcherA, d.id); // both → Submitted, doc → pending
    // Analyst rejects l1; author revises it back to Draft. l2 stays Submitted.
    await rejectLine(analyst, l1.id, "Please re-check.");
    await reviseLine(researcherA, l1.id);

    const groups = await listDraftMarketQuotesForResearcher(researcherA, studyId);
    const mine = groups.find((g) => g.marketQuoteId === d.id);
    expect(mine).toBeDefined();
    expect(mine!.lines.map((l) => l.lineId)).toEqual([l1.id]); // only the revised Draft
  });

  it("excludes another researcher's documents", async () => {
    const peer = await createMarketQuote(researcherB, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherB, peer.id, itemG1, completeLine);

    const groups = await listDraftMarketQuotesForResearcher(researcherA, studyId);
    expect(groups.some((g) => g.marketQuoteId === peer.id)).toBe(false);
  });

  it("excludes a document with no Draft lines", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await submitMarketQuote(researcherA, d.id); // its only line → Submitted

    const groups = await listDraftMarketQuotesForResearcher(researcherA, studyId);
    expect(groups.some((g) => g.marketQuoteId === d.id)).toBe(false);
  });

  // The `flagged` signal that gates the researcher's Justification field (ADR-0014).
  // (Previously gated by a seed drift — `requiredCompetitors` is now NOT NULL and
  // `seedItem` supplies it, so `beforeAll` runs and these are live again. #128.)
  function draftLine(groups: Awaited<ReturnType<typeof listDraftMarketQuotesForResearcher>>, lineId: string) {
    return groups.flatMap((g) => g.lines).find((l) => l.lineId === lineId);
  }

  it("marks a returned-for-justification line flagged and round-trips its justification", async () => {
    // usd 1250.5 vs CP 123.45 ⇒ symmetric diff ≫ 0.25 ⇒ flagged (ADR-0014).
    const lineId = await submittedConverted(researcherA, itemG1, 1250.5);
    await rejectLine(analyst, lineId, "Quoted price is higher than expected — please justify or correct.");
    await reviseLine(researcherA, lineId); // → Draft, back in the author's hands
    await updateDraftLine(researcherA, lineId, { justification: "Sole regional supplier of a premium part." });

    const line = draftLine(await listDraftMarketQuotesForResearcher(researcherA, studyId), lineId);
    expect(line).toBeDefined();
    expect(line!.flagged).toBe(true); // ⇒ the editor shows the Justification field
    expect(line!.justification).toContain("Sole regional supplier");
  });

  it("leaves a plainly-rejected (in-range) line unflagged", async () => {
    // usd 130 vs CP 123.45 ⇒ symmetric diff ≈ 0.052 < 0.25 ⇒ not flagged: a plain
    // reject the author should fix, not justify ⇒ no Justification field.
    const lineId = await submittedConverted(researcherA, itemG1, 130);
    await rejectLine(analyst, lineId, "Wrong competitor brand — please correct.");
    await reviseLine(researcherA, lineId);

    const line = draftLine(await listDraftMarketQuotesForResearcher(researcherA, studyId), lineId);
    expect(line).toBeDefined();
    expect(line!.flagged).toBe(false);
  });
});

describe("listRejectedLinesForResearcher (#139 — Needs-attention surface)", () => {
  // Drive a line all the way to Rejected by its author, returning its id + number.
  async function rejectedLine(
    researcher: InternalPrincipal,
    itemId: string,
    reason: string,
  ): Promise<{ id: string; quoteLineNumber: number }> {
    const doc = await createMarketQuote(researcher, studyId, itemCountry(itemId), completeHeader);
    const line = await addQuoteLine(researcher, doc.id, itemId, completeLine);
    await submitMarketQuote(researcher, doc.id);
    await rejectLine(analyst, line.id, reason);
    return line;
  }

  it("lists the author's own Rejected line with study/country/MQ#/line#/item label/reason", async () => {
    const { id } = await rejectedLine(researcherA, itemG1, "Please re-check the source.");
    const doc = await prisma.quoteLine.findUnique({
      where: { id },
      select: { quoteLineNumber: true, marketQuote: { select: { marketQuoteNumber: true } } },
    });

    const rows = await listRejectedLinesForResearcher(researcherA, studyId);
    const mine = rows.find((r) => r.lineId === id);
    expect(mine).toBeDefined();
    expect(mine!.studyId).toBe(studyId);
    expect(mine!.country).toBe("Germany");
    expect(mine!.marketQuoteNumber).toBe(doc!.marketQuote.marketQuoteNumber);
    expect(mine!.quoteLineNumber).toBe(doc!.quoteLineNumber);
    expect(mine!.itemLabel).toBe("G1 Item G1");
    expect(mine!.reason).toBe("Please re-check the source.");
  });

  it("excludes a peer's Rejected line — only the author's own appear", async () => {
    const { id } = await rejectedLine(researcherB, itemG1, "Peer's reject.");
    const rows = await listRejectedLinesForResearcher(researcherA, studyId);
    expect(rows.some((r) => r.lineId === id)).toBe(false);
  });

  it("excludes the author's non-Rejected lines (Draft / Submitted / Approved)", async () => {
    // Draft
    const draftDoc = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const draft = await addQuoteLine(researcherA, draftDoc.id, itemG1, completeLine);
    // Approved
    const apprId = await submittedConverted(researcherA, itemG2, 130);
    await approveLine(analyst, apprId);
    // Submitted (left in review)
    const subDoc = await createMarketQuote(researcherA, studyId, "France", completeHeader);
    const submitted = await addQuoteLine(researcherA, subDoc.id, itemF1, completeLine);
    await submitMarketQuote(researcherA, subDoc.id);

    const ids = new Set((await listRejectedLinesForResearcher(researcherA, studyId)).map((r) => r.lineId));
    expect(ids.has(draft.id)).toBe(false);
    expect(ids.has(apprId)).toBe(false);
    expect(ids.has(submitted.id)).toBe(false);
  });

  it("drops a line once it is revised back to Draft (it returns to the Drafts surface)", async () => {
    const { id } = await rejectedLine(researcherA, itemG1, "Fix and resubmit.");
    expect((await listRejectedLinesForResearcher(researcherA, studyId)).some((r) => r.lineId === id)).toBe(true);

    await reviseLine(researcherA, id); // Rejected → Draft
    expect((await listRejectedLinesForResearcher(researcherA, studyId)).some((r) => r.lineId === id)).toBe(false);
  });

  // The cutover AC (#143 / ADR-0038): the two researcher surfaces hand a line off.
  // A Rejected line lives in Needs attention; revising it (the author's only move
  // out of Rejected) moves it OUT of Needs attention and back INTO Drafts as a Draft
  // line — one spec naming the whole handoff the three surfaces depend on.
  it("revising a Rejected line moves it from Needs attention into Drafts", async () => {
    const { id } = await rejectedLine(researcherA, itemG1, "Fix and resubmit.");

    // Before revise: in Needs attention, NOT a Draft line in Drafts.
    expect(
      (await listRejectedLinesForResearcher(researcherA, studyId)).some((r) => r.lineId === id),
    ).toBe(true);
    const draftIds = (groups: Awaited<ReturnType<typeof listDraftMarketQuotesForResearcher>>) =>
      new Set(groups.flatMap((g) => g.lines.map((l) => l.lineId)));
    expect(draftIds(await listDraftMarketQuotesForResearcher(researcherA, studyId)).has(id)).toBe(false);

    await reviseLine(researcherA, id); // Rejected → Draft — the author's only move out

    // After revise: gone from Needs attention, present as a Draft line in Drafts.
    expect(
      (await listRejectedLinesForResearcher(researcherA, studyId)).some((r) => r.lineId === id),
    ).toBe(false);
    expect(draftIds(await listDraftMarketQuotesForResearcher(researcherA, studyId)).has(id)).toBe(true);
  });

  it("orders newest analyst verdict first (reviewedAt desc)", async () => {
    const first = await rejectedLine(researcherA, itemG1, "First.");
    const second = await rejectedLine(researcherA, itemG2, "Second.");

    const rows = await listRejectedLinesForResearcher(researcherA, studyId);
    const firstAt = rows.findIndex((r) => r.lineId === first.id);
    const secondAt = rows.findIndex((r) => r.lineId === second.id);
    expect(secondAt).toBeLessThan(firstAt); // the later rejection sorts above the earlier
  });
});

describe("updateMarketQuote (#97 — edit document header)", () => {
  it("lets the author edit the header while the document is unconverted", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", {});
    await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await updateMarketQuote(researcherA, d.id, {
      sourceName: "New Dealer",
      currency: "USD",
      dateQuoteReceived: new Date("2026-06-02"),
    });
    const doc = await prisma.marketQuote.findUnique({
      where: { id: d.id },
      select: { sourceName: true, currency: true },
    });
    expect(doc?.sourceName).toBe("New Dealer");
    expect(doc?.currency).toBe("USD");
  });

  it("refuses a header edit by a non-author", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await expect(
      updateMarketQuote(researcherB, d.id, { sourceName: "Hijack" }),
    ).rejects.toThrow(QuoteAccessError);
  });

  it("refuses a header edit once the document has been submitted (rate is pinned)", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, d.id, itemG1, completeLine);
    await submitMarketQuote(researcherA, d.id); // conversionStatus → pending
    await expect(
      updateMarketQuote(researcherA, d.id, { dateQuoteReceived: new Date("2026-07-01") }),
    ).rejects.toThrow(QuoteAccessError);
  });
});

describe("dealer location split + forward-only validation (#108 / ADR-0032)", () => {
  it("round-trips Dealer Country and locality through create and read", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await addQuoteLine(researcherA, d.id, itemG1, completeLine);

    const groups = await listDraftMarketQuotesForResearcher(researcherA, studyId);
    const mine = groups.find((g) => g.marketQuoteId === d.id);
    expect(mine!.sourceCountry).toBe("Germany");
    expect(mine!.sourceLocality).toBe("Munich");
  });

  it("blocks bulk submit, reporting a missing Dealer Country", async () => {
    const { sourceCountry: _omit, ...noCountry } = completeHeader;
    const d = await createMarketQuote(researcherA, studyId, "Germany", noCountry);
    await addQuoteLine(researcherA, d.id, itemG1, completeLine);

    const result = await submitMarketQuote(researcherA, d.id);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "lines-incomplete") {
      expect(result.perLine[0].missing).toContain("sourceCountry");
    } else {
      throw new Error("expected lines-incomplete");
    }
  });

  it("blocks bulk submit, reporting a missing dealer locality", async () => {
    const { sourceLocality: _omit, ...noLocality } = completeHeader;
    const d = await createMarketQuote(researcherA, studyId, "Germany", noLocality);
    await addQuoteLine(researcherA, d.id, itemG1, completeLine);

    const result = await submitMarketQuote(researcherA, d.id);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "lines-incomplete") {
      expect(result.perLine[0].missing).toContain("sourceLocality");
    } else {
      throw new Error("expected lines-incomplete");
    }
  });

  it("rejects creating with an invalid currency code", async () => {
    await expect(
      createMarketQuote(researcherA, studyId, "Germany", { ...completeHeader, currency: "Euros" }),
    ).rejects.toThrow(QuoteValidationError);
  });

  it("rejects creating with an invalid Dealer Country", async () => {
    await expect(
      createMarketQuote(researcherA, studyId, "Germany", {
        ...completeHeader,
        sourceCountry: "Westeros",
      }),
    ).rejects.toThrow(QuoteValidationError);
  });

  it("rejects editing to an invalid currency code", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    await expect(
      updateMarketQuote(researcherA, d.id, { currency: "notacode" }),
    ).rejects.toThrow(QuoteValidationError);
  });

  it("tolerates a legacy free-text currency on read and on an unrelated edit (forward-only)", async () => {
    // A pre-split row seeded directly with a free-text currency and no Dealer
    // Country — never rejected, never revalidated until currency itself is edited.
    const legacy = await prisma.marketQuote.create({
      data: {
        studyId,
        clientId: tenantId,
        country: "Germany",
        marketQuoteNumber: 9000,
        createdById: researcherA.userId,
        sourceName: "Legacy Dealer",
        sourceLocality: "Old Town",
        currency: "Euros", // free-text, not ISO 4217
      },
      select: { id: true },
    });
    await addQuoteLine(researcherA, legacy.id, itemG1, completeLine);

    // Loads via the read path with its free-text currency intact.
    const groups = await listDraftMarketQuotesForResearcher(researcherA, studyId);
    const mine = groups.find((g) => g.marketQuoteId === legacy.id);
    expect(mine!.currency).toBe("Euros");

    // An edit that does not carry currency is accepted (no revalidation).
    await updateMarketQuote(researcherA, legacy.id, { sourceName: "Renamed" });
    const after = await prisma.marketQuote.findUnique({
      where: { id: legacy.id },
      select: { sourceName: true, currency: true },
    });
    expect(after).toEqual({ sourceName: "Renamed", currency: "Euros" });
  });
});
