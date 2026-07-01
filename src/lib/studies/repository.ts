import type { Study } from "@prisma/client";
import type { Principal } from "@/domains/authz/principal";
import { canCreateStudy } from "@/domains/authz/studies";
import { tenantVisibility } from "@/domains/authz/visibility";
import { withTenant } from "@/lib/tenant-context";
import { resolveCountryVisibility } from "@/lib/authz/country-scope";
import { visibilityWhere } from "./where";

// Tenant-aware data-access adapter for Pricing Studies — the ONLY sanctioned way
// to read or create a study (ADR-0008). Every entry point requires a Principal,
// so a principal-less read is impossible to express: the visibility filter can
// never be "forgotten" because there is no code path that skips it. There is
// deliberately no exported raw-query escape hatch for this table.

/** Raised when a principal attempts a write it is not authorised for. */
export class StudyAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyAccessError";
  }
}

/**
 * A study as the app shell lists/displays it (issue #24): the study plus its
 * Client's name, flattened so a screen needs no further joins. `clientId` is
 * retained so tenant scoping stays assertable. This is a read-model — distinct
 * from `getStudy`, which is the lean existence-gate the write paths use.
 */
export interface StudySummary {
  readonly id: string;
  readonly name: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly createdAt: Date;
  /** The study default QC Threshold (fraction). Safe for researchers — it is a
   *  tolerance knob, not the hidden Client Price (ADR-0003); it also anchors the
   *  live peer-spread nudge at entry (#163, ADR-0042). */
  readonly qcThreshold: number;
}

/**
 * Every study the principal may see — own tenant for clients, all for staff, and
 * for a Researcher only the studies they hold >=1 Country Assignment in (the
 * country axis AND-ed on top of the tenant axis; ADR-0025). The country layer is
 * a no-op `all` for every non-Researcher, so EM / Analyst / Admin / Client Users
 * are unchanged.
 */
export async function listStudies(principal: Principal): Promise<StudySummary[]> {
  return withTenant(principal, async (tx) => {
    const country = await resolveCountryVisibility(principal, tx);
    const rows = await tx.study.findMany({
      where: {
        AND: [visibilityWhere(tenantVisibility(principal)), visibilityWhere(country)],
      },
      orderBy: { createdAt: "desc" },
      include: { client: { select: { name: true } } },
    });
    return rows.map(toSummary);
  });
}

/**
 * A study plus how many of its Countries are CURRENTLY Released — the Client
 * User home read-model (issue #60). `releasedCountryCount` counts only
 * CountryRelease rows in state `released`; a `reopened` Country is pulled back
 * from client view and a Country with no row was never released, so both are
 * excluded (CONTEXT.md: Released; mirrors `listReleasedQuotesForStudy`).
 */
export interface StudyWithReleasedCount extends StudySummary {
  readonly releasedCountryCount: number;
}

/**
 * The Client User home's launchpad (issue #60): every study the principal may
 * see, each carrying its currently-Released Country count. Tenant scoping is the
 * SAME `visibilityWhere` the rest of this repository uses (ADR-0008) — the
 * released counts are then grouped only over those visible studies' ids, so a
 * row for an out-of-tenant study can never contribute even if the RLS backstop
 * lapsed. One `groupBy` (not an N+1 per study); the empty study list
 * short-circuits before it runs.
 */
export async function listStudiesWithReleasedCounts(
  principal: Principal,
): Promise<StudyWithReleasedCount[]> {
  return withTenant(principal, async (tx) => {
    const rows = await tx.study.findMany({
      where: visibilityWhere(tenantVisibility(principal)),
      orderBy: { createdAt: "desc" },
      include: { client: { select: { name: true } } },
    });
    if (rows.length === 0) return [];

    const grouped = await tx.countryRelease.groupBy({
      by: ["studyId"],
      where: { state: "released", studyId: { in: rows.map((r) => r.id) } },
      _count: { country: true },
    });
    const countByStudy = new Map(grouped.map((g) => [g.studyId, g._count.country]));

    return rows.map((row) => ({
      ...toSummary(row),
      releasedCountryCount: countByStudy.get(row.id) ?? 0,
    }));
  });
}

/**
 * A single study by id, scoped to the principal. Filter-first: the visibility
 * `where` is AND-ed with the id, so an out-of-tenant id returns `null` —
 * indistinguishable from a never-existed id (grilling Q6: out-of-tenant
 * collapses into not-found, never a 403 that would leak existence).
 */
export function getStudy(
  principal: Principal,
  id: string,
): Promise<Study | null> {
  return withTenant(principal, (tx) =>
    tx.study.findFirst({
      where: { AND: [visibilityWhere(tenantVisibility(principal)), { id }] },
    }),
  );
}

/**
 * The shell's study-detail read-model (issue #24): the same principal-scoped,
 * filter-first lookup as `getStudy` (out-of-tenant collapses to `null`,
 * ADR-0008), but projected with the Client's name for display. Separate from
 * `getStudy` so the write-path existence-gate stays a lean, join-free query.
 */
export async function getStudyDetail(
  principal: Principal,
  id: string,
): Promise<StudySummary | null> {
  return withTenant(principal, async (tx) => {
    // AND the country axis (ADR-0025): a Researcher opening a study they hold no
    // Country Assignment in resolves to null (-> notFound), so they cannot read
    // its name + client name. A no-op `all` for every other role.
    const country = await resolveCountryVisibility(principal, tx);
    const row = await tx.study.findFirst({
      where: {
        AND: [visibilityWhere(tenantVisibility(principal)), visibilityWhere(country), { id }],
      },
      include: { client: { select: { name: true } } },
    });
    return row === null ? null : toSummary(row);
  });
}

export interface CreateStudyInput {
  name: string;
  /** The Client (tenant) the study is for — an explicit choice (grilling Q5). */
  clientId: string;
  /** The study's default QC Threshold as a FRACTION (ADR-0014, #86) — set at study
   *  setup; a study without one is mis-configured. e.g. 0.25 = 25%. */
  qcThreshold: number;
}

/**
 * Create a study for a chosen Client. Role-gated (EM or Analyst), NOT
 * tenant-filtered — internal staff have no tenant, so the target Client is an
 * explicit input. The creator is recorded as `createdById` for provenance. The
 * QC Threshold is captured here because flagging needs it from day one (ADR-0014).
 */
export async function createStudy(
  principal: Principal,
  input: CreateStudyInput,
): Promise<Study> {
  if (!canCreateStudy(principal)) {
    throw new StudyAccessError("Only Engagement Managers and Analysts may create a study");
  }
  return withTenant(principal, (tx) =>
    tx.study.create({
      data: {
        name: input.name,
        clientId: input.clientId,
        createdById: principal.userId,
        qcThreshold: input.qcThreshold,
      },
    }),
  );
}

/** Flatten a study + its included client into the shell read-model. */
function toSummary(row: Study & { client: { name: string } }): StudySummary {
  return {
    id: row.id,
    name: row.name,
    clientId: row.clientId,
    clientName: row.client.name,
    createdAt: row.createdAt,
    qcThreshold: Number(row.qcThreshold),
  };
}
