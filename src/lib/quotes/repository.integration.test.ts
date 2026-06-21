import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createDraftQuote,
  updateDraftQuote,
  deleteDraftQuote,
  submitQuote,
  listQuotesForItem,
  listReviewQueue,
  countReviewQueue,
  approveQuote,
  rejectQuote,
  reviseQuote,
  setManualRate,
  QuoteAccessError,
  type QuoteFields,
} from "./repository";
import { createStudy } from "@/lib/studies/repository";
import { assignResearchers } from "@/lib/assignments/repository";
import type { InternalPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the Quote lifecycle data paths (#8). The state machine
// and submit-time validation are unit-tested in src/domains/quotes/lifecycle;
// this suite proves the gates the core can't: atomic per-item numbering with
// permanent gaps (ADR-0010), owner-only Draft-only writes, the Country-pool
// create gate, and Draft privacy on the pool read (ADR-0011). Runs via
// `npm run test:integration`.

const prisma = new PrismaClient();

let tenantId: string;
let em: InternalPrincipal;
let studyId: string;
let itemId: string;
let researcherA: InternalPrincipal; // in Germany pool
let researcherB: InternalPrincipal; // in Germany pool
let researcherC: InternalPrincipal; // NOT in Germany pool
let analyst: InternalPrincipal; // reviews the queue

// Drive a Quote to Submitted-and-converted, simulating the deferred worker
// (ADR-0013) by pinning USD figures directly. `usdPerUnit` controls the QC flag
// against the item's Client Price (123.45) under the study's 25% threshold.
async function submittedConverted(
  researcher: InternalPrincipal,
  usdPerUnit: number,
  justification?: string,
): Promise<string> {
  const { id } = await createDraftQuote(researcher, itemId, complete);
  await submitQuote(researcher, id);
  await prisma.quote.update({
    where: { id },
    data: {
      conversionStatus: "auto",
      exchangeRate: "1.00000000",
      rateDate: new Date("2026-06-01"),
      convertedUsdPrice: usdPerUnit.toFixed(4),
      convertedUsdPricePerUnit: usdPerUnit.toFixed(4),
      ...(justification === undefined ? {} : { justification }),
    },
  });
  return id;
}

// Every required-to-submit field present.
const complete: QuoteFields = {
  competitorBrand: "Caterpillar",
  dealerName: "Acme Equipment",
  dealerLocation: "Munich",
  price: 1250.5,
  currency: "EUR",
  quantityQuoted: 1,
  dateQuoteReceived: new Date("2026-06-01"),
};

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

beforeAll(async () => {
  const client = await prisma.client.create({ data: { name: "Tenant (quote test)" } });
  tenantId = client.id;

  const emId = randomUUID();
  await prisma.user.create({
    data: {
      id: emId,
      name: "EM (quote test)",
      email: `em-${emId}@example.test`,
      emailVerified: true,
      kind: "internal",
      role: "EngagementManager",
      status: "active",
    },
  });
  em = { kind: "internal", userId: emId, role: "EngagementManager" };

  studyId = (await createStudy(em, { name: "Quote study", clientId: tenantId, qcThreshold: 0.25 })).id;

  itemId = (
    await prisma.benchmarkItem.create({
      data: {
        studyId,
        clientId: tenantId,
        country: "Germany",
        clientItemNumber: "PN-1",
        clientItemNumberKey: "pn-1",
        itemDescription: "Hydraulic widget",
        clientSourceUnit: "M1",
        requiredQuotes: 2,
        clientPrice: "123.4500",
      },
    })
  ).id;

  researcherA = await seedResearcher("Researcher A");
  researcherB = await seedResearcher("Researcher B");
  researcherC = await seedResearcher("Researcher C");
  await assignResearchers(em, studyId, "Germany", [researcherA.userId, researcherB.userId]);

  const analystId = randomUUID();
  await prisma.user.create({
    data: {
      id: analystId,
      name: "Analyst (quote test)",
      email: `analyst-${analystId}@example.test`,
      emailVerified: true,
      kind: "internal",
      role: "Analyst",
      status: "active",
    },
  });
  analyst = { kind: "internal", userId: analystId, role: "Analyst" };
});

afterAll(async () => {
  // Lifecycle moves now write audit events (issue #16) pinning the actor
  // (onDelete: Restrict), so clear them before deleting users.
  await prisma.notification.deleteMany({ where: { studyId } });
  await prisma.auditEvent.deleteMany({ where: { studyId } });
  await prisma.quote.deleteMany({ where: { benchmarkItem: { studyId } } });
  await prisma.countryAssignment.deleteMany({ where: { studyId } });
  await prisma.benchmarkItem.deleteMany({ where: { studyId } });
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [em.userId, researcherA.userId, researcherB.userId, researcherC.userId, analyst.userId],
      },
    },
  });
  await prisma.client.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("createDraftQuote — partial data + per-item numbering", () => {
  it("a pool researcher saves a Draft with partial data, numbered 1", async () => {
    const { id, quoteNumber } = await createDraftQuote(researcherA, itemId, {
      competitorBrand: "Cat",
    });
    expect(quoteNumber).toBe(1);
    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row).toMatchObject({ state: "Draft", competitorBrand: "Cat", dealerName: null });
  });

  it("numbers are sequential, and a deleted Draft leaves a permanent gap (never reused)", async () => {
    const second = await createDraftQuote(researcherA, itemId); // 2
    expect(second.quoteNumber).toBe(2);
    await deleteDraftQuote(researcherA, second.id); // abandon 2
    const third = await createDraftQuote(researcherA, itemId); // 3, NOT 2
    expect(third.quoteNumber).toBe(3);
  });

  it("rejects a researcher not in the item's Country pool", async () => {
    await expect(createDraftQuote(researcherC, itemId)).rejects.toBeInstanceOf(QuoteAccessError);
  });

  it("rejects a non-Researcher (an EM runs a study, doesn't collect quotes)", async () => {
    await expect(createDraftQuote(em, itemId)).rejects.toBeInstanceOf(QuoteAccessError);
  });
});

