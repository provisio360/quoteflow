import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type QuoteState } from "@prisma/client";
import {
  releaseCountry,
  reopenCountry,
  listReleasedQuotesForStudy,
  listCountryReleaseStatus,
  ReleaseAccessError,
} from "./repository";
import { createStudy } from "@/lib/studies/repository";
import type { InternalPrincipal, ClientPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the Country Release gate (#13). The releasable judgement
// is unit-tested in src/domains/release/eligibility; this suite proves the gates
// the pure core can't: the Analyst role gate, the atomic re-check-and-upsert that
// persists (and withholds) a release (ADR-0016), reopen reverting client view,
// and the fail-closed client read path — only currently-released + Approved
// quotes, never another tenant's (ADR-0002 / ADR-0008). Runs via
// `npm run test:integration`.

const prisma = new PrismaClient();

let clientA: string;
let clientB: string;
let analyst: InternalPrincipal;
let em: InternalPrincipal;
let researcher: InternalPrincipal;
let clientUserA: ClientPrincipal;
let studyA: string;
let studyB: string;

async function seedUser(role: InternalPrincipal["role"]): Promise<InternalPrincipal> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: role,
      email: `${role}-${id}@example.test`,
      emailVerified: true,
      kind: "internal",
      role,
      status: "active",
    },
  });
  return { kind: "internal", userId: id, role };
}

async function seedClientUser(tenantId: string): Promise<ClientPrincipal> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: "client-user",
      email: `cu-${id}@example.test`,
      emailVerified: true,
      kind: "client",
      tenantId,
      status: "active",
    },
  });
  return { kind: "client", userId: id, tenantId };
}

// Create a Benchmark Item with quotes in the given states. Approved quotes carry
// pinned USD figures so the client read view has something to surface.
async function seedItem(
  studyId: string,
  country: string,
  requiredQuotes: number,
  states: QuoteState[],
): Promise<string> {
  const { clientId } = await prisma.study.findUniqueOrThrow({
    where: { id: studyId },
    select: { clientId: true },
  });
  const item = await prisma.benchmarkItem.create({
    data: {
      studyId,
      clientId,
      country,
      clientPartNumber: `PN-${randomUUID().slice(0, 8)}`,
      clientPartNumberKey: randomUUID().slice(0, 8),
      itemDescription: `${country} part`,
      machineModel: "M1",
      requiredQuotes,
    },
  });
  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    const approved = state === "Approved";
    await prisma.quote.create({
      data: {
        benchmarkItemId: item.id,
        clientId,
        quoteNumber: i + 1,
        state,
        createdById: researcher.userId,
        competitorBrand: "Caterpillar",
        dealerName: "Acme",
        dealerLocation: "Town",
        price: "1000.0000",
        currency: "EUR",
        quantityQuoted: 1,
        ...(approved
          ? {
              conversionStatus: "auto",
              exchangeRate: "1.10000000",
              rateDate: new Date("2026-06-01"),
              convertedUsdPrice: "1100.0000",
              convertedUsdPricePerUnit: "1100.0000",
              reviewedById: analyst.userId,
              reviewedAt: new Date(),
            }
          : {}),
      },
    });
  }
  return item.id;
}

beforeAll(async () => {
  const a = await prisma.client.create({ data: { name: "Tenant A" } });
  const b = await prisma.client.create({ data: { name: "Tenant B" } });
  clientA = a.id;
  clientB = b.id;

  analyst = await seedUser("Analyst");
  em = await seedUser("EngagementManager");
  researcher = await seedUser("Researcher");
  clientUserA = await seedClientUser(clientA);

  studyA = (await createStudy(analyst, { name: "Study A", clientId: clientA, qcThresholdPct: 25 })).id;
  studyB = (await createStudy(analyst, { name: "Study B", clientId: clientB, qcThresholdPct: 25 })).id;

  // Study A countries:
  //  Germany — releasable: one item meets Required (1 approved), one needs zero.
  await seedItem(studyA, "Germany", 1, ["Approved"]);
  await seedItem(studyA, "Germany", 0, []);
  //  France — NOT releasable: an item short of Required (needs 2, has 1 approved).
  await seedItem(studyA, "France", 2, ["Approved"]);
  //  Spain — NOT releasable: Required met but a quote is still in-flight.
  await seedItem(studyA, "Spain", 1, ["Approved", "Draft"]);

  // Study B (other tenant) — a releasable country, used for isolation checks.
  await seedItem(studyB, "Italy", 1, ["Approved"]);
}, 30_000);

