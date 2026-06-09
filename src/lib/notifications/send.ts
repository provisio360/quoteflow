import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications";
import { renderNotificationEmail } from "@/domains/notifications/render";

// The deferred email step behind the `send_notification_email` graphile job
// (#17 / ADR-0020). Kept in src/lib (not the worker) so it is integration-
// testable without the worker runtime, mirroring conversion-fill. Resolves a
// notification to its recipient + study, renders, delivers via the sendEmail
// port, and stamps emailedAt.
//
// Runs in the BACKGROUND WORKER on the OWNER connection, which bypasses RLS by
// design (ADR-0021) — so the `study` lookup here needs no tenant GUC. The
// worker's environment must NOT set APP_DATABASE_URL (see the #21 runbook).

/**
 * Deliver one notification's email, by id. At-least-once: the graphile job may
 * re-run, so this is a no-op when the notification is already emailed (dedupe) or
 * no longer exists (a stale job must succeed, not retry forever).
 */
export async function sendNotificationEmail(notificationId: string): Promise<void> {
  const note = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: {
      emailedAt: true,
      kind: true,
      reason: true,
      country: true,
      studyId: true,
      recipient: { select: { email: true } },
    },
  });
  if (note === null) return; // deleted between enqueue and run — nothing to send
  if (note.emailedAt !== null) return; // already delivered on a prior run

  const study = await prisma.study.findUnique({
    where: { id: note.studyId },
    select: { name: true },
  });

  const email = renderNotificationEmail({
    kind: note.kind,
    reason: note.reason,
    country: note.country,
    studyName: study?.name ?? "",
  });
  await sendEmail({ to: note.recipient.email, subject: email.subject, body: email.body });

  await prisma.notification.update({
    where: { id: notificationId },
    data: { emailedAt: new Date() },
  });
}
