import { prisma } from "@/lib/prisma";
import type { Principal } from "@/domains/authz/principal";
import type { NotificationKind, NotificationSubjectType } from "@/domains/notifications/events";

// The in-app read surface for notifications (#17 / ADR-0020). Pull-based, like
// everything else client-facing in v1 — loaded on navigation, no realtime. Every
// read is scoped to the caller (recipientId = principal.userId): a notification
// is private to its recipient, so there is no cross-user or cross-tenant view.

/** One notification as the inbox renders it — the snapshot fields plus read
 *  state. `subjectType`/`subjectId` let the UI deep-link back to the source. */
export interface NotificationView {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly studyId: string;
  readonly subjectType: NotificationSubjectType;
  readonly subjectId: string;
  readonly reason: string | null;
  readonly country: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

/** The caller's own notifications, newest first. */
export async function listNotifications(principal: Principal): Promise<NotificationView[]> {
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
  return rows;
}

/** How many of the caller's notifications are still unread (the nav badge). */
export async function unreadCount(principal: Principal): Promise<number> {
  return prisma.notification.count({
    where: { recipientId: principal.userId, readAt: null },
  });
}

/** Mark all of the caller's unread notifications read (on inbox open). Stamps
 *  only the caller's own rows; another user's notifications are never touched. */
export async function markAllRead(principal: Principal): Promise<void> {
  await prisma.notification.updateMany({
    where: { recipientId: principal.userId, readAt: null },
    data: { readAt: new Date() },
  });
}