afterAll(async () => {
  // Scoped teardown — delete only what this suite seeded, in FK-safe order:
  // deleting the studies cascades their Benchmark Items, Quotes, and Country
  // Releases (onDelete: Cascade); users and clients are Restrict-referenced by
  // those rows, so they come after. Leaves every other suite's data untouched.
  // Audit events (issue #16) aren't FK-tied to the study (their subject is
  // polymorphic), so the study cascade doesn't reach them; clear them before the
  // users they pin via actorId (onDelete: Restrict).
  await prisma.notification.deleteMany({ where: { studyId: { in: [studyA, studyB] } } });
  await prisma.auditEvent.deleteMany({ where: { studyId: { in: [studyA, studyB] } } });
  await prisma.study.deleteMany({ where: { id: { in: [studyA, studyB] } } });
  await prisma.user.deleteMany({
    where: { id: { in: [analyst.userId, em.userId, researcher.userId, clientUserA.userId] } },
  });
  await prisma.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  await prisma.$disconnect();
});

describe("releaseCountry — the precondition gate", () => {
  it("withholds release and writes no row when an item is short of Required Quotes", async () => {
    const result = await releaseCountry(analyst, studyA, "France");
    expect(result).toEqual({ releasable: false, reasons: { shortItems: 1, inFlightItems: 0 } });
    const row = await prisma.countryRelease.findUnique({
      where: { studyId_country: { studyId: studyA, country: "France" } },
    });
    expect(row).toBeNull();
  });

  it("withholds release when an item has an in-flight quote", async () => {
    const result = await releaseCountry(analyst, studyA, "Spain");
    expect(result).toEqual({ releasable: false, reasons: { shortItems: 0, inFlightItems: 1 } });
    const row = await prisma.countryRelease.findUnique({
      where: { studyId_country: { studyId: studyA, country: "Spain" } },
    });
    expect(row).toBeNull();
  });

  it("is not releasable for an unknown country", async () => {
    expect(await releaseCountry(analyst, studyA, "Atlantis")).toEqual({
      releasable: false,
      reasons: { shortItems: 0, inFlightItems: 0 },
    });
  });
});

describe("release / reopen / re-release and the client read path", () => {
  it("releases an eligible country, exposing its approved quotes to the client, and reopen reverts it", async () => {
    // Before release: the client sees nothing for the study.
    expect(await listReleasedQuotesForStudy(clientUserA, studyA)).toEqual([]);

    // Release Germany (eligible).
    expect(await releaseCountry(analyst, studyA, "Germany")).toEqual({ releasable: true });
    const row = await prisma.countryRelease.findUnique({
      where: { studyId_country: { studyId: studyA, country: "Germany" } },
    });
    expect(row?.state).toBe("released");
    expect(row?.releasedById).toBe(analyst.userId);

    // The client now sees the one approved Germany quote, with USD figures, and
    // never France/Spain (unreleased) — and no Client-Price or review fields.
    const visible = await listReleasedQuotesForStudy(clientUserA, studyA);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      country: "Germany",
      competitorBrand: "Caterpillar",
      convertedUsdPricePerUnit: "1100", // Decimal.toString() normalises trailing zeros
    });
    expect(visible[0]).not.toHaveProperty("clientPrice");
    expect(visible[0]).not.toHaveProperty("rejectionReason");

    // Reopen pulls it back from client view…
    await reopenCountry(analyst, studyA, "Germany");
    expect(await listReleasedQuotesForStudy(clientUserA, studyA)).toEqual([]);

    // …and re-release restores it (no re-approval needed).
    expect(await releaseCountry(analyst, studyA, "Germany")).toEqual({ releasable: true });
    expect(await listReleasedQuotesForStudy(clientUserA, studyA)).toHaveLength(1);
  });

  it("never exposes another tenant's released quotes", async () => {
    // Italy in Study B is releasable and released…
    expect(await releaseCountry(analyst, studyB, "Italy")).toEqual({ releasable: true });
    // …but a Tenant-A client user reading Study B sees nothing (out-of-tenant
    // collapses to not-found, ADR-0008).
    expect(await listReleasedQuotesForStudy(clientUserA, studyB)).toEqual([]);
  });
});

