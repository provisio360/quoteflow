import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  setStudyRate,
  listStudyRates,
  ExchangeRateAccessError,
  ExchangeRateValidationError,
} from "./repository";
import { createStudy } from "@/lib/studies/repository";
import type { ClientPrincipal, InternalPrincipal } from "@/domains/authz/principal";

// Real-Postgres proof of the Study Exchange Rate write/read path (#160, ADR-0041).
// The pure validation + authz rules are unit-tested in src/domains/exchange-rates
// and src/domains/authz/exchange-rates; this suite proves the repository's upsert-
// by-key, audit-on-change, USD refusal, role gate and tenant scoping hold against
// live SQL. Runs via `npm run test:integration`.

const prisma = new PrismaClient();

let tenantId: string;
let otherTenantId: string;
let em: InternalPrincipal;
let analyst: InternalPrincipal;
let researcher: InternalPrincipal;
let admin: InternalPrincipal;
let clientUser: ClientPrincipal;
let studyId: string;
let otherStudyId: string;

async function seedInternal(role: InternalPrincipal["role"], label: string): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: label,
      email: `${label}-${id}@example.test`,
      emailVerified: true,
      kind: "internal",
      role,
      status: "active",
    },
  });
  return id;
}

beforeAll(async () => {
  tenantId = (await prisma.client.create({ data: { name: "Tenant (rate test)" } })).id;
  otherTenantId = (await prisma.client.create({ data: { name: "Other tenant (rate test)" } })).id;

  em = { kind: "internal", userId: await seedInternal("EngagementManager", "EM"), role: "EngagementManager" };
  analyst = { kind: "internal", userId: await seedInternal("Analyst", "Analyst"), role: "Analyst" };
  researcher = { kind: "internal", userId: await seedInternal("Researcher", "Researcher"), role: "Researcher" };
  admin = { kind: "internal", userId: await seedInternal("Admin", "Admin"), role: "Admin" };
  clientUser = { kind: "client", userId: await seedInternal("EngagementManager", "CU-placeholder"), tenantId };

  studyId = (await createStudy(em, { name: "Rate study", clientId: tenantId, qcThreshold: 0.25 })).id;
  otherStudyId = (await createStudy(em, { name: "Other study", clientId: otherTenantId, qcThreshold: 0.25 })).id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { studyId: { in: [studyId, otherStudyId] } } });
  await prisma.studyExchangeRate.deleteMany({ where: { studyId: { in: [studyId, otherStudyId] } } });
  await prisma.study.deleteMany({ where: { clientId: { in: [tenantId, otherTenantId] } } });
  await prisma.user.deleteMany({
    where: { id: { in: [em.userId, analyst.userId, researcher.userId, admin.userId] } },
  });
  await prisma.client.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.$disconnect();
});

describe("setStudyRate — an EM/Analyst seeds a rate (happy path)", () => {
  it("persists the row and writes a studyRateSet audit event", async () => {
    const result = await setStudyRate(em, studyId, {
      currency: "eur",
      rateDate: "2026-01-15",
      rate: "1.23456789",
    });
    expect(result.changed).toBe(true);
    expect(result.rate).toMatchObject({ currency: "EUR", rateDate: "2026-01-15", rate: "1.23456789" });

    const rows = await listStudyRates(em, studyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ currency: "EUR", rateDate: "2026-01-15", rate: "1.23456789" });

    const audits = await prisma.auditEvent.findMany({
      where: { studyId, action: "studyRateSet" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      subjectType: "StudyExchangeRate",
      subjectId: result.rate.id,
      actorId: em.userId,
      beforeValue: null,
      afterValue: null,
    });
  });

  it("editing the same (currency, rateDate) updates the value and re-audits", async () => {
    // Same key as the tracer (EUR / 2026-01-15), new value.
    const before = await listStudyRates(em, studyId);
    const eur = before.find((r) => r.currency === "EUR" && r.rateDate === "2026-01-15")!;

    const result = await setStudyRate(analyst, studyId, {
      currency: "EUR",
      rateDate: "2026-01-15",
      rate: "1.5",
    });
    expect(result.changed).toBe(true);
    expect(result.rate.id).toBe(eur.id); // same row, upserted by key
    expect(result.rate.rate).toBe("1.5");

    const after = await listStudyRates(em, studyId);
    expect(after.filter((r) => r.currency === "EUR")).toHaveLength(1); // no duplicate

    const audits = await prisma.auditEvent.findMany({
      where: { studyId, action: "studyRateSet", subjectId: eur.id },
    });
    expect(audits).toHaveLength(2); // create + edit
  });

  it("an identical re-save is a no-op — no new audit event", async () => {
    const auditsBefore = await prisma.auditEvent.count({
      where: { studyId, action: "studyRateSet" },
    });
    const result = await setStudyRate(em, studyId, {
      currency: "EUR",
      rateDate: "2026-01-15",
      rate: "1.5", // identical to the current stored value
    });
    expect(result.changed).toBe(false);
    const auditsAfter = await prisma.auditEvent.count({
      where: { studyId, action: "studyRateSet" },
    });
    expect(auditsAfter).toBe(auditsBefore);
  });
});

