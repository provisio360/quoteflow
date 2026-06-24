import { prisma } from "@/lib/prisma";
import type { Principal } from "@/domains/authz/principal";
import type { NotificationKind, NotificationSubjectType } from "@/domains/notifications/events";

// The in-app read surface for notifications (#17 / ADR-0020, ADR-0031). Pull-based,
// like everything else client-facing in v1 — loaded on navigation, no realtime.
// Every read is scoped to the caller (recipientId = principal.userId): a
// notification is private to its recipient, so there is no cross-user view.
//
// A `quoteRejected` notification's context (study, country, market quote / line
// numbers) is DERIVED LIVE from the subject Quote Line, never snapshotted — only
// the reason is frozen on the row (ADR-0031). The same join drives DISMISSAL: a
// rejection is shown only while its line is still Rejected AND the row is the
// line's latest rejection, so it disappears the moment the author revises and a
// re-rejection shows only its own fresh row. `countryReleased` rows never dismiss.

/** One notification as the inbox renders it — read state plus the live-derived
 *  context. `studyName` is the Pricing Study (the "project"); `marketQuoteNumber`
 *  and `quoteLineNumber` locate a rejected line and are null for a release. */
export interface NotificationView {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly studyId: string;
  readonly studyName: string;
  readonly subjectType: NotificationSubjectType;
  readonly subjectId: string;
  readonly reason: string | null;
  readonly country: string | null;
  readonly marketQuoteNumber: number | null;
  readonly quoteLineNumber: number | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

/** The caller's currently-visible notifications, newest first — the single
 *  enrich-and-dismiss pass both the list and the unread badge read from. */
async function loadVisible(principal: Principal): Promise<NotificationView[]> {
  const rows = await prisma.notification.findMany({
    where: { recipientId: principal.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      kind: true,
      studyId: true,
      subjectType: true,
      subjectId: true,
      reason: true,
      country: true,
      readAt: true,
      createdAt: true,
    },
  });

  // Study names for every row (the "project" label), one lookup.
  const studyIds = [...new Set(rows.map((r) => r.studyId))];
  const studies = await prisma.study.findMany({
    where: { id: { in: studyIds } },
    select: { id: true, name: true },
  });
  const studyName = new Map(studies.map((s) => [s.id, s.name]));

  // Subject lines for the rejection rows — drives both the live context and the
  // dismissal predicate. Legacy "Quote" subjects (ADR-0026) have no Quote Line and
  // are left as-is, never dismissed.
  const lineIds = [
    ...new Set(rows.filter((r) => r.subjectType === "QuoteLine").map((r) => r.subjectId)),
  ];
  const lines = await prisma.quoteLine.findMany({
    where: { id: { in: lineIds } },
    select: {
      id: true,
      state: true,
      country: true,
      quoteLineNumber: true,
      marketQuote: { select: { marketQuoteNumber: true } },
    },
  });
  const lineById = new Map(lines.map((l) => [l.id, l]));

  // rows are newest-first, so the first rejection we see for a given line is its
  // latest; any older one for the same line is a superseded rejection and dropped.
  const seenRejectedLine = new Set<string>();
  const views: NotificationView[] = [];
  for (const r of rows) {
    const base = {
      id: r.id,
      kind: r.kind,
      studyId: r.studyId,
      studyName: studyName.get(r.studyId) ?? "",
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      reason: r.reason,
      readAt: r.readAt,
      createdAt: r.createdAt,
    };

    if (r.kind === "quoteRejected" && r.subjectType === "QuoteLine") {
      const line = lineById.get(r.subjectId);
      // Dismissed: the line was revised (no longer Rejected), or this is a
      // superseded rejection (a newer one for the same line already shown).
      if (line === undefined || line.state !== "Rejected") continue;
      if (seenRejectedLine.has(r.subjectId)) continue;
      seenRejectedLine.add(r.subjectId);
      views.push({
        ...base,
        country: line.country,
        marketQuoteNumber: line.marketQuote.marketQuoteNumber,
        quoteLineNumber: line.quoteLineNumber,
      });
      continue;
    }

    views.push({
      ...base,
      country: r.country,
      marketQuoteNumber: null,
      quoteLineNumber: null,
    });
  }
  return views;
}

/** The caller's own notifications, newest first (dismissed rejections excluded). */
export async function listNotifications(principal: Principal): Promise<NotificationView[]> {
  return loadVisible(principal);
}

/** How many of the caller's visible notifications are still unread (the nav
 *  badge). Honours the same dismissal as the list, so a rejection resolved before
 *  it was read leaves no phantom unread (ADR-0031). */
export async function unreadCount(principal: Principal): Promise<number> {
  const visible = await loadVisible(principal);
  return visible.filter((n) => n.readAt === null).length;
}

/** Mark all of the caller's unread notifications read (on inbox open). Stamps
 *  only the caller's own rows; another user's notifications are never touched. */
export async function markAllRead(principal: Principal): Promise<void> {
  await prisma.notification.updateMany({
    where: { recipientId: principal.userId, readAt: null },
    data: { readAt: new Date() },
  });
}
