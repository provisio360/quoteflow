import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  countMyRejectedLines,
  countMyDraftLines,
  countPartProgressForResearcher,
  QuoteAccessError,
} from "./repository";
import { countMyAssignedCountries } from "@/lib/assignments/repository";
import { AssignmentAccessError } from "@/lib/assignments/repository";
import type { ClientPrincipal, InternalPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the Researcher home signals (#59): own rejected-quote
// count, own draft count, and assigned-(study,country) count. All three are
// keyed to the caller's own id (createdById / researcherId = me), so they are
// GLOBAL across tenants (internal staff, "all" scope) yet still self-scoped — a
// quote authored by another researcher must never lift my count. The shared DB
// carries cross-suite pollution, but a per-researcher count keyed to a fresh
// randomUUID author starts at a clean zero, so here we assert ABSOLUTE totals.

const prisma = new PrismaClient();

let tenantId: string;
let me: InternalPrincipal;
let other: InternalPrincipal;
let studyId: string;
let itemId: string;
let quoteSeq = 0;

async function seedResearcher(label: string): Promise<string> {
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
  return id;
}

async function seedQuote(
  authorId: string,
  state: "Draft" | "Submitted" | "Approved" | "Rejected",
): Promise<void> {
  const n = ++quoteSeq;
  const item = await prisma.benchmarkItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { studyId: true, country: true },
  });
  const doc = await prisma.marketQuote.create({
    data: {
      studyId: item.studyId,
      clientId: tenantId,
      country: item.country,
      marketQuoteNumber: n,
      createdById: authorId,
    },
  });
  await prisma.quoteLine.create({
    data: {
      marketQuoteId: doc.id,
      benchmarkItemId: itemId,
      clientId: tenantId,
      studyId: item.studyId,
      country: item.country,
      quoteLineNumber: n,
      state,
      createdById: authorId,
    },
  });
}

beforeAll(async () => {
  const client = await prisma.client.create({
    data: { name: "Tenant (researcher-signals test)" },
  });
  tenantId = client.id;

  me = { kind: "internal", userId: await seedResearcher("R-me"), role: "Researcher" };
  other = {
    kind: "internal",
    userId: await seedResearcher("R-other"),
    role: "Researcher",
  };

  const study = await prisma.study.create({
    data: { name: "S", clientId: tenantId, qcThreshold: 0.25, createdById: me.userId },
  });
  studyId = study.id;
  const item = await prisma.benchmarkItem.create({
    data: {
      studyId,
      clientId: tenantId,
      country: "Germany",
      clientItemNumber: "PN-1",
      clientItemNumberKey: "pn-1",
      itemDescription: "Widget",
      clientSourceUnit: "M1",
      requiredQuotes: 1,
    },
  });
  itemId = item.id;
});

afterAll(async () => {
  await prisma.quoteLine.deleteMany({ where: { clientId: tenantId } });
  await prisma.marketQuote.deleteMany({ where: { clientId: tenantId } });
  await prisma.quoteNumberSequence.deleteMany({ where: { clientId: tenantId } });
  await prisma.countryAssignment.deleteMany({ where: { clientId: tenantId } });
  await prisma.benchmarkItem.deleteMany({ where: { clientId: tenantId } });
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: [me.userId, other.userId] } } });
  await prisma.client.deleteMany({ where: { id: tenantId } });
});

describe("Researcher home signals (#59)", () => {
  it("counts only my own Rejected and Draft quotes, ignoring other states and other authors", async () => {
    expect(await countMyRejectedLines(me)).toBe(0);
    expect(await countMyDraftLines(me)).toBe(0);

    await seedQuote(me.userId, "Rejected");
    await seedQuote(me.userId, "Rejected");
    await seedQuote(me.userId, "Draft");
    // Other states by me must not count toward either signal.
    await seedQuote(me.userId, "Submitted");
    await seedQuote(me.userId, "Approved");
    // Another researcher's quotes must never lift my counts (createdById scope).
    await seedQuote(other.userId, "Rejected");
    await seedQuote(other.userId, "Draft");

    expect(await countMyRejectedLines(me)).toBe(2);
    expect(await countMyDraftLines(me)).toBe(1);
  });

  it("counts each (study, country) assignment once — same country in two studies counts twice", async () => {
    expect(await countMyAssignedCountries(me)).toBe(0);

    const studyB = await prisma.study.create({
      data: { name: "S2", clientId: tenantId, qcThreshold: 0.25, createdById: me.userId },
    });
    // Germany in two studies, plus France in the first — three distinct pairs.
    await prisma.countryAssignment.createMany({
      data: [
        { studyId, clientId: tenantId, country: "Germany", researcherId: me.userId, assignedById: me.userId },
        { studyId, clientId: tenantId, country: "France", researcherId: me.userId, assignedById: me.userId },
        { studyId: studyB.id, clientId: tenantId, country: "Germany", researcherId: me.userId, assignedById: me.userId },
        // Another researcher's assignment must not count.
        { studyId, clientId: tenantId, country: "Spain", researcherId: other.userId, assignedById: me.userId },
      ],
    });

    expect(await countMyAssignedCountries(me)).toBe(3);
  });

  it("rejects a client user — researcher signals are internal-only", async () => {
    const client: ClientPrincipal = { kind: "client", userId: randomUUID(), tenantId };
    await expect(countMyRejectedLines(client)).rejects.toBeInstanceOf(QuoteAccessError);
    await expect(countMyDraftLines(client)).rejects.toBeInstanceOf(QuoteAccessError);
    await expect(countMyAssignedCountries(client)).rejects.toBeInstanceOf(
      AssignmentAccessError,
    );
  });
});

