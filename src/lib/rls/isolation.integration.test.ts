import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Principal } from "@/domains/authz/principal";
import { createStudy, getStudy, listStudies } from "@/lib/studies/repository";
import { assignResearchers } from "@/lib/assignments/repository";

// RLS backstop proof (issue #21 / ADR-0021). These tests are meaningful ONLY
// when run as the non-owner `quoteflow_app` role (the owner bypasses RLS). They
// follow the two-client pattern from ADR-0021's grilling: the OWNER client seeds
// cross-tenant fixtures (it bypasses RLS, so it can write any tenant's rows), and
// the APP-ROLE client is the one under test — it proves a raw query that skips the
// repository's visibility `where` still cannot cross tenants.

// This proof is meaningful ONLY as the non-owner quoteflow_app role. When
// APP_DATABASE_URL is not provided (e.g. a plain `npm run test:integration`
// against an owner connection, where RLS is bypassed and the proof would be
// vacuous) the suite SKIPS rather than fails — run it with APP_DATABASE_URL set
// to actually exercise the net (see the issue #21 runbook / CI).
const ownerUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;
const enabled = Boolean(ownerUrl && appUrl);

const owner = new PrismaClient({ datasourceUrl: ownerUrl });
const app = new PrismaClient({ datasourceUrl: appUrl ?? ownerUrl });

let tenantA: string;
let tenantB: string;
let analystId: string;
let emId: string;
let researcherId: string;
const studyIds: Record<string, string> = {};

beforeAll(async () => {
  if (!enabled) return;
  const a = await owner.client.create({ data: { name: "Tenant A (rls)" } });
  const b = await owner.client.create({ data: { name: "Tenant B (rls)" } });
  tenantA = a.id;
  tenantB = b.id;
  const stamp = Date.now();
  const mkStaff = (suffix: string, role: "Analyst" | "EngagementManager" | "Researcher") =>
    owner.user.create({
      data: {
        id: `rls-${suffix}-${stamp}`,
        name: `RLS ${role}`,
        email: `rls-${suffix}-${stamp}@example.com`,
        kind: "internal",
        role,
      },
    });
  const u = await mkStaff("analyst", "Analyst");
  analystId = u.id;
  emId = (await mkStaff("em", "EngagementManager")).id;
  researcherId = (await mkStaff("res", "Researcher")).id;
  for (const [name, tenant] of [["Study A", tenantA], ["Study B", tenantB]] as const) {
    const study = await owner.study.create({
      data: { name, clientId: tenant, createdById: u.id, qcThreshold: 0.25 },
    });
    studyIds[tenant] = study.id;
    const item = await owner.benchmarkItem.create({
      data: {
        studyId: study.id,
        clientId: tenant,
        country: "US",
        clientItemNumber: "P-1",
        clientItemNumberKey: "p-1",
        itemDescription: "widget",
        clientSourceUnit: "M1",
        requiredQuotes: 1,
      },
    });
    const doc = await owner.marketQuote.create({
      data: { studyId: study.id, clientId: tenant, country: "US", marketQuoteNumber: 1, createdById: u.id },
    });
    await owner.quoteLine.create({
      data: {
        marketQuoteId: doc.id, benchmarkItemId: item.id, clientId: tenant,
        studyId: study.id, country: "US", quoteLineNumber: 1, createdById: u.id,
      },
    });
  }
});

afterAll(async () => {
  if (!enabled) {
    await app.$disconnect();
    return;
  }
  // Audit events reference the actor (onDelete: Restrict) and aren't cascaded by
  // the study delete (their studyId is a plain string), so clear them first.
  await owner.auditEvent.deleteMany({ where: { actorId: { startsWith: "rls-" } } });
  await owner.notification.deleteMany({ where: { recipientId: { startsWith: "rls-" } } });
  await owner.study.deleteMany({ where: { clientId: { in: [tenantA, tenantB] } } });
  await owner.client.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await owner.user.deleteMany({ where: { email: { startsWith: "rls-" } } });
  await owner.$disconnect();
  await app.$disconnect();
});