describe("submitQuote — guarded one-way transition", () => {
  it("blocks submit listing the missing required fields, leaving the quote a Draft", async () => {
    const { id } = await createDraftQuote(researcherA, itemId, { competitorBrand: "Cat" });
    const result = await submitQuote(researcherA, id);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "missing-fields") {
      expect(result.missing).toContain("price");
      expect(result.missing).toContain("dealerName");
    } else {
      throw new Error("expected missing-fields");
    }
    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.state).toBe("Draft");
  });

  it("submits a complete Draft, persisting Submitted and marking conversion pending", async () => {
    const { id } = await createDraftQuote(researcherA, itemId, complete);
    const result = await submitQuote(researcherA, id);
    expect(result).toEqual({ ok: true, state: "Submitted" });
    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.state).toBe("Submitted");
    // Conversion is deferred to the worker, so submit only queues it (ADR-0013).
    expect(row?.conversionStatus).toBe("pending");
  });

  it("rejects re-submitting an already-Submitted quote as an illegal transition", async () => {
    const { id } = await createDraftQuote(researcherA, itemId, complete);
    await submitQuote(researcherA, id);
    const again = await submitQuote(researcherA, id);
    expect(again).toEqual({ ok: false, reason: "illegal-transition" });
  });
});

describe("owner-only writes", () => {
  it("a different researcher cannot edit, submit, or delete another's Draft", async () => {
    const { id } = await createDraftQuote(researcherA, itemId, complete);
    await expect(updateDraftQuote(researcherB, id, { notes: "x" })).rejects.toBeInstanceOf(
      QuoteAccessError,
    );
    await expect(submitQuote(researcherB, id)).rejects.toBeInstanceOf(QuoteAccessError);
    await expect(deleteDraftQuote(researcherB, id)).rejects.toBeInstanceOf(QuoteAccessError);
  });

  it("a Submitted quote can no longer be edited by its author", async () => {
    const { id } = await createDraftQuote(researcherA, itemId, complete);
    await submitQuote(researcherA, id);
    await expect(updateDraftQuote(researcherA, id, { notes: "late" })).rejects.toBeInstanceOf(
      QuoteAccessError,
    );
  });
});

describe("listQuotesForItem — Draft privacy (ADR-0011)", () => {
  it("shows own Drafts and others' non-Drafts, but never another author's Draft", async () => {
    // A's private Draft; B's Draft; B's Submitted.
    const aDraft = await createDraftQuote(researcherA, itemId, { competitorBrand: "A-only" });
    const bDraft = await createDraftQuote(researcherB, itemId, { competitorBrand: "B-only" });
    const bSubmitted = await createDraftQuote(researcherB, itemId, complete);
    await submitQuote(researcherB, bSubmitted.id);

    const asSeenByA = await listQuotesForItem(researcherA, itemId);
    const ids = asSeenByA.map((q) => q.id);
    expect(ids).toContain(aDraft.id); // own Draft — visible
    expect(ids).toContain(bSubmitted.id); // other's Submitted — visible
    expect(ids).not.toContain(bDraft.id); // other's Draft — hidden

    // The peer's visible quote carries its author's name, so the work surface can
    // attribute it to whoever submitted it (#68).
    const peerQuote = asSeenByA.find((q) => q.id === bSubmitted.id);
    expect(peerQuote?.authorName).toBe("Researcher B");
  });

  it("denies a client user (this read path is internal-only)", async () => {
    const clientUser = { kind: "client", userId: randomUUID(), tenantId } as const;
    await expect(listQuotesForItem(clientUser, itemId)).rejects.toBeInstanceOf(QuoteAccessError);
  });
});

