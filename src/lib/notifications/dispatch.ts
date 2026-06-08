import type { Prisma } from "@prisma/client";
import type { NotificationInput } from "@/domains/notifications/events";

// Persistence + outbox for notifications (issue #17 / ADR-0020). The single write
// seam, mirroring src/lib/audit's recordAuditEvents: it takes a TRANSACTION
// CLIENT (`tx`), never the bare prisma singleton — so a Notification row and its
// email job can only ever be written INSIDE the transition's own transaction.
// The in-app row and the email enqueue commit atomically with the reject/release
// they announce; a rolled-back transition leaves neither.
//
// Email itself is NOT sent here (you cannot roll back a sent email, and Resend is
// slow/external). Instead each row enqueues a `send_notification_email`
// graphile-worker job via the transactional `graphile_worker.add_job` SQL
// function — committed with the transaction, retried by the worker. All Resend
// coupling lives in worker/tasks/send-notification-email.

const EMAIL_TASK = "send_notification_email";

/**
 * Write the given notifications within the caller's open transaction and enqueue
 * one email job per row. A no-op for an empty list — a transition with no live
 * recipient (a deactivated author, a tenant with no active Client Users) writes
 * nothing. Returns the created notification ids (creation order).
 */
export async function recordNotifications(
  tx: Prisma.TransactionClient,
  inputs: readonly NotificationInput[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const input of inputs) {
    // One create per row (not createMany) because we need each id for its email
    // job payload; Postgres createMany returns only a count. Recipient counts are
    // small (one author; a tenant's few Client Users), so N inserts is fine.
    const row = await tx.notification.create({
      data: {
        recipientId: input.recipientId,
        kind: input.kind,
        studyId: input.studyId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        reason: input.reason,
        country: input.country,
      },
      select: { id: true },
    });
    await tx.$executeRaw`select graphile_worker.add_job(${EMAIL_TASK}, ${JSON.stringify(
      { notificationId: row.id },
    )}::json)`;
    ids.push(row.id);
  }
  return ids;
}
