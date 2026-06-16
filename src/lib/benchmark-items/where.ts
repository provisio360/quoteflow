import type { Prisma } from "@prisma/client";
import type { VisibilitySpec } from "@/domains/authz/visibility";

// The one place the abstract VisibilitySpec meets the Benchmark Item table's
// persistence columns (`studyId` + `country`, and the denormalized `clientId`).
// Type-only Prisma import → no DB client, unit-testable in the pure suite.
//
// Distinct from `studies/where.ts`: a study is visible by the ∃-studyId
// PROJECTION of the pair-set, but an item is visible by EXACT (studyId, country)
// MEMBERSHIP. The two granularities derive from one resolved pair-set so they
// cannot drift (ADR-0025).

/**
 * Translate a VisibilitySpec into a Benchmark Item Prisma `where`.
 *
 * Fails closed: the ONLY spec that yields an unfiltered query (`{}`) is the
 * explicit `all` from a verified internal Principal. An `assigned` scope with no
 * pairs, or a future variant added without a handler (the `never` check is a
 * COMPILE error), collapses to a zero-row query (`id IN ()`), never an open one.
 */
export function itemVisibilityWhere(spec: VisibilitySpec): Prisma.BenchmarkItemWhereInput {
  switch (spec.scope) {
    case "all":
      return {};
    case "tenant":
      // The denormalized RLS tenant column (ADR-0021). Not used by the country
      // axis (which only ever passes `all`/`assigned`), but handled so the tenant
      // wall is expressible on items too and the switch stays exhaustive.
      return { clientId: spec.tenantId };
    case "assigned":
      // Exact (studyId, country) membership of the assigned pair-set. Empty set →
      // zero rows (fails closed): a Researcher with no assignments sees nothing.
      return spec.pairs.length === 0
        ? { id: { in: [] } }
        : { OR: spec.pairs.map((p) => ({ studyId: p.studyId, country: p.country })) };
    default: {
      const _exhaustive: never = spec;
      void _exhaustive;
      return { id: { in: [] } };
    }
  }
}
