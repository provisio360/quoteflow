import type { Prisma } from "@prisma/client";
import type { VisibilitySpec } from "@/domains/authz/visibility";

// The one place the abstract VisibilitySpec meets the actual persistence column
// (`clientId`). Type-only Prisma import → this file pulls in no DB client and is
// unit-testable in the pure suite.

/**
 * Translate a VisibilitySpec into a Prisma `where`.
 *
 * Fails closed: the ONLY spec that yields an unfiltered query (`{}`) is the
 * explicit `all` from a verified internal Principal. A future scope variant
 * added without a handler is a COMPILE error (the `never` check); at runtime it
 * still collapses to a zero-row query (`id IN ()`), never an open one (ADR-0008).
 */
export function visibilityWhere(spec: VisibilitySpec): Prisma.StudyWhereInput {
  switch (spec.scope) {
    case "all":
      return {};
    case "tenant":
      return { clientId: spec.tenantId };
    case "assigned": {
      // Study-list granularity: a Study is visible if ANY assigned pair lives in
      // it (∃ studyId) — the projection of item membership onto studyId (ADR-0025).
      // Empty pair-set → `id IN ()`, the same fail-closed zero-row query as below.
      const studyIds = [...new Set(spec.pairs.map((p) => p.studyId))];
      return { id: { in: studyIds } };
    }
    default: {
      const _exhaustive: never = spec;
      void _exhaustive;
      return { id: { in: [] } };
    }
  }
}
