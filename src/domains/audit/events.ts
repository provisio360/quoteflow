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
  | "assign"
  | "studyRateSet";

/** The audit-log view's display vocabulary (issue #72): each Audit Action as a
 *  past-tense human verb. Lives with the domain, not the JSX, so the wording
 *  stays beside the closed action set it mirrors. */
const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  submit: "Submitted",
  approve: "Approved",
  reject: "Rejected",
  release: "Released",
  reopen: "Reopened",
  import: "Imported",
  clientPriceChange: "Client Price changed",
  manualRateOverride: "Manual rate override",
  assign: "Assigned",
  studyRateSet: "Study rate set",
};

/** The human display label for an Audit Action, shown in the audit-log view. */
export function auditActionLabel(action: AuditAction): string {
  return AUDIT_ACTION_LABELS[action];
}

/** The kind of entity an event is about (CONTEXT.md: Audit Event subject).
 *  `Quote` is a LEGACY value retained for pre-split history (ADR-0026); new
 *  events target the Market Quote (manual-rate) or the Quote Line
 *  (submit/approve/reject) of the two-level aggregate. */
export type AuditSubjectType =
  | "Quote"
  | "MarketQuote"
  | "QuoteLine"
  | "BenchmarkItem"
  | "CountryRelease"
  | "CountryAssignment"
  | "StudyExchangeRate";

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

/** An analyst's per-line verdict — approve or reject (ADR-0026: verdicts are per
 *  line). Subject is the Quote LINE; no monetary delta (the price isn't changed by
 *  these moves). One builder for the two because they share shape. Submit is NOT
 *  here — it is a bulk document act, audited once per document by
 *  `auditDocumentSubmit`. */
export function auditQuoteLifecycle(
  action: "approve" | "reject",
  input: { actorId: string; studyId: string; lineId: string },
): AuditEvent {
  return {
    action,
    actorId: input.actorId,
    studyId: input.studyId,
    subjectType: "QuoteLine",
    subjectId: input.lineId,
    beforeValue: null,
    afterValue: null,
  };
}

/** A researcher's bulk submit of a Market Quote (ADR-0026: submit is the one bulk
 *  transition — all the document's Draft lines move together). One event PER
 *  DOCUMENT, subject the Market Quote; no monetary delta (USD pins later, via the
 *  worker or a manual override). */
export function auditDocumentSubmit(input: {
  actorId: string;
  studyId: string;
  marketQuoteId: string;
}): AuditEvent {
  return {
    action: "submit",
    actorId: input.actorId,
    studyId: input.studyId,
    subjectType: "MarketQuote",
    subjectId: input.marketQuoteId,
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

/** An analyst hand-set a Market Quote's Exchange Rate for a currency the provider
 *  doesn't cover (#70 / ADR-0023/0026). The rate now lives on the DOCUMENT (one
 *  rate for all its lines), so the subject is the Market Quote. Carries the
 *  before/after monetary pair: `before` is null (a pending document had no USD
 *  figure) and `after` is the newly-pinned document-total Converted USD Price —
 *  not the raw rate, whose precision exceeds this Decimal(14,4) channel; the rate
 *  lives on the Market Quote row itself. */
export function auditManualRateOverride(input: {
  actorId: string;
  studyId: string;
  marketQuoteId: string;
  after: number;
}): AuditEvent {
  return {
    action: "manualRateOverride",
    actorId: input.actorId,
    studyId: input.studyId,
    subjectType: "MarketQuote",
    subjectId: input.marketQuoteId,
    beforeValue: null,
    afterValue: input.after,
  };
}

/** An Engagement Manager or Analyst set or edited a Study Exchange Rate row
 *  (ADR-0041). Subject is the StudyExchangeRate row; the monetary pair is NULL —
 *  a rate is Decimal(18,8) and would be silently truncated by this Decimal(14,4)
 *  channel, so the rate value lives on the row, not here (ADR-0023's reasoning).
 *  One event per row actually created or value-changed (an identical re-save is
 *  a no-op the caller does not audit). */
export function auditStudyRateSet(input: {
  actorId: string;
  studyId: string;
  rateId: string;
}): AuditEvent {
  return {
    action: "studyRateSet",
    actorId: input.actorId,
    studyId: input.studyId,
    subjectType: "StudyExchangeRate",
    subjectId: input.rateId,
    beforeValue: null,
    afterValue: null,
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