describe("listReviewQueue — analyst-only, FIFO, with the QC flag (ADR-0014)", () => {
  it("denies non-analysts (only the Analyst reviews quotes)", async () => {
    await expect(listReviewQueue(researcherA)).rejects.toBeInstanceOf(QuoteAccessError);
    await expect(listReviewQueue(em)).rejects.toBeInstanceOf(QuoteAccessError);
  });

  it("computes no flag for a converted quote within threshold of the Client Price", async () => {
    const id = await submittedConverted(researcherA, 123.45); // == clientPrice
    const row = (await listReviewQueue(analyst)).find((q) => q.id === id);
    expect(row?.flag).toEqual({ comparable: true, flagged: false, direction: "equal", percentDiff: 0 });
  });

  it("flags a converted quote that diverges beyond the threshold, with direction", async () => {
    const id = await submittedConverted(researcherA, 400); // far above 123.45 @ 25%
    const row = (await listReviewQueue(analyst)).find((q) => q.id === id);
    expect(row?.flag.comparable).toBe(true);
    if (row?.flag.comparable) {
      expect(row.flag.flagged).toBe(true);
      expect(row.flag.direction).toBe("above");
    }
  });

  it("marks a still-pending quote not comparable (no USD figure yet)", async () => {
    const { id } = await createDraftQuote(researcherA, itemId, complete);
    await submitQuote(researcherA, id); // Submitted, conversion pending
    const row = (await listReviewQueue(analyst)).find((q) => q.id === id);
    expect(row?.flag).toEqual({ comparable: false });
  });

  it("orders the queue oldest-submitted first (FIFO)", async () => {
    const older = await submittedConverted(researcherA, 123.45);
    const newer = await submittedConverted(researcherA, 123.45);
    // Pin distinct submission times regardless of clock resolution.
    await prisma.quote.update({ where: { id: older }, data: { submittedAt: new Date("2026-06-01T00:00:00Z") } });
    await prisma.quote.update({ where: { id: newer }, data: { submittedAt: new Date("2026-06-02T00:00:00Z") } });
    const ids = (await listReviewQueue(analyst)).map((q) => q.id);
    expect(ids.indexOf(older)).toBeLessThan(ids.indexOf(newer));
  });
});

describe("countReviewQueue — the home review-queue depth signal (#58)", () => {
  it("denies non-analysts, same gate as the queue it summarises", async () => {
    await expect(countReviewQueue(researcherA)).rejects.toBeInstanceOf(QuoteAccessError);
    await expect(countReviewQueue(em)).rejects.toBeInstanceOf(QuoteAccessError);
  });

  it("counts exactly the Submitted quotes the queue lists", async () => {
    const before = await countReviewQueue(analyst);
    expect(before).toBe((await listReviewQueue(analyst)).length);

    // A fresh submission lifts the count by one…
    const id = await submittedConverted(researcherA, 123.45);
    expect(await countReviewQueue(analyst)).toBe(before + 1);

    // …and an analyst verdict (out of Submitted) drops it back.
    await approveQuote(analyst, id);
    expect(await countReviewQueue(analyst)).toBe(before);
  });
});

describe("approveQuote — conversion + justification gates (ADR-0013/0014)", () => {
  it("blocks approval while conversion is pending, leaving the quote Submitted", async () => {
    const { id } = await createDraftQuote(researcherA, itemId, complete);
    await submitQuote(researcherA, id);
    expect(await approveQuote(analyst, id)).toEqual({ ok: false, reason: "conversion-pending" });
    expect((await prisma.quote.findUnique({ where: { id } }))?.state).toBe("Submitted");
  });

  it("approves a converted, unflagged quote, pinning the reviewer", async () => {
    const id = await submittedConverted(researcherA, 123.45);
    expect(await approveQuote(analyst, id)).toEqual({ ok: true, state: "Approved" });
    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.state).toBe("Approved");
    expect(row?.reviewedById).toBe(analyst.userId);
    expect(row?.reviewedAt).not.toBeNull();
  });

  it("blocks approval of a flagged quote with no justification", async () => {
    const id = await submittedConverted(researcherA, 400); // flagged
    expect(await approveQuote(analyst, id)).toEqual({ ok: false, reason: "needs-justification" });
    expect((await prisma.quote.findUnique({ where: { id } }))?.state).toBe("Submitted");
  });

  it("approves a flagged quote once the author has justified it", async () => {
    const id = await submittedConverted(researcherA, 400, "Premium OEM dealer, price confirmed");
    expect(await approveQuote(analyst, id)).toEqual({ ok: true, state: "Approved" });
  });

  it("denies a non-analyst", async () => {
    const id = await submittedConverted(researcherA, 123.45);
    await expect(approveQuote(researcherA, id)).rejects.toBeInstanceOf(QuoteAccessError);
  });
});

