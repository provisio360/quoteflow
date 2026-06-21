import type { Prisma } from "@prisma/client";
import type { AuditAction, AuditEvent, AuditSubjectType } from "@/domains/audit/events";
import { withTenant } from "@/lib/tenant-context";
import { canViewClientPrice } from "@/domains/authz/benchmark-items";
import type { Principal } from "@/domains/authz/principal";

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

// ─────────────────────────────────────────────────────────────────────────────
// Read path (issue #72 / ADR-0024): the internal, per-study audit-log VIEW.
// Gated to Client-Price viewers (Analyst + EM) because clientPriceChange events
// carry the value (ADR-0003); study-scoped (the only isolation an internal,
// non-tenant-bound viewer needs); newest-first; capped.

/** Most-recent audit events surfaced in v1; older events exist but aren't paged
 *  (ADR-0024 — real paging is deferred, matching the plain-UI ethos ADR-0022). */
const AUDIT_VIEW_CAP = 200;

/** Thrown when a principal who may not view Client Price reaches the read path —
 *  read-layer defence behind the page guard (mirrors listBenchmarkItemsForAnalyst). */
export class AuditAccessError extends Error {}

/** One audit event hydrated for display: the raw subjectId resolved to a human
 *  subject label, the actor to a name, the monetary pair surfaced as numbers. */
export interface AuditEventView {
  readonly id: string;
  readonly action: AuditAction;
  readonly actorName: string;
  readonly createdAt: Date;
  readonly subjectType: AuditSubjectType;
  readonly subjectLabel: string;
  readonly beforeValue: number | null;
  readonly afterValue: number | null;
}

/**
 * List a study's Audit Events, newest first, for the internal audit-log view.
 * Gated to Client-Price viewers (Analyst + EM, ADR-0024) — anyone else is
 * refused. Study-scoped through the tenant context; capped at the most recent
 * {@link AUDIT_VIEW_CAP}.
 */
export async function listAuditEventsForStudy(
  principal: Principal,
  studyId: string,
): Promise<AuditEventView[]> {
  if (!canViewClientPrice(principal)) {
    throw new AuditAccessError("Only Analysts and Engagement Managers may view the audit log");
  }
  return withTenant(principal, async (tx) => {
    const rows = await tx.auditEvent.findMany({
      where: { studyId },
      orderBy: { createdAt: "desc" },
      take: AUDIT_VIEW_CAP,
      include: { actor: { select: { name: true, email: true } } },
    });

    const labels = await resolveSubjectLabels(tx, rows);

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorName: r.actor.name ?? r.actor.email,
      createdAt: r.createdAt,
      subjectType: r.subjectType,
      // A subjectId has no FK (ADR-0019), so a row may have been hard-deleted
      // (e.g. an abandoned Draft Quote) — fall back to the raw id.
      subjectLabel: labels.get(r.subjectId) ?? r.subjectId,
      beforeValue: r.beforeValue === null ? null : Number(r.beforeValue),
      afterValue: r.afterValue === null ? null : Number(r.afterValue),
    }));
  });
}

/**
 * Resolve each event's subjectId to a human label with ONE query per subject
 * type (group ids by type → one findMany each → id→label map), never per row
 * (issue #72 Q2). Dangling ids simply don't appear in the map; the caller falls
 * back to the raw id.
 */
async function resolveSubjectLabels(
  tx: Prisma.TransactionClient,
  rows: readonly { subjectType: AuditSubjectType; subjectId: string }[],
): Promise<Map<string, string>> {
  const idsByType = new Map<AuditSubjectType, Set<string>>();
  for (const r of rows) {
    const set = idsByType.get(r.subjectType) ?? new Set<string>();
    set.add(r.subjectId);
    idsByType.set(r.subjectType, set);
  }
  const labels = new Map<string, string>();
  const idsOf = (t: AuditSubjectType) => [...(idsByType.get(t) ?? [])];

  const quoteIds = idsOf("Quote");
  if (quoteIds.length > 0) {
    for (const q of await tx.quote.findMany({
      where: { id: { in: quoteIds } },
      select: { id: true, quoteNumber: true },
    })) {
      labels.set(q.id, `Quote ${q.quoteNumber}`);
    }
  }

  const itemIds = idsOf("BenchmarkItem");
  if (itemIds.length > 0) {
    for (const i of await tx.benchmarkItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, clientItemNumber: true, country: true },
    })) {
      labels.set(i.id, `${i.clientItemNumber} · ${i.country}`);
    }
  }

  const releaseIds = idsOf("CountryRelease");
  if (releaseIds.length > 0) {
    for (const c of await tx.countryRelease.findMany({
      where: { id: { in: releaseIds } },
      select: { id: true, country: true },
    })) {
      labels.set(c.id, c.country);
    }
  }

  const assignmentIds = idsOf("CountryAssignment");
  if (assignmentIds.length > 0) {
    for (const a of await tx.countryAssignment.findMany({
      where: { id: { in: assignmentIds } },
      select: { id: true, country: true, researcher: { select: { name: true, email: true } } },
    })) {
      labels.set(a.id, `${a.researcher.name ?? a.researcher.email} · ${a.country}`);
    }
  }

  return labels;
}
