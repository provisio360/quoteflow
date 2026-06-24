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
  const clientUserId = await ensureUser({
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
      qcThreshold: "0.2500",
    },
  });

  // ── Benchmark items across two countries ────────────────────────────────
  const itemsData = [
    {
      country: "Germany",
      clientItemNumber: "GX-1001",
      itemDescription: "Hydraulic excavator arm cylinder",
      clientSourceUnit: "EX-220",
      quantity: 4,
      requiredQuotes: 3,
      clientPrice: "12500.0000",
      primaryResearcherId: researcher1Id,
    },
    {
      country: "Germany",
      clientItemNumber: "GX-1002",
      itemDescription: "Track roller assembly",
      clientSourceUnit: "EX-220",
      quantity: 8,
      requiredQuotes: 3,
      clientPrice: "3200.0000",
      primaryResearcherId: researcher1Id,
    },
    {
      country: "France",
      clientItemNumber: "GX-2001",
      itemDescription: "Diesel engine turbocharger",
      clientSourceUnit: "LD-90",
      quantity: 2,
      requiredQuotes: 2,
      clientPrice: "8800.0000",
      primaryResearcherId: researcher2Id,
    },
    {
      country: "France",
      clientItemNumber: "GX-2002",
      itemDescription: "Cab air-conditioning compressor",
      clientSourceUnit: "LD-90",
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
        clientId: client.id,
        country: it.country,
        clientItemNumber: it.clientItemNumber,
        clientItemNumberKey: it.clientItemNumber.toLowerCase(),
        itemDescription: it.itemDescription,
        clientSourceUnit: it.clientSourceUnit,
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
      { studyId: study.id, clientId: client.id, country: "Germany", researcherId: researcher1Id, assignedById: emId },
      { studyId: study.id, clientId: client.id, country: "France", researcherId: researcher2Id, assignedById: emId },
    ],
  });

  // ── Quotes in a spread of lifecycle states (ADR-0026) ───────────────────
  // Each seed call becomes a one-line Market Quote (the by-row case): document
  // facts (source/date/currency/conversion) on the Market Quote, per-item facts +
  // state on the Quote Line. Numbers run 1..N per (study, country), held in memory
  // since the seed is single-threaded.
  const DOC_KEYS = new Set(["currency", "dateQuoteReceived", "exchangeRate", "rateDate", "conversionStatus"]);
  const RENAME: Record<string, string> = {
    dealerName: "sourceName",
    dealerLocation: "sourceLocality",
    dealerCountry: "sourceCountry",
    dealerUrl: "sourceUrl",
  };
  const seqByMarket = new Map<string, number>();

  async function addQuote(
    itemId: string,
    createdById: string,
    data: Record<string, unknown>,
  ) {
    const item = await prisma.benchmarkItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { studyId: true, country: true },
    });
    const key = `${item.studyId}|${item.country}`;
    const n = (seqByMarket.get(key) ?? 0) + 1;
    seqByMarket.set(key, n);

    const docData: Record<string, unknown> = {};
    const lineData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k in RENAME) docData[RENAME[k]] = v;
      else if (DOC_KEYS.has(k)) docData[k] = v;
      else lineData[k] = v;
    }

    const doc = await prisma.marketQuote.create({
      data: {
        studyId: item.studyId,
        clientId: client.id,
        country: item.country,
        marketQuoteNumber: n,
        createdById,
        ...docData,
      },
    });
    return prisma.quoteLine.create({
      data: {
        marketQuoteId: doc.id,
        benchmarkItemId: itemId,
        clientId: client.id,
        studyId: item.studyId,
        country: item.country,
        createdById,
        quoteLineNumber: n,
        ...lineData,
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
    dealerLocation: "Munich",
    dealerCountry: "Germany",
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
    dealerLocation: "Berlin",
    dealerCountry: "Germany",
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
    dealerLocation: "Cologne",
    dealerCountry: "Germany",
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
    dealerLocation: "Stuttgart",
    dealerCountry: "Germany",
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
    dealerCountry: "Germany",
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
    dealerLocation: "Lyon",
    dealerCountry: "France",
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
  // Germany is deliberately not eligibility-clean (GX-1001 keeps a Submitted
  // quote for TC010), so we can't drive this through releaseCountry()'s gate.
  // We still mirror the rest of that path's side effects by hand: stamp
  // clientNotifiedAt and write the client's "Results released" Notification —
  // otherwise the released country has no in-app notification and TC041 fails.
  const release = await prisma.countryRelease.create({
    data: {
      studyId: study.id,
      clientId: client.id,
      country: "Germany",
      state: "released",
      releasedById: analystId,
      releasedAt: new Date("2026-05-20"),
      clientNotifiedAt: new Date("2026-05-20"),
    },
  });
  await prisma.notification.create({
    data: {
      recipientId: clientUserId,
      kind: "countryReleased",
      studyId: study.id,
      subjectType: "CountryRelease",
      subjectId: release.id,
      country: "Germany",
    },
  });

  console.info("✅ Sample data seeded:");
  console.info(`   Client:  ${DEMO_CLIENT} (${client.id})`);
  console.info(`   Study:   ${study.name} (${study.id})`);
  console.info(`   Items:   ${items.length} across Germany + France`);
  console.info(`   Quotes:  Approved / Submitted / Rejected / Draft + 1 QC-flagged`);
  console.info(`   Germany released to client (with "Results released" notification).`);
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
