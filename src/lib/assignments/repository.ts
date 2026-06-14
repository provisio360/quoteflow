import type { CountryAssignment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant-context";
import type { Principal } from "@/domains/authz/principal";
import { isInternal } from "@/domains/authz/principal";
import { canAssignResearchers } from "@/domains/authz/assignments";
import { getStudy } from "@/lib/studies/repository";
import { recordAuditEvents } from "@/lib/audit/repository";
import { auditAssign } from "@/domains/audit/events";

// Tenant-aware data-access adapter for Country assignment (issue #6). The ONLY
// sanctioned write/read path. The write role-gates the principal (EM-only —
// running ≠ setup, see src/domains/authz/assignments), resolves the target study
// through the tenant-scoped studies repository (ADR-0008 — a principal can't
// write into a study it can't see), checks the country actually exists in the
// study (its Benchmark Items define its countries; ADR-0009), and validates
// every target is an active internal Researcher. It is all-or-nothing: one bad
// target rejects the whole batch and writes nothing. Assignment is additive —
// re-assigning is a no-op on the unique key; #6 never removes (that's #25).

/** Raised for permission/existence/eligibility failures (not user file content). */
export class AssignmentAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssignmentAccessError";
  }
}

/** A Researcher eligible to be assigned to a Country (the EM picker). */
export interface AssignableResearcher {
  readonly id: string;
  readonly name: string;
}

/**
 * The pool an EM may assign from: every ACTIVE INTERNAL Researcher — the same set
 * assignResearchers validates each target against. Internal-only (staffing data).
 * The `user` table is not tenant-scoped (identity substrate, no RLS), so this is a
 * direct read.
 */
