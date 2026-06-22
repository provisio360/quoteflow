import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createMarketQuote,
  addQuoteLine,
  updateDraftLine,
  deleteDraftLine,
  listLinesForItem,
  submitMarketQuote,
  approveLine,
  rejectLine,
  reviseLine,
  setMarketQuoteManualRate,
  listReviewQueue,
  QuoteAccessError,
  type MarketQuoteHeaderFields,
  type QuoteLineFields,
} from "./repository";
import { createStudy } from "@/lib/studies/repository";
import { assignResearchers } from "@/lib/assignments/repository";
import type { InternalPrincipal } from "@/domains/authz/principal";

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
  sourceLocation: "Munich",
  currency: "EUR",
  dateQuoteReceived: new Date("2026-06-01"),
};
const completeLine: QuoteLineFields = {
  competitorBrand: "Caterpillar",
  price: 1250.5,
  quantityQuoted: 1,
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

describe("ported per-line lifecycle", () => {
  it("blocks submit until required fields are present, then submits", async () => {
    const d = await createMarketQuote(researcherA, studyId, "Germany", completeHeader);
    const line = await addQuoteLine(researcherA, d.id, itemG1, { competitorBrand: "Cat" }); // no price/qty
    const blocked = await submitMarketQuote(researcherA, d.id);
    expect(blocked.ok).toBe(false);

    await updateDraftLine(researcherA, line.id, { price: 100, quantityQuoted: 1 });
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
    await addQuoteLine(researcherA, d.id, itemG1, { competitorBrand: "Caterpillar", price: 1000, quantityQuoted: 1 });
    await addQuoteLine(researcherA, d.id, itemG2, { competitorBrand: "Caterpillar", price: 250.5, quantityQuoted: 1 });
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
        clientPrice: "123.4500",
        qcThreshold: "0.0500",
      },
    });
    const lineId = await submittedConverted(researcherA, tight.id, 150);
    const blocked = await approveLine(analyst, lineId);
    expect(blocked).toEqual({ ok: false, reason: "needs-justification" });
  });
});
