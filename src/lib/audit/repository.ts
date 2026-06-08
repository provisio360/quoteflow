import type { Prisma } from "@prisma/client";
import type { AuditEvent } from "@/domains/audit/events";

// Persistence for the audit log (issue #16 / ADR-0019). The single write seam.
//
// `recordAuditEvents` takes a TRANSACTION CLIENT (`tx`), never the bare `prisma`
// singleton — so an audit row can only ever be written INSIDE a caller's
// transaction, alongside the transition it records. If the surrounding
// transaction rolls back, the audit write rolls back with it; if the audit write
// fails, it fails the transition. That "atomic with the transition" guarantee is
// structural, not a convention (ADR-0019).

/**
 * Append the given Audit Events within the caller's open transaction. A no-op
 * for an empty list — a transition that changed nothing (an idempotent re-assign,
 * a no-op re-import, a raced state guard that matched 0 rows) records nothing.
 */
export async function recordAuditEvents(
  tx: Prisma.TransactionClient,
  events: readonly AuditEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await tx.auditEvent.createMany({
    data: events.map((e) => ({
      action: e.action,
      actorId: e.actorId,
      studyId: e.studyId,
      subjectType: e.subjectType,
      subjectId: e.subjectId,
      beforeValue: e.beforeValue,
      afterValue: e.afterValue,
    })),
  });
}
