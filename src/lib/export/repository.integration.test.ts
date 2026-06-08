import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type QuoteState } from "@prisma/client";
import ExcelJS from "exceljs";
import {
  exportClientWorkbook,
  exportInternalWorkbook,
  ExportAccessError,
} from "./repository";
import { createStudy } from "@/lib/studies/repository";
import { releaseCountry } from "@/lib/release/repository";
import type { InternalPrincipal, ClientPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the exports (#15). The workbook column/row shaping is
// unit-tested in src/domains/export; this suite proves the gates the pure core
// can't: the Client Export ranges over released + approved only and NEVER carries
// a Client Price, tenant isolation on the client read, the Internal Export's
// Analyst+EM-only gate (Researcher/Admin/Client refused), that it includes all
// non-Draft quotes but EXCLUDES Drafts (ADR-0011), and that a successful Internal
// Export writes an ExportAudit row (ADR-0018). Runs via `npm run test:integration`.

const prisma = new PrismaClient();

let clientA: string;
let clientB: string;
let analyst: InternalPrincipal;
let em: InternalPrincipal;
let researcher: InternalPrincipal;
let admin: InternalPrincipal;
let clientUserA: ClientPrincipal;
let studyA: string;
let studyB: string;

async function seedUser(role: InternalPrincipal["role"]): Promise<InternalPrincipal> {
  const id = randomUUID();
  await prisma.user.create({
    data: { id, name: role, email: `${role}-${id}@example.test`, emailVerified: true, kind: "internal", role, status: "active" },
  });
  return { kind: "internal", userId: id, role };
}

async function seedClientUser(tenantId: string): Promise<ClientPrincipal> {
  const id = randomUUID();
  await prisma.user.create({
    data: { id, name: "client-user", email: `cu-${id}@example.test`, emailVerified: true, kind: "client", tenantId, status: "active" },
  });
  return { kind: "client", userId: id, tenantId };
}

interface QuoteSpec {
  state: QuoteState;
  competitorBrand: string | null;
  usdPricePerUnit: string | null;
}

async function seedItem(
  studyId: string,
  country: string,
  clientPartNumber: string,
  requiredQuotes: number,
  clientPrice: string | null,
  quotes: QuoteSpec[],
): Promise<void> {
  const item = await prisma.benchmarkItem.create({
    data: {
      studyId,
      country,
      clientPartNumber,
      clientPartNumberKey: randomUUID().slice(0, 8),
      itemDescription: `${clientPartNumber} part`,
      machineModel: "M1",
      requiredQuotes,
      clientPrice,
    },
  });
  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    const converted = q.state === "Approved" || q.state === "Submitted";
    await prisma.quote.create({
      data: {
        benchmarkItemId: item.id,
        quoteNumber: i + 1,
        state: q.state,
        createdById: researcher.userId,
        competitorBrand: q.competitorBrand,
        dealerName: "Acme",
        price: "1000.0000",
        currency: "USD",
        quantityQuoted: 1,
        ...(converted
          ? {
              conversionStatus: "auto",
              exchangeRate: "1.00000000",
              rateDate: new Date("2026-06-01"),
              convertedUsdPrice: q.usdPricePerUnit,
              convertedUsdPricePerUnit: q.usdPricePerUnit,
            }
          : {}),
        ...(q.state === "Approved" ? { reviewedById: analyst.userId, reviewedAt: new Date() } : {}),
      },
    });
  }
}

/** Read a rendered sheet back into an array of {header: value} objects. */
async function readSheet(buffer: Buffer, name: string): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(name);
  if (!ws) return [];
  const headers = (ws.getRow(1).values as unknown[]).slice(1).map(String);
  const out: Record<string, unknown>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const values = (row.values as unknown[]).slice(1);
    const rec: Record<string, unknown> = {};
    headers.forEach((h, i) => (rec[h] = values[i] ?? null));
    out.push(rec);
  });
  return out;
}