describe("rejectQuote — verdict returns to the author with a reason", () => {
  it("rejects a quote with a reason, pinning the verdict", async () => {
    const id = await submittedConverted(researcherA, 123.45);
    expect(await rejectQuote(analyst, id, "Dealer location missing")).toEqual({
      ok: true,
      state: "Rejected",
    });
    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.state).toBe("Rejected");
    expect(row?.rejectionReason).toBe("Dealer location missing");
    expect(row?.reviewedById).toBe(analyst.userId);
  });

  it("can reject a still-pending quote (rejection is not gated by conversion)", async () => {
    const { id } = await createDraftQuote(researcherA, itemId, complete);
    await submitQuote(researcherA, id);
    expect(await rejectQuote(analyst, id, "Obvious junk")).toEqual({ ok: true, state: "Rejected" });
  });

  it("blocks rejection with a blank reason", async () => {
    const id = await submittedConverted(researcherA, 123.45);
    expect(await rejectQuote(analyst, id, "   ")).toEqual({ ok: false, reason: "missing-reason" });
    expect((await prisma.quote.findUnique({ where: { id } }))?.state).toBe("Submitted");
  });

  it("denies a non-analyst", async () => {
    const id = await submittedConverted(researcherA, 123.45);
    await expect(rejectQuote(researcherA, id, "no")).rejects.toBeInstanceOf(QuoteAccessError);
  });
});

describe("audit recording — submit / approve / reject (issue #16 / ADR-0019)", () => {
  const auditFor = (quoteId: string) =>
    prisma.auditEvent.findMany({ where: { studyId, subjectType: "Quote", subjectId: quoteId } });

  it("records a submit event pinning the researcher, no before/after", async () => {
    const { id } = await createDraftQuote(researcherA, itemId, complete);
    await submitQuote(researcherA, id);
    const events = await auditFor(id);
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("submit");
    expect(events[0].actorId).toBe(researcherA.userId);
    expect(events[0].beforeValue).toBeNull();
    expect(events[0].afterValue).toBeNull();
  });

  it("does not record a second submit for an already-Submitted quote (no real change)", async () => {
    const { id } = await createDraftQuote(researcherA, itemId, complete);
    await submitQuote(researcherA, id);
    await submitQuote(researcherA, id); // illegal transition — changes nothing
    expect(await auditFor(id)).toHaveLength(1);
  });

  it("records an approve event pinning the analyst", async () => {
    const id = await submittedConverted(researcherA, 123.45);
    await approveQuote(analyst, id);
    const approve = (await auditFor(id)).filter((e) => e.action === "approve");
    expect(approve).toHaveLength(1);
    expect(approve[0].actorId).toBe(analyst.userId);
  });

  it("records nothing for a blocked approval (conversion pending)", async () => {
    const { id } = await createDraftQuote(researcherA, itemId, complete);
    await submitQuote(researcherA, id);
    await approveQuote(analyst, id); // blocked — still Submitted
    expect((await auditFor(id)).some((e) => e.action === "approve")).toBe(false);
  });

  it("records a reject event pinning the analyst", async () => {
    const id = await submittedConverted(researcherA, 123.45);
    await rejectQuote(analyst, id, "Dealer location missing");
    const reject = (await auditFor(id)).filter((e) => e.action === "reject");
    expect(reject).toHaveLength(1);
    expect(reject[0].actorId).toBe(analyst.userId);
  });
});

