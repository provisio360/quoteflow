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

/** Every study the principal may see — own tenant for clients, all for staff. */
export function listStudies(principal: Principal): Promise<Study[]> {
  return prisma.study.findMany({
    where: visibilityWhere(tenantVisibility(principal)),
    orderBy: { createdAt: "desc" },
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
  return prisma.study.findFirst({
    where: { AND: [visibilityWhere(tenantVisibility(principal)), { id }] },
  });
}

export interface CreateStudyInput {
  name: string;
  /** The Client (tenant) the study is for — an explicit choice (grilling Q5). */
  clientId: string;
}

/**
 * Create a study for a chosen Client. Role-gated (EM or Analyst), NOT
 * tenant-filtered — internal staff have no tenant, so the target Client is an
 * explicit input. The creator is recorded as `createdById` for provenance.
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
    },
  });
}
