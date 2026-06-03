import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createDraftQuote,
  updateDraftQuote,
  deleteDraftQuote,
  submitQuote,
  listQuotesForItem,
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

  studyId = (await createStudy(em, { name: "Quote study", clientId: tenantId })).id;

  itemId = (
    await prisma.benchmarkItem.create({
      data: {
        studyId,
        country: "Germany",
        clientPartNumber: "PN-1",
        clientPartNumberKey: "pn-1",
        itemDescription: "Hydraulic widget",
        machineModel: "M1",
        requiredQuotes: 2,
        clientPrice: "123.4500",
      },
    })
  ).id;

  researcherA = await seedResearcher("Researcher A");
  researcherB = await seedResearcher("Researcher B");
  researcherC = await seedResearcher("Researcher C");
  await assignResearchers(em, studyId, "Germany", [researcherA.userId, researcherB.userId]);
});

afterAll(async () => {
  await prisma.quote.deleteMany({ where: { benchmarkItem: { studyId } } });
  await prisma.countryAssignment.deleteMany({ where: { studyId } });
  await prisma.benchmarkItem.deleteMany({ where: { studyId } });
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.user.deleteMany({
    where: { id: { in: [em.userId, researcherA.userId, researcherB.userId, researcherC.userId] } },
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

  it("submits a complete Draft and persists Submitted", async () => {
    const { id } = await createDraftQuote(researcherA, itemId, complete);
    const result = await submitQuote(researcherA, id);
    expect(result).toEqual({ ok: true, state: "Submitted" });
    const row = await prisma.quote.findUnique({ where: { id } });
    expect(row?.state).toBe("Submitted");
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
  });

  it("denies a client user (this read path is internal-only)", async () => {
    const clientUser = { kind: "client", userId: randomUUID(), tenantId } as const;
    await expect(listQuotesForItem(clientUser, itemId)).rejects.toBeInstanceOf(QuoteAccessError);
  });
});