// Per-part layered progress for the Collect surface (#142): approved is ALL-author
// (the Release-Eligibility figure); in-flight (Draft/Submitted) is the caller's OWN
// lines only. Rejected counts toward neither. Keyed per Benchmark Item.
describe("countPartProgressForResearcher (#142)", () => {
  let progStudyId: string;
  let itemX: string;
  let itemY: string;
  let itemZ: string;
  let seq = 0;

  async function seedLine(
    itemId: string,
    country: string,
    authorId: string,
    state: "Draft" | "Submitted" | "Approved" | "Rejected",
  ): Promise<void> {
    const n = 5000 + ++seq; // own band, clear of the other suite's quoteSeq
    const doc = await prisma.marketQuote.create({
      data: {
        studyId: progStudyId,
        clientId: tenantId,
        country,
        marketQuoteNumber: n,
        createdById: authorId,
      },
    });
    await prisma.quoteLine.create({
      data: {
        marketQuoteId: doc.id,
        benchmarkItemId: itemId,
        clientId: tenantId,
        studyId: progStudyId,
        country,
        quoteLineNumber: n,
        state,
        createdById: authorId,
      },
    });
  }

  beforeAll(async () => {
    const study = await prisma.study.create({
      data: { name: "S-prog", clientId: tenantId, qcThreshold: 0.25, createdById: me.userId },
    });
    progStudyId = study.id;
    const mk = async (pn: string): Promise<string> => {
      const it = await prisma.benchmarkItem.create({
        data: {
          studyId: progStudyId,
          clientId: tenantId,
          country: "Germany",
          clientItemNumber: pn,
          clientItemNumberKey: pn.toLowerCase(),
          itemDescription: "Widget",
          clientSourceUnit: "M1",
          requiredQuotes: 3,
        },
      });
      return it.id;
    };
    itemX = await mk("PROG-X");
    itemY = await mk("PROG-Y");
    itemZ = await mk("PROG-Z"); // no lines — must be absent from the map

    // X: 2 approved (me + peer), 2 of my in-flight (Draft + Submitted), and noise.
    await seedLine(itemX, "Germany", me.userId, "Approved");
    await seedLine(itemX, "Germany", other.userId, "Approved");
    await seedLine(itemX, "Germany", me.userId, "Draft");
    await seedLine(itemX, "Germany", me.userId, "Submitted");
    await seedLine(itemX, "Germany", me.userId, "Rejected"); // neither approved nor in-flight
    await seedLine(itemX, "Germany", other.userId, "Draft"); // peer's draft — not mine
    await seedLine(itemX, "Germany", other.userId, "Submitted"); // peer's submit — not mine
    // Y: just one of my approved.
    await seedLine(itemY, "Germany", me.userId, "Approved");
  });

  it("returns all-author approved and my-own in-flight per item; parts with no lines are absent", async () => {
    const progress = await countPartProgressForResearcher(me, progStudyId);

    expect(progress.get(itemX)).toEqual({ approvedCount: 2, myInFlightCount: 2 });
    expect(progress.get(itemY)).toEqual({ approvedCount: 1, myInFlightCount: 0 });
    expect(progress.has(itemZ)).toBe(false);
  });

  it("in-flight is caller-scoped — the peer sees their own in-flight, not mine", async () => {
    const progress = await countPartProgressForResearcher(other, progStudyId);
    // Peer authored 1 Draft + 1 Submitted on X → 2 in-flight; approved still all-author.
    expect(progress.get(itemX)).toEqual({ approvedCount: 2, myInFlightCount: 2 });
  });

  it("rejects a client user — internal-only", async () => {
    const client: ClientPrincipal = { kind: "client", userId: randomUUID(), tenantId };
    await expect(countPartProgressForResearcher(client, progStudyId)).rejects.toBeInstanceOf(
      QuoteAccessError,
    );
  });
});