describe("setStudyRate — refusals write nothing", () => {
  it("refuses USD (rate ≡ 1)", async () => {
    await expect(
      setStudyRate(em, studyId, { currency: "USD", rateDate: "2026-02-01", rate: "1" }),
    ).rejects.toMatchObject({ code: "usd-not-allowed" });
    const rows = await listStudyRates(em, studyId);
    expect(rows.find((r) => r.currency === "USD")).toBeUndefined();
  });

  it("refuses a malformed rate", async () => {
    await expect(
      setStudyRate(em, studyId, { currency: "GBP", rateDate: "2026-02-01", rate: "0" }),
    ).rejects.toBeInstanceOf(ExchangeRateValidationError);
  });

  it("refuses a Researcher (read-only until later conversion slices)", async () => {
    await expect(
      setStudyRate(researcher, studyId, { currency: "GBP", rateDate: "2026-02-01", rate: "1.2" }),
    ).rejects.toBeInstanceOf(ExchangeRateAccessError);
    await expect(listStudyRates(researcher, studyId)).rejects.toBeInstanceOf(ExchangeRateAccessError);
  });

  it("refuses the Admin and a Client User", async () => {
    await expect(
      setStudyRate(admin, studyId, { currency: "GBP", rateDate: "2026-02-01", rate: "1.2" }),
    ).rejects.toBeInstanceOf(ExchangeRateAccessError);
    await expect(
      setStudyRate(clientUser, studyId, { currency: "GBP", rateDate: "2026-02-01", rate: "1.2" }),
    ).rejects.toBeInstanceOf(ExchangeRateAccessError);
  });

  it("stamps a new row with its study's owning tenant (RLS backstop, ADR-0021)", async () => {
    // Internal staff cross tenants by design (no tenant of their own); isolation
    // is the denormalized clientId copied from the study, verified by RLS.
    const result = await setStudyRate(em, otherStudyId, {
      currency: "JPY",
      rateDate: "2026-02-01",
      rate: "150",
    });
    const row = await prisma.studyExchangeRate.findUnique({ where: { id: result.rate.id } });
    expect(row?.clientId).toBe(otherTenantId);
  });
});

describe("listStudyRates — ordering", () => {
  it("orders by currency A→Z then most-recent rateDate first", async () => {
    await setStudyRate(em, studyId, { currency: "AUD", rateDate: "2026-01-10", rate: "1.4" });
    await setStudyRate(em, studyId, { currency: "AUD", rateDate: "2026-03-10", rate: "1.5" });
    const rows = await listStudyRates(em, studyId);
    const codes = rows.map((r) => `${r.currency}:${r.rateDate}`);
    expect(codes.slice(0, 3)).toEqual(["AUD:2026-03-10", "AUD:2026-01-10", "EUR:2026-01-15"]);
  });
});