/** Run a RAW query as the app role inside a transaction with the given GUCs set
 *  (the same SET LOCAL protocol withTenant() uses). The raw query deliberately
 *  ignores any app-layer `where` filter, to prove RLS catches the bypass. */
async function asAppRole<T>(
  guc: { tenantId?: string; internal?: boolean },
  run: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return app.$transaction(async (tx) => {
    if (guc.tenantId !== undefined) {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${guc.tenantId}, true)`;
    }
    if (guc.internal) {
      await tx.$executeRaw`SELECT set_config('app.is_internal', 'on', true)`;
    }
    return run(tx as unknown as PrismaClient);
  });
}

const allStudies = 'SELECT id, "clientId" FROM study';

describe.skipIf(!enabled)("RLS tenant isolation backstop", () => {
  it("a raw query as the app role sees only its own tenant's studies", async () => {
    const rows = await asAppRole({ tenantId: tenantA }, (tx) =>
      tx.$queryRawUnsafe<{ id: string; clientId: string }[]>(allStudies),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.clientId === tenantA)).toBe(true);
  });

  it("fails closed: with no tenant context set, a raw query returns zero rows", async () => {
    const rows = await asAppRole({}, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(allStudies),
    );
    expect(rows).toHaveLength(0);
  });

  it("internal staff (app.is_internal) see every tenant's studies", async () => {
    const rows = await asAppRole({ internal: true }, (tx) =>
      tx.$queryRawUnsafe<{ id: string; clientId: string }[]>(allStudies),
    );
    const tenants = new Set(rows.map((r) => r.clientId));
    expect(tenants.has(tenantA)).toBe(true);
    expect(tenants.has(tenantB)).toBe(true);
  });

  it("a child table (quote_line) isolates by its own denormalized clientId", async () => {
    const rows = await asAppRole({ tenantId: tenantA }, (tx) =>
      tx.$queryRawUnsafe<{ id: string; clientId: string }[]>('SELECT id, "clientId" FROM quote_line'),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.clientId === tenantA)).toBe(true);
  });

  it("the studies repository, through withTenant, scopes a client principal to its tenant", async () => {
    const clientA: Principal = { kind: "client", userId: "rls-test", tenantId: tenantA };
    const list = await listStudies(clientA);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((s) => s.clientId === tenantA)).toBe(true);
    // An out-of-tenant study id collapses to null (RLS + app-layer filter agree).
    expect(await getStudy(clientA, studyIds[tenantB])).toBeNull();
    // The principal's own study is reachable.
    expect(await getStudy(clientA, studyIds[tenantA])).not.toBeNull();
  });

  it("createStudy writes as app-role internal staff (WITH CHECK satisfied by is_internal)", async () => {
    const analyst: Principal = { kind: "internal", userId: analystId, role: "Analyst" };
    const created = await createStudy(analyst, {
      name: "RLS-created study",
      clientId: tenantA,
      qcThreshold: 0.25,
    });
    expect(created.clientId).toBe(tenantA);
    expect(await getStudy(analyst, created.id)).not.toBeNull();
  });

  it("re-entrant withTenant: assignResearchers (which calls getStudy) runs as the app role", async () => {
    const em: Principal = { kind: "internal", userId: emId, role: "EngagementManager" };
    // studyIds[tenantA] has a Benchmark Item in "US" (seeded above); the EM assigns
    // an active Researcher to it. assignResearchers opens withTenant and internally
    // calls getStudy — proving the re-entrant transaction reuse works under RLS.
    const result = await assignResearchers(em, studyIds[tenantA], "US", [researcherId]);
    expect(result.assigned).toBe(1);
  });

  it("WITH CHECK blocks a client-context write into a foreign tenant", async () => {
    await expect(
      asAppRole({ tenantId: tenantA }, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO study (id, name, "clientId", "createdById", "qcThreshold", "createdAt", "updatedAt")
           SELECT 'rls-evil', 'evil', $1, "createdById", 0.25, now(), now() FROM study LIMIT 1`,
          tenantB,
        ),
      ),
    ).rejects.toThrow();
  });
});
