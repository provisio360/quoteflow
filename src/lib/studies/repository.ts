import type { Study } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Principal } from "@/domains/authz/principal";
import { canCreateStudy } from "@/domains/authz/studies";
import { tenantVisibility } from "@/domains/authz/visibility";
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
}

/** Every study the principal may see — own tenant for clients, all for staff. */
export async function listStudies(principal: Principal): Promise<StudySummary[]> {
  const rows = await prisma.study.findMany({
    where: visibilityWhere(tenantVisibility(principal)),
    orderBy: { createdAt: "desc" },
    include: { client: { select: { name: true } } },
  });
  return rows.map(toSummary);
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
  return prisma.study.findFirst({
    where: { AND: [visibilityWhere(tenantVisibility(principal)), { id }] },
  });
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
  const row = await prisma.study.findFirst({
    where: { AND: [visibilityWhere(tenantVisibility(principal)), { id }] },
    include: { client: { select: { name: true } } },
  });
  return row === null ? null : toSummary(row);
}

export interface CreateStudyInput {
  name: string;
  /** The Client (tenant) the study is for — an explicit choice (grilling Q5). */
  clientId: string;
  /** The study's QC Threshold percentage (ADR-0014) — set at study setup; a
   *  study without one is mis-configured. e.g. 25 = 25%. */
  qcThresholdPct: number;
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
  return prisma.study.create({
    data: {
      name: input.name,
      clientId: input.clientId,
      createdById: principal.userId,
      qcThresholdPct: input.qcThresholdPct,
    },
  });
}

/** Flatten a study + its included client into the shell read-model. */
function toSummary(row: Study & { client: { name: string } }): StudySummary {
  return {
    id: row.id,
    name: row.name,
    clientId: row.clientId,
    clientName: row.client.name,
    createdAt: row.createdAt,
  };
}
