import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { createCredentialUser } from "../src/lib/identity/users";

// One-shot sample-data seed for local UI exploration. Idempotent-ish: it bails
// if the demo client already exists so re-running won't pile up duplicates.
// NOT for production — creates users with known passwords.

const PASSWORD = "quoteflow-demo-1"; // shared demo password for every seeded user

async function ensureUser(args: {
  email: string;
  name: string;
  identity:
    | { kind: "internal"; role: "Admin" | "EngagementManager" | "Researcher" | "Analyst"; tenantId: null }
    | { kind: "client"; role: null; tenantId: string };
}): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { email: args.email.toLowerCase() },
    select: { id: true },
  });
  if (existing) return existing.id;
  const { id } = await createCredentialUser({ ...args, password: PASSWORD });
  return id;
}

async function main() {
  const DEMO_CLIENT = "Globex Manufacturing";
  if (await prisma.client.findFirst({ where: { name: DEMO_CLIENT } })) {
    console.info(`Demo client "${DEMO_CLIENT}" already exists — seed is a no-op.`);
    return;
  }

  // ── Internal staff ──────────────────────────────────────────────────────
  const emId = await ensureUser({
    email: "em@quoteflow.local",
    name: "Erin Manager",
    identity: { kind: "internal", role: "EngagementManager", tenantId: null },
  });
  const analystId = await ensureUser({
    email: "analyst@quoteflow.local",
    name: "Ana List",
    identity: { kind: "internal", role: "Analyst", tenantId: null },
  });
  const researcher1Id = await ensureUser({
    email: "researcher1@quoteflow.local",
    name: "Raj Searcher",
    identity: { kind: "internal", role: "Researcher", tenantId: null },
  });
  const researcher2Id = await ensureUser({
    email: "researcher2@quoteflow.local",
    name: "Rosa Finder",
    identity: { kind: "internal", role: "Researcher", tenantId: null },
  });

  // ── Tenant (Client) + Client User ──────────────────────────────────────
  const client = await prisma.client.create({ data: { name: DEMO_CLIENT } });
  await ensureUser({
    email: "client@globex.com",
    name: "Cleo Buyer",
    identity: { kind: "client", role: null, tenantId: client.id },
  });

  // ── Study ───────────────────────────────────────────────────────────────
  const study = await prisma.study.create({
    data: {
      name: "Globex 2026 Heavy Equipment Benchmark",
      clientId: client.id,
      createdById: emId,
      qcThresholdPct: "25.00",
    },
  });

  // ── Benchmark items across two countries ────────────────────────────────
  const itemsData = [
    {
      country: "Germany",
      clientPartNumber: "GX-1001",
      itemDescription: "Hydraulic excavator arm cylinder",
      machineModel: "EX-220",
      quantity: 4,
      requiredQuotes: 3,
      clientPrice: "12500.0000",
      primaryResearcherId: researcher1Id,
    },
    {
      country: "Germany",
      clientPartNumber: "GX-1002",
      itemDescription: "Track roller assembly",
      machineModel: "EX-220",
      quantity: 8,
      requiredQuotes: 3,
      clientPrice: "3200.0000",
      primaryResearcherId: researcher1Id,
    },
    {
      country: "France",
      clientPartNumber: "GX-2001",
      itemDescription: "Diesel engine turbocharger",
      machineModel: "LD-90",
      quantity: 2,
      requiredQuotes: 2,
      clientPrice: "8800.0000",
      primaryResearcherId: researcher2Id,
    },
    {
      country: "France",
      clientPartNumber: "GX-2002",
      itemDescription: "Cab air-conditioning compressor",
      machineModel: "LD-90",
      quantity: 6,
      requiredQuotes: 2,
      clientPrice: null, // unpriced — exercises the nullable Client Price path
      primaryResearcherId: null,
    },
  ];

  const items = [];
  for (const it of itemsData) {
    const item = await prisma.benchmarkItem.create({
      data: {
        studyId: study.id,
        country: it.country,
        clientPartNumber: it.clientPartNumber,
        clientPartNumberKey: it.clientPartNumber.toLowerCase(),
        itemDescription: it.itemDescription,
        machineModel: it.machineModel,
        quantity: it.quantity,
        requiredQuotes: it.requiredQuotes,
        clientPrice: it.clientPrice,
        primaryResearcherId: it.primaryResearcherId,
      },
    });
    items.push(item);
  }

  // ── Country assignments (EM puts researchers on countries) ──────────────
  await prisma.countryAssignment.createMany({
    data: [
      { studyId: study.id, country: "Germany", researcherId: researcher1Id, assignedById: emId },
      { studyId: study.id, country: "France", researcherId: researcher2Id, assignedById: emId },
    ],
  });

  // ── Quotes in a spread of lifecycle states ──────────────────────────────
  // Helper to allocate a per-item quote number atomically (mirrors ADR-0010).
  async function addQuote(
    itemId: string,
    createdById: string,
    data: Record<string, unknown>,
  ) {
    const item = await prisma.benchmarkItem.update({
      where: { id: itemId },
      data: { quoteSeq: { increment: 1 } },
      select: { quoteSeq: true },
    });
    return prisma.quote.create({
      data: {
        benchmarkItemId: itemId,
        quoteNumber: item.quoteSeq,
        createdById,
        ...data,
      },
    });
  }

  const usd = (
    rate: number,
    price: number,
    qty: number,
  ) => ({
    exchangeRate: rate.toFixed(8),
    rateDate: new Date("2026-05-15"),
    convertedUsdPrice: (price * rate).toFixed(4),
    convertedUsdPricePerUnit: ((price * rate) / qty).toFixed(4),
    conversionStatus: "auto" as const,
  });

  // GX-1001 (Germany, EUR) — two Approved + one Submitted (pending review)
  await addQuote(items[0].id, researcher1Id, {
    state: "Approved",
    competitorBrand: "Bosch Rexroth",
    dealerName: "Hydratec GmbH",
    dealerLocation: "Munich, DE",
    price: "11800.0000",
    currency: "EUR",
    quantityQuoted: 4,
    dateQuoteReceived: new Date("2026-05-10"),
    submittedAt: new Date("2026-05-12"),
    reviewedById: analystId,
    reviewedAt: new Date("2026-05-13"),
    ...usd(1.08, 11800, 4),
  });
  await addQuote(items[0].id, researcher1Id, {
    state: "Approved",
    competitorBrand: "Parker Hannifin",
    dealerName: "FluidPower Direct",
    dealerLocation: "Berlin, DE",
    price: "12200.0000",
    currency: "EUR",
    quantityQuoted: 4,
    dateQuoteReceived: new Date("2026-05-11"),
    submittedAt: new Date("2026-05-12"),
    reviewedById: analystId,
    reviewedAt: new Date("2026-05-13"),
    ...usd(1.08, 12200, 4),
  });
  await addQuote(items[0].id, researcher1Id, {
    state: "Submitted",
    competitorBrand: "Eaton",
    dealerName: "Eaton Hydraulics EU",
    dealerLocation: "Cologne, DE",
    price: "13100.0000",
    currency: "EUR",
    quantityQuoted: 4,
    dateQuoteReceived: new Date("2026-05-14"),
    submittedAt: new Date("2026-05-15"),
    ...usd(1.08, 13100, 4),
  });

  // GX-1002 (Germany, EUR) — one Approved, one Rejected
  await addQuote(items[1].id, researcher1Id, {
    state: "Approved",
    competitorBrand: "SKF",
    dealerName: "Bearing World",
    dealerLocation: "Stuttgart, DE",
    price: "3050.0000",
    currency: "EUR",
    quantityQuoted: 8,
    dateQuoteReceived: new Date("2026-05-09"),
    submittedAt: new Date("2026-05-10"),
    reviewedById: analystId,
    reviewedAt: new Date("2026-05-11"),
    ...usd(1.08, 3050, 8),
  });
  await addQuote(items[1].id, researcher1Id, {
    state: "Rejected",
    competitorBrand: "Generic Imports",
    dealerName: "CheapParts Ltd",
    dealerLocation: "Unknown",
    price: "1900.0000",
    currency: "EUR",
    quantityQuoted: 8,
    dateQuoteReceived: new Date("2026-05-09"),
    submittedAt: new Date("2026-05-10"),
    reviewedById: analystId,
    reviewedAt: new Date("2026-05-11"),
    rejectionReason: "Price implausibly low; could not verify dealer is authorized.",
    ...usd(1.08, 1900, 8),
  });

  // GX-2001 (France, EUR) — a Submitted quote that is QC-flagged (>25% over Client Price)
  // Client Price 8800/unit, qty 2 -> this quote at 12000/unit USD diverges hard.
  await addQuote(items[2].id, researcher2Id, {
    state: "Submitted",
    competitorBrand: "Garrett Motion",
    dealerName: "TurboFrance SARL",
    dealerLocation: "Lyon, FR",
    price: "22000.0000",
    currency: "EUR",
    quantityQuoted: 2,
    dateQuoteReceived: new Date("2026-05-16"),
    submittedAt: new Date("2026-05-17"),
    justification: "Only OEM-authorized supplier in region; premium reflects genuine part.",
    ...usd(1.08, 22000, 2),
  });

  // GX-2001 — one Draft (private to researcher2, exercises Draft visibility)
  await addQuote(items[2].id, researcher2Id, {
    state: "Draft",
    competitorBrand: "BorgWarner",
    dealerName: "EuroTurbo",
    price: "16500.0000",
    currency: "EUR",
    quantityQuoted: 2,
  });

  // ── Release Germany (its approved quotes become client-visible) ─────────
  await prisma.countryRelease.create({
    data: {
      studyId: study.id,
      country: "Germany",
      state: "released",
      releasedById: analystId,
      releasedAt: new Date("2026-05-20"),
    },
  });

  console.info("✅ Sample data seeded:");
  console.info(`   Client:  ${DEMO_CLIENT} (${client.id})`);
  console.info(`   Study:   ${study.name} (${study.id})`);
  console.info(`   Items:   ${items.length} across Germany + France`);
  console.info(`   Quotes:  Approved / Submitted / Rejected / Draft + 1 QC-flagged`);
  console.info(`   Germany released to client.`);
  console.info("");
  console.info(`   Demo login password (all seeded users): ${PASSWORD}`);
  console.info(`     EM:         em@quoteflow.local`);
  console.info(`     Analyst:    analyst@quoteflow.local`);
  console.info(`     Researcher: researcher1@quoteflow.local / researcher2@quoteflow.local`);
  console.info(`     Client:     client@globex.com`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
