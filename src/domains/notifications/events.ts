// Pure core of notifications (issue #17 / ADR-0020). The typed shape of a
// Notification and the per-event builders that construct one — no Prisma here.
// Each builder returns a validated plain object the persistence layer
// (src/lib/notifications) writes inside the transition's own transaction and
// enqueues an email job for. This is where "which event snapshots what" is
// encoded once, mirroring src/domains/audit/events.ts.

/** The two v1 events that push (CONTEXT.md: Notification). */
export type NotificationKind = "quoteRejected" | "countryReleased";

/** What a Notification links back to (CONTEXT.md: Notification subject). `Quote`
 *  is a LEGACY value retained for pre-split rejection notifications (ADR-0026);
 *  new rejections target the Quote Line that returned to its author. */
export type NotificationSubjectType = "Quote" | "QuoteLine" | "CountryRelease";

/** One push signal ready to persist. `reason` snapshots a rejection's reason
 *  (ephemeral — cleared on resubmit); `country` snapshots a release's country;
 *  each is null for the other kind. */
export interface NotificationInput {
  readonly recipientId: string;
  readonly kind: NotificationKind;
  readonly studyId: string;
  readonly subjectType: NotificationSubjectType;
  readonly subjectId: string;
  readonly reason: string | null;
  readonly country: string | null;
}

/** A Quote Line was rejected — notify its author (the document's createdById, not
 *  necessarily the Primary Researcher; CONTEXT.md: Approved / Rejected). Snapshots
 *  the rejection reason, which the source line clears on resubmit. */
export function notifyQuoteRejected(input: {
  recipientId: string;
  studyId: string;
  lineId: string;
  reason: string;
}): NotificationInput {
  return {
    recipientId: input.recipientId,
    kind: "quoteRejected",
    studyId: input.studyId,
    subjectType: "QuoteLine",
    subjectId: input.lineId,
    reason: input.reason,
    country: null,
  };
}

/** A Country was released — notify one of the tenant's Client Users. Carries no
 *  Client Price or quote figures, ever (ADR-0003); snapshots the country name. */
export function notifyCountryReleased(input: {
  recipientId: string;
  studyId: string;
  countryReleaseId: string;
  country: string;
}): NotificationInput {
  return {
    recipientId: input.recipientId,
    kind: "countryReleased",
    studyId: input.studyId,
    subjectType: "CountryRelease",
    subjectId: input.countryReleaseId,
    reason: null,
    country: input.country,
  };
}
