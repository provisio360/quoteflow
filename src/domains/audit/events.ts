// Pure core of the audit log (issue #16 / ADR-0019). The typed shape of an
// Audit Event and the per-action builders that construct one. No Prisma here:
// each builder returns a validated plain object the persistence layer
// (src/lib/audit) writes inside the transition's own transaction. This is where
// "which action carries before/after" is encoded once.

/** The closed set of audited transitions (CONTEXT.md: Audit Action). */
export type AuditAction =
  | "submit"
  | "approve"
  | "reject"
  | "release"
  | "reopen"
  | "import"
  | "clientPriceChange"
  | "manualRateOverride"
  | "assign";

/** The kind of entity an event is about (CONTEXT.md: Audit Event subject). */
export type AuditSubjectType =
  | "Quote"
  | "BenchmarkItem"
  | "CountryRelease"
  | "CountryAssignment";

/** One append-only Audit Event, ready to persist. `beforeValue`/`afterValue`
 *  carry a monetary delta only for the actions that change one (v1: Client Price
 *  change); null otherwise. */
export interface AuditEvent {
  readonly action: AuditAction;
  readonly actorId: string;
  readonly studyId: string;
  readonly subjectType: AuditSubjectType;
  readonly subjectId: string;
  readonly beforeValue: number | null;
  readonly afterValue: number | null;
}

/** A Quote Lifecycle move by its actor — submit (researcher), or approve/reject
 *  (analyst verdict). Subject is the Quote; no monetary delta (the price isn't
 *  changed by these moves). One builder for the three because they share shape. */
export function auditQuoteLifecycle(
  action: "submit" | "approve" | "reject",
  input: { actorId: string; studyId: string; quoteId: string },
): AuditEvent {
  return {
    action,
    actorId: input.actorId,
    studyId: input.studyId,
    subjectType: "Quote",
    subjectId: input.quoteId,
    beforeValue: null,
    afterValue: null,
  };
}

/** An Engagement Manager assigned a Researcher to a Country (CONTEXT.md: Country
 *  Assignment). One event per assignment actually created — an idempotent
 *  re-assign of someone already on the country emits none. No monetary delta. */
export function auditAssign(input: {
  actorId: string;
  studyId: string;
  assignmentId: string;
}): AuditEvent {
  return {
    action: "assign",
    actorId: input.actorId,
    studyId: input.studyId,
    subjectType: "CountryAssignment",
    subjectId: input.assignmentId,
    beforeValue: null,
    afterValue: null,
  };
}

/** A Benchmark Item was inserted or updated by a bulk import (ADR-0009). One
 *  event per item actually written — a no-op re-import emits none. Import never
 *  overwrites Client Price (ADR-0015), so it carries no before/after. */
export function auditImport(input: {
  actorId: string;
  studyId: string;
  itemId: string;
}): AuditEvent {
  return {
    action: "import",
    actorId: input.actorId,
    studyId: input.studyId,
    subjectType: "BenchmarkItem",
    subjectId: input.itemId,
    beforeValue: null,
    afterValue: null,
  };
}

/** A Country Release move by its actor — release or reopen (ADR-0016). Subject
 *  is the CountryRelease row; no monetary delta. */
export function auditRelease(
  action: "release" | "reopen",
  input: { actorId: string; studyId: string; countryReleaseId: string },
): AuditEvent {
  return {
    action,
    actorId: input.actorId,
    studyId: input.studyId,
    subjectType: "CountryRelease",
    subjectId: input.countryReleaseId,
    beforeValue: null,
    afterValue: null,
  };
}

/** An analyst hand-set a Quote's Exchange Rate for a currency the provider doesn't
 *  cover (#70 / ADR-0023). Subject is the Quote. Carries the before/after monetary
 *  pair: `before` is null (a pending quote had no USD figure) and `after` is the
 *  newly-pinned Converted USD Price (the total) — not the raw rate, whose precision
 *  exceeds this Decimal(14,4) channel; the rate lives on the Quote row itself. */
export function auditManualRateOverride(input: {
  actorId: string;
  studyId: string;
  quoteId: string;
  after: number;
}): AuditEvent {
  return {
    action: "manualRateOverride",
    actorId: input.actorId,
    studyId: input.studyId,
    subjectType: "Quote",
    subjectId: input.quoteId,
    beforeValue: null,
    afterValue: input.after,
  };
}

/** An analyst set or revised a Benchmark Item's Client Price (ADR-0015). The one
 *  v1 action that carries a before/after pair; either side may be null (a value
 *  seeded from unset, or cleared back to unpriced). */
export function auditClientPriceChange(input: {
  actorId: string;
  studyId: string;
  itemId: string;
  before: number | null;
  after: number | null;
}): AuditEvent {
  return {
    action: "clientPriceChange",
    actorId: input.actorId,
    studyId: input.studyId,
    subjectType: "BenchmarkItem",
    subjectId: input.itemId,
    beforeValue: input.before,
    afterValue: input.after,
  };
}