describe("audit recording — release / reopen (issue #16 / ADR-0019)", () => {
  const auditForRow = (studyId: string, countryReleaseId: string) =>
    prisma.auditEvent.findMany({
      where: { studyId, subjectType: "CountryRelease", subjectId: countryReleaseId },
      orderBy: { createdAt: "asc" },
    });

  it("records a release event on the CountryRelease row, pinning the analyst", async () => {
    await releaseCountry(analyst, studyB, "Italy"); // eligible per the seed
    const row = await prisma.countryRelease.findUnique({
      where: { studyId_country: { studyId: studyB, country: "Italy" } },
    });
    const events = await auditForRow(studyB, row!.id);
    const release = events.find((e) => e.action === "release");
    expect(release).toBeDefined();
    expect(release!.actorId).toBe(analyst.userId);
  });

  it("records a reopen event, and a withheld release records nothing", async () => {
    await releaseCountry(analyst, studyB, "Italy"); // ensure released
    await reopenCountry(analyst, studyB, "Italy");
    const row = await prisma.countryRelease.findUnique({
      where: { studyId_country: { studyId: studyB, country: "Italy" } },
    });
    const events = await auditForRow(studyB, row!.id);
    expect(events.some((e) => e.action === "reopen")).toBe(true);

    // A withheld release writes no row and no audit event.
    const before = await prisma.auditEvent.count({ where: { studyId: studyA } });
    await releaseCountry(analyst, studyA, "France"); // short of Required Quotes
    expect(await prisma.auditEvent.count({ where: { studyId: studyA } })).toBe(before);
  });
});

describe("authorization — release/reopen are Analyst-only", () => {
  it("rejects release by non-Analyst principals", async () => {
    await expect(releaseCountry(em, studyA, "Germany")).rejects.toBeInstanceOf(ReleaseAccessError);
    await expect(releaseCountry(researcher, studyA, "Germany")).rejects.toBeInstanceOf(ReleaseAccessError);
    await expect(releaseCountry(clientUserA, studyA, "Germany")).rejects.toBeInstanceOf(ReleaseAccessError);
  });

  it("rejects reopen by a non-Analyst, and reopen of a not-currently-released country", async () => {
    await expect(reopenCountry(em, studyA, "Germany")).rejects.toBeInstanceOf(ReleaseAccessError);
    await expect(reopenCountry(analyst, studyA, "France")).rejects.toBeInstanceOf(ReleaseAccessError);
  });
});

describe("listCountryReleaseStatus — the analyst view", () => {
  it("reports each country's eligibility and current release state", async () => {
    const statuses = await listCountryReleaseStatus(analyst, studyA);
    const byCountry = new Map(statuses.map((s) => [s.country, s]));

    expect(byCountry.get("Germany")).toEqual({
      country: "Germany",
      eligibility: { releasable: true },
      releaseState: "released",
    });
    expect(byCountry.get("France")).toEqual({
      country: "France",
      eligibility: { releasable: false, reasons: { shortItems: 1, inFlightItems: 0 } },
      releaseState: null,
    });
    expect(byCountry.get("Spain")).toEqual({
      country: "Spain",
      eligibility: { releasable: false, reasons: { shortItems: 0, inFlightItems: 1 } },
      releaseState: null,
    });
  });

  it("is Analyst-only", async () => {
    await expect(listCountryReleaseStatus(em, studyA)).rejects.toBeInstanceOf(ReleaseAccessError);
  });
});