describe("setManualRate — analyst override for a pending conversion (#70 / ADR-0023)", () => {
  const auditFor = (quoteId: string) =>
    prisma.auditEvent.findMany({ where: { studyId, subjectType: "Quote", subjectId: quoteId } });

  // A Submitted quote left pending (no worker run): price 1250.50 EUR, qty 1.
  async function submittedPending(): Promise<string> {
    const { id } = await createDraftQuote(researcherA, itemId, complete);
    const result = await submitQuote(researcherA, id);
    if (!result.ok) throw new Error("seed quote failed to submit");
    return id;
  }

  it("pins a manual conversion from pending and records the override", async () => {
    const id = await submittedPending();

    expect(await setManualRate(analyst, id, "1.1")).toEqual({ ok: true });

    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.conversionStatus).toBe("manual");
    expect(Number(row?.exchangeRate)).toBeCloseTo(1.1, 8);
    expect(row?.rateDate?.toISOString().slice(0, 10)).toBe("2026-06-01"); // = dateQuoteReceived
    // 1250.50 * 1.1 = 1375.55 ; / 1 = 1375.55
    expect(Number(row?.convertedUsdPrice)).toBeCloseTo(1375.55, 4);
    expect(Number(row?.convertedUsdPricePerUnit)).toBeCloseTo(1375.55, 4);

    const events = (await auditFor(id)).filter((e) => e.action === "manualRateOverride");
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(analyst.userId);
    expect(events[0].beforeValue).toBeNull();
    expect(Number(events[0].afterValue)).toBeCloseTo(1375.55, 4);
  });

  it("denies a non-analyst", async () => {
    const id = await submittedPending();
    await expect(setManualRate(researcherA, id, "1.1")).rejects.toBeInstanceOf(QuoteAccessError);
    await expect(setManualRate(em, id, "1.1")).rejects.toBeInstanceOf(QuoteAccessError);
  });

  it("rejects a non-positive / non-numeric rate, leaving the quote pending", async () => {
    const id = await submittedPending();
    expect(await setManualRate(analyst, id, "0")).toEqual({ ok: false, reason: "invalid-rate" });
    expect(await setManualRate(analyst, id, "abc")).toEqual({ ok: false, reason: "invalid-rate" });
    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.conversionStatus).toBe("pending");
    expect((await auditFor(id)).some((e) => e.action === "manualRateOverride")).toBe(false);
  });

  it("is sticky: a second override on an already-converted quote is refused", async () => {
    const id = await submittedPending();
    expect(await setManualRate(analyst, id, "1.1")).toEqual({ ok: true });
    // A manual quote is no longer pending — a further override is rejected and the
    // first rate stands untouched (no second audit event).
    expect(await setManualRate(analyst, id, "2.0")).toEqual({ ok: false, reason: "not-pending" });
    const row = await prisma.quote.findUnique({ where: { id } });
    expect(Number(row?.exchangeRate)).toBeCloseTo(1.1, 8);
    expect(
      (await auditFor(id)).filter((e) => e.action === "manualRateOverride"),
    ).toHaveLength(1);
  });
});

describe("reviseQuote — author returns a Rejected quote to Draft (ADR-0014)", () => {
  it("returns to Draft, resets conversion and FIFO stamp, keeps the Quote Number", async () => {
    const id = await submittedConverted(researcherA, 123.45);
    const before = await prisma.quote.findUnique({ where: { id } });
    await rejectQuote(analyst, id, "Please re-check the dealer");
    expect(await reviseQuote(researcherA, id)).toEqual({ ok: true, state: "Draft" });
    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.state).toBe("Draft");
    expect(row?.conversionStatus).toBeNull();
    expect(row?.submittedAt).toBeNull();
    expect(row?.quoteNumber).toBe(before?.quoteNumber); // number retained
  });

  it("only the author may revise their own quote", async () => {
    const id = await submittedConverted(researcherA, 123.45);
    await rejectQuote(analyst, id, "redo");
    await expect(reviseQuote(researcherB, id)).rejects.toBeInstanceOf(QuoteAccessError);
  });

  it("cannot revise a quote that is not Rejected", async () => {
    const id = await submittedConverted(researcherA, 123.45);
    expect(await reviseQuote(researcherA, id)).toEqual({ ok: false, reason: "illegal-transition" });
  });
});

describe("resubmit after revise clears the verdict but keeps the justification", () => {
  it("re-queues with a fresh stamp, no stale verdict, justification intact", async () => {
    const id = await submittedConverted(researcherA, 400); // flagged
    await rejectQuote(analyst, id, "Price higher than expected — please justify");
    await reviseQuote(researcherA, id);
    await updateDraftQuote(researcherA, id, { justification: "Sole regional distributor" });
    expect(await submitQuote(researcherA, id)).toEqual({ ok: true, state: "Submitted" });

    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.state).toBe("Submitted");
    expect(row?.rejectionReason).toBeNull();
    expect(row?.reviewedById).toBeNull();
    expect(row?.reviewedAt).toBeNull();
    expect(row?.submittedAt).not.toBeNull();
    expect(row?.justification).toBe("Sole regional distributor"); // persists
  });
});