export async function listActiveResearchers(
  principal: Principal,
): Promise<AssignableResearcher[]> {
  if (!isInternal(principal)) {
    throw new AssignmentAccessError("Internal staff only");
  }
  return prisma.user.findMany({
    where: { kind: "internal", role: "Researcher", status: "active" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export interface AssignmentResult {
  /** How many of the requested researchers are now assigned to the country. */
  readonly assigned: number;
}

/**
 * Assign one or more researchers to a Country within a study. Additive and
 * idempotent: researchers already on the country are left in place, and the
 * count returned reflects the full requested set now in place. Throws
 * `AssignmentAccessError` for permission, unknown-study, unknown-country, or
 * ineligible-target failures — none of which write anything.
 */
export async function assignResearchers(
  principal: Principal,
  studyId: string,
  country: string,
  researcherIds: readonly string[],
): Promise<AssignmentResult> {
  if (!canAssignResearchers(principal)) {
    throw new AssignmentAccessError(
      "Only Engagement Managers may assign researchers to a Country",
    );
  }

  const ids = [...new Set(researcherIds)];
  return withTenant(principal, async (tx) => {
    // Tenant-scoped existence — out-of-tenant / missing both resolve to null.
    // getStudy re-enters this same transaction/context (ADR-0021).
    const study = await getStudy(principal, studyId);
    if (study === null) {
      throw new AssignmentAccessError(`Study not found: ${studyId}`);
    }

    // The country must already exist in the study (its Benchmark Items define its
    // countries; ADR-0009). Match on the canonical name stored at import time.
    const countryItem = await tx.benchmarkItem.findFirst({
      where: { studyId, country },
      select: { id: true },
    });
    if (countryItem === null) {
      throw new AssignmentAccessError(
        `Country "${country}" has no Benchmark Items in study ${studyId}`,
      );
    }

    // Every target must be an active, internal Researcher — all-or-nothing.
    const eligible = await tx.user.findMany({
      where: { id: { in: ids }, kind: "internal", role: "Researcher", status: "active" },
      select: { id: true },
    });
    if (eligible.length !== ids.length) {
      throw new AssignmentAccessError(
        "Every assignee must be an active internal Researcher",
      );
    }

    // Which of the requested researchers are NOT already on the country: only
    // these are genuinely new assignments, and only they are audited (ADR-0019:
    // one event per real change — an idempotent re-assign records nothing).
    const already = await tx.countryAssignment.findMany({
      where: { studyId, country, researcherId: { in: ids } },
      select: { researcherId: true },
    });
    const alreadyAssigned = new Set(already.map((a) => a.researcherId));
    const newIds = ids.filter((id) => !alreadyAssigned.has(id));

    // Additive upsert on the unique key — re-assigning is a no-op (#6 never
    // removes); skipDuplicates also guards a concurrent assign of the same pair.
    await tx.countryAssignment.createMany({
      data: ids.map((researcherId) => ({
        studyId,
        // Denormalized RLS tenant column (ADR-0021), copied from the parent study.
        clientId: study.clientId,
        country,
        researcherId,
        assignedById: principal.userId,
      })),
      skipDuplicates: true,
    });

    if (newIds.length > 0) {
      // Resolve the just-created rows' ids to use as the audit subject.
      const created = await tx.countryAssignment.findMany({
        where: { studyId, country, researcherId: { in: newIds } },
        select: { id: true },
      });
      await recordAuditEvents(
        tx,
        created.map((a) =>
          auditAssign({ actorId: principal.userId, studyId, assignmentId: a.id }),
        ),
      );
    }

    return { assigned: ids.length };
  });
}

/**
 * The EM home's setup-backlog signal (#57): how many distinct (study, country)
 * pairs have Benchmark Items but no Country Assignment yet — the open work of
 * putting Researchers onto Countries (the EM's exclusive job). A pure derived
 * count, never a stored flag. Internal-only; the count is GLOBAL — internal
 * staff are not tenant-scoped, so `withTenant` runs under the "all" RLS scope
 * and the count spans every tenant (there is no per-EM study ownership in v1).
 * Derived in the app layer via the sanctioned repository (ADR-0008); the NOT
 * EXISTS still runs under the tenant GUC, so RLS stays in force.
 */
export async function countUnstaffedCountries(principal: Principal): Promise<number> {
  if (!isInternal(principal)) {
    throw new AssignmentAccessError("Internal staff only");
  }
  return withTenant(principal, async (tx) => {
    const rows = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM (
        SELECT DISTINCT b."studyId", b.country
        FROM benchmark_item b
        WHERE NOT EXISTS (
          SELECT 1 FROM country_assignment a
          WHERE a."studyId" = b."studyId" AND a.country = b.country
        )
      ) unstaffed
    `;
    return Number(rows[0].count);
  });
}

/**
 * Every Country assignment for the calling researcher, across all studies.
 * Pinned to the principal's own userId — there is no code path to read another
 * researcher's assignments here (use `listAssignmentsForStudy` for staffing).
 */
export function listAssignmentsForResearcher(
  principal: Principal,
): Promise<CountryAssignment[]> {
  return withTenant(principal, (tx) =>
    tx.countryAssignment.findMany({
      where: { researcherId: principal.userId },
      orderBy: { createdAt: "desc" },
    }),
  );
}

/**
 * Every Country assignment on a study. Internal-only — assignments are internal
 * staffing data, never client-facing — and routed through the tenant-scoped
 * `getStudy` so an unknown/out-of-tenant study yields not-found, not a leak.
 */
export async function listAssignmentsForStudy(
  principal: Principal,
  studyId: string,
): Promise<CountryAssignment[]> {
  if (!isInternal(principal)) {
    throw new AssignmentAccessError("Internal staff only");
  }
  return withTenant(principal, async (tx) => {
    const study = await getStudy(principal, studyId);
    if (study === null) {
      throw new AssignmentAccessError(`Study not found: ${studyId}`);
    }
    return tx.countryAssignment.findMany({
      where: { studyId },
      orderBy: [{ country: "asc" }, { createdAt: "asc" }],
    });
  });
}
