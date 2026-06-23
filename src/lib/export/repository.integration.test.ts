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
  clientItemNumber: string,
  requiredQuotes: number,
  clientPrice: string | null,
  quotes: QuoteSpec[],
): Promise<void> {
  const { clientId } = await prisma.study.findUniqueOrThrow({
    where: { id: studyId },
    select: { clientId: true },
  });
  const item = await prisma.benchmarkItem.create({
    data: {
      studyId,
      clientId,
      country,
      clientItemNumber,
      clientItemNumberKey: randomUUID().slice(0, 8),
      itemDescription: `${clientItemNumber} part`,
      clientSourceUnit: "M1",
      requiredQuotes,
      clientPrice,
    },
  });
  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    const converted = q.state === "Approved" || q.state === "Submitted";
    // One-line Market Quote per seed quote (ADR-0026): conversion on the document,
    // state + derived USD on the line.
    const doc = await prisma.marketQuote.create({
      data: {
        studyId,
        clientId,
        country,
        marketQuoteNumber: i + 1,
        createdById: researcher.userId,
        sourceName: "Acme",
        currency: "USD",
        ...(converted
          ? { conversionStatus: "auto", exchangeRate: "1.00000000", rateDate: new Date("2026-06-01") }
          : {}),
      },
    });
    await prisma.quoteLine.create({
      data: {
        marketQuoteId: doc.id,
        benchmarkItemId: item.id,
        clientId,
        studyId,
        country,
        quoteLineNumber: i + 1,
        state: q.state,
        createdById: researcher.userId,
        competitorBrand: q.competitorBrand,
        price: "1000.0000",
        quantityQuoted: 1,
        ...(converted
          ? { convertedUsdPrice: q.usdPricePerUnit, convertedUsdPricePerUnit: q.usdPricePerUnit }
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

  studyA = (await createStudy(analyst, { name: "Study A", clientId: clientA, qcThreshold: 0.25 })).id;
  studyB = (await createStudy(analyst, { name: "Study B", clientId: clientB, qcThreshold: 0.25 })).id;

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
  await prisma.notification.deleteMany({ where: { studyId: { in: [studyA, studyB] } } });
  await prisma.auditEvent.deleteMany({ where: { studyId: { in: [studyA, studyB] } } });
  await prisma.study.deleteMany({ where: { id: { in: [studyA, studyB] } } });
  await prisma.user.deleteMany({
    where: { id: { in: [analyst.userId, em.userId, researcher.userId, admin.userId, clientUserA.userId] } },
  });
  await prisma.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  await prisma.$disconnect();
});

describe("exportClientWorkbook — released + approved, never Client Price", () => {
  it("exports only released countries' approved lines into a study-named sheet, with a Summary and no Client Price", async () => {
    const buffer = await exportClientWorkbook(clientUserA, studyA);

    const detail = await readSheet(buffer, "Study A");
    // Only Germany is released; its single approved line. France (unreleased)
    // and its Draft/Submitted/Rejected never appear. Market is now a column.
    expect(detail).toHaveLength(1);
    expect(detail[0]["Market"]).toBe("Germany");
    expect(detail[0]["Competitor Brand"]).toBe("Caterpillar");
    expect(detail[0]["Converted Currency"]).toBe("USD");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    // One study-named detail sheet + a global Summary.
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Study A", "Summary"]);
    // Neither the Client Price nor any analyst-only column may appear.
    for (const ws of wb.worksheets) {
      const headers = (ws.getRow(1).values as unknown[]).map(String);
      expect(headers).not.toContain("Client Item Price (USD/unit)");
      expect(headers).not.toContain("Quoted Price Difference to Client Price");
      expect(headers).not.toContain("Paper Quote");
    }
  });

  it("never leaks another tenant's study to a client user (tenant isolation)", async () => {
    const buffer = await exportClientWorkbook(clientUserA, studyB);
    expect(await readSheet(buffer, "Study B")).toHaveLength(0);
  });

  it("refuses a Researcher — the anti-anchoring side door (#64, ADR-0003)", async () => {
    await expect(exportClientWorkbook(researcher, studyA)).rejects.toBeInstanceOf(ExportAccessError);
  });

  it("admits internal EM, Analyst, and Admin", async () => {
    expect(await readSheet(await exportClientWorkbook(em, studyA), "Study A")).toHaveLength(1);
    expect(await readSheet(await exportClientWorkbook(analyst, studyA), "Study A")).toHaveLength(1);
    expect(await readSheet(await exportClientWorkbook(admin, studyA), "Study A")).toHaveLength(1);
  });
});

describe("exportInternalWorkbook — Analyst/EM only, all non-Draft, audited", () => {
  it("includes every non-Draft line across all countries but excludes Drafts, with Client Price", async () => {
    const buffer = await exportInternalWorkbook(analyst, studyA);
    const lines = await readSheet(buffer, "Study A");

    // Approved (Germany) + Submitted + Rejected (France) = 3; the Draft is excluded
    // (4 lines were seeded). The appended State column proves which survived.
    expect(lines.map((l) => l.State).sort()).toEqual(["Approved", "Rejected", "Submitted"]);
    expect(new Set(lines.map((l) => l.Market))).toEqual(new Set(["Germany", "France"]));
    // Client Item Price (USD/unit) is present for internal staff.
    expect(lines.find((l) => l.Market === "Germany")?.["Client Item Price (USD/unit)"]).toBe(1000);
  });

  it("allows an Engagement Manager", async () => {
    const buffer = await exportInternalWorkbook(em, studyA);
    expect((await readSheet(buffer, "Study A")).length).toBeGreaterThan(0);
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
