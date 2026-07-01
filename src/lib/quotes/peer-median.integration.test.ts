import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { peerMedianUsdPerUnitByItem } from "./repository";
import type { InternalPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the peer-median read behind the Researcher's live
// peer-spread nudge (#163 / ADR-0042). The population for a Benchmark Item is its
// OTHER lines that carry a USD figure — Submitted + Approved, converted — the pack
// ADR-0003 §3 already lets researchers see. Peer Drafts, pending (no USD), and
// Rejected lines are excluded; author is not a filter. Fewer than 2 peers → null
// (no market median), so the first quote for an item is never flaggable.

const prisma = new PrismaClient();

let tenantId: string;
let me: InternalPrincipal;
let other: InternalPrincipal;
let studyId: string;
let itemId: string;
let sparseItemId: string;
let seq = 0;

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

/** Seed one line for `item` in the given state, with an optional converted USD/unit. */
async function seedLine(
  item: string,
  authorId: string,
  state: "Draft" | "Submitted" | "Approved" | "Rejected",
  usdPerUnit: number | null,
): Promise<void> {
  const n = ++seq;
  const bi = await prisma.benchmarkItem.findUniqueOrThrow({
    where: { id: item },
    select: { studyId: true, country: true },
  });
  const doc = await prisma.marketQuote.create({
    data: {
      studyId: bi.studyId,
      clientId: tenantId,
      country: bi.country,
      marketQuoteNumber: n,
      createdById: authorId,
      conversionStatus: usdPerUnit === null ? null : "studyRate",
    },
  });
  await prisma.quoteLine.create({
    data: {
      marketQuoteId: doc.id,
      benchmarkItemId: item,
      clientId: tenantId,
      studyId: bi.studyId,
      country: bi.country,
      quoteLineNumber: n,
      state,
      createdById: authorId,
      convertedUsdPricePerUnit: usdPerUnit,
    },
  });
}

async function seedItem(studyIdArg: string, itemNumber: string): Promise<string> {
  const bi = await prisma.benchmarkItem.create({
    data: {
      studyId: studyIdArg,
      clientId: tenantId,
      country: "Germany",
      clientItemNumber: itemNumber,
      clientItemNumberKey: itemNumber.toLowerCase(),
      itemDescription: "Widget",
      clientSourceUnit: "M1",
      requiredQuotes: 1,
    },
  });
  return bi.id;
}

beforeAll(async () => {
  const client = await prisma.client.create({ data: { name: "Tenant (peer-median test)" } });
  tenantId = client.id;
  me = { kind: "internal", userId: await seedResearcher("R-me"), role: "Researcher" };
  other = { kind: "internal", userId: await seedResearcher("R-other"), role: "Researcher" };
  const study = await prisma.study.create({
    data: { name: "S", clientId: tenantId, qcThreshold: 0.25, createdById: me.userId },
  });
  studyId = study.id;
  itemId = await seedItem(studyId, "PN-1");
  sparseItemId = await seedItem(studyId, "PN-2");
});

afterAll(async () => {
  await prisma.quoteLine.deleteMany({ where: { clientId: tenantId } });
  await prisma.marketQuote.deleteMany({ where: { clientId: tenantId } });
  await prisma.benchmarkItem.deleteMany({ where: { clientId: tenantId } });
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: [me.userId, other.userId] } } });
  await prisma.client.deleteMany({ where: { id: tenantId } });
});

describe("peerMedianUsdPerUnitByItem (#163)", () => {
  it("medians only the item's converted Submitted+Approved peers, ignoring Draft/Rejected/pending and other authors' non-USD lines", async () => {
    // The pack: two converted Submitted + one converted Approved (any author) → median.
    await seedLine(itemId, me.userId, "Submitted", 90);
    await seedLine(itemId, other.userId, "Submitted", 110);
    await seedLine(itemId, other.userId, "Approved", 100);
    // Excluded: peer Draft, Rejected, and a Submitted-but-pending line (no USD point).
    await seedLine(itemId, other.userId, "Draft", 5000);
    await seedLine(itemId, me.userId, "Rejected", 5000);
    await seedLine(itemId, other.userId, "Submitted", null);

    const map = await peerMedianUsdPerUnitByItem(me, [itemId]);
    expect(map.get(itemId)).toBe(100); // median(90,100,110)
  });

  it("returns null for an item with fewer than 2 converted peers — the first quote is never flaggable", async () => {
    await seedLine(sparseItemId, me.userId, "Submitted", 100); // lone peer
    const map = await peerMedianUsdPerUnitByItem(me, [sparseItemId]);
    expect(map.get(sparseItemId)).toBeNull();
  });

  it("returns a null entry for every requested item, even with no peers at all", async () => {
    const unknown = await seedItem(studyId, "PN-3");
    const map = await peerMedianUsdPerUnitByItem(me, [unknown]);
    expect(map.has(unknown)).toBe(true);
    expect(map.get(unknown)).toBeNull();
  });
});