beforeAll(async () => {
  clientA = (await prisma.client.create({ data: { name: "Tenant A" } })).id;
  clientB = (await prisma.client.create({ data: { name: "Tenant B" } })).id;

  analyst = await seedUser("Analyst");
  em = await seedUser("EngagementManager");
  researcher = await seedUser("Researcher");
  admin = await seedUser("Admin");
  clientUserA = await seedClientUser(clientA);

  studyA = (await createStudy(analyst, { name: "Study A", clientId: clientA, qcThresholdPct: 25 })).id;
  studyB = (await createStudy(analyst, { name: "Study B", clientId: clientB, qcThresholdPct: 25 })).id;

  // Germany (RELEASED): one approved quote + a Draft (private, must never export)
  // + a Submitted (in-flight). A released country can't actually hold in-flight
  // quotes, but we want the Internal Export to see Submitted/Draft regardless of
  // release, so seed them in an UNRELEASED country (France) below.
  await seedItem(studyA, "Germany", "PN-G1", 1, "1000.0000", [
    { state: "Approved", competitorBrand: "Caterpillar", usdPricePerUnit: "1100.0000" },
  ]);
  // France (NOT released): a Draft, a Submitted, and a Rejected — none client-visible.
  await seedItem(studyA, "France", "PN-F1", 1, "500.0000", [
    { state: "Draft", competitorBrand: "Caterpillar", usdPricePerUnit: null },
    { state: "Submitted", competitorBrand: "Komatsu", usdPricePerUnit: "600.0000" },
    { state: "Rejected", competitorBrand: "Caterpillar", usdPricePerUnit: null },
  ]);

  // Study B (other tenant): a released country, for isolation checks.
  await seedItem(studyB, "Italy", "PN-I1", 1, "800.0000", [
    { state: "Approved", competitorBrand: "Caterpillar", usdPricePerUnit: "800.0000" },
  ]);

  await releaseCountry(analyst, studyA, "Germany");
  await releaseCountry(analyst, studyB, "Italy");
}, 30_000);

afterAll(async () => {
  await prisma.exportAudit.deleteMany({ where: { studyId: { in: [studyA, studyB] } } });
  await prisma.study.deleteMany({ where: { id: { in: [studyA, studyB] } } });
  await prisma.user.deleteMany({
    where: { id: { in: [analyst.userId, em.userId, researcher.userId, admin.userId, clientUserA.userId] } },
  });
  await prisma.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  await prisma.$disconnect();
});

describe("exportClientWorkbook — released + approved, never Client Price", () => {
  it("exports only released countries' approved quotes, with no Client Price column", async () => {
    const buffer = await exportClientWorkbook(clientUserA, studyA);

    const quotes = await readSheet(buffer, "Quotes");
    // Only Germany is released; its single approved quote. France (unreleased)
    // and its Draft/Submitted/Rejected never appear.
    expect(quotes).toHaveLength(1);
    expect(quotes[0]["Country"]).toBe("Germany");
    expect(quotes[0]["Competitor"]).toBe("Caterpillar");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    for (const ws of wb.worksheets) {
      const headers = (ws.getRow(1).values as unknown[]).map(String);
      expect(headers).not.toContain("Client Price");
    }
  });

  it("never leaks another tenant's study to a client user (tenant isolation)", async () => {
    const buffer = await exportClientWorkbook(clientUserA, studyB);
    expect(await readSheet(buffer, "Quotes")).toHaveLength(0);
  });
});

describe("exportInternalWorkbook — Analyst/EM only, all non-Draft, audited", () => {
  it("includes every non-Draft quote across all countries but excludes Drafts", async () => {
    const buffer = await exportInternalWorkbook(analyst, studyA);
    const quotes = await readSheet(buffer, "Quotes");

    // Approved (Germany) + Submitted + Rejected (France) = 3; the Draft is excluded.
    const states = quotes.map((q) => q.State).sort();
    expect(states).toEqual(["Approved", "Rejected", "Submitted"]);
    // Client Price is present for internal staff.
    expect(quotes.find((q) => q.Country === "Germany")?.["Client Price"]).toBe(1000);
  });

  it("allows an Engagement Manager", async () => {
    const buffer = await exportInternalWorkbook(em, studyA);
    expect((await readSheet(buffer, "Quotes")).length).toBeGreaterThan(0);
  });

  it("refuses a Researcher, an Admin, and a Client User", async () => {
    await expect(exportInternalWorkbook(researcher, studyA)).rejects.toBeInstanceOf(ExportAccessError);
    await expect(exportInternalWorkbook(admin, studyA)).rejects.toBeInstanceOf(ExportAccessError);
    await expect(exportInternalWorkbook(clientUserA, studyA)).rejects.toBeInstanceOf(ExportAccessError);
  });

  it("writes an ExportAudit row recording who, which tenant, which study, and the type", async () => {
    await exportInternalWorkbook(analyst, studyA);
    const audit = await prisma.exportAudit.findFirst({
      where: { studyId: studyA, userId: analyst.userId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.clientId).toBe(clientA);
    expect(audit!.exportType).toBe("internal");
  });

  it("does not write an audit row for a refused export", async () => {
    const before = await prisma.exportAudit.count({ where: { studyId: studyA, userId: researcher.userId } });
    await expect(exportInternalWorkbook(researcher, studyA)).rejects.toBeInstanceOf(ExportAccessError);
    const after = await prisma.exportAudit.count({ where: { studyId: studyA, userId: researcher.userId } });
    expect(after).toBe(before);
  });
});
