import type { Task } from "graphile-worker";
import { sendNotificationEmail } from "../../src/lib/notifications/send";

// The deferred email channel for notifications (#17 / ADR-0020). Enqueued
// transactionally by recordNotifications in the reject/release transaction, so a
// job exists ⇔ its notification committed. Thin glue over src/lib's
// sendNotificationEmail (the testable unit); graphile owns retries/backoff.
const sendNotificationEmailTask: Task = async (payload, helpers) => {
  const { notificationId } = payload as { notificationId: string };
  if (!notificationId) {
    helpers.logger.error("send_notification_email: payload missing notificationId");
    return;
  }
  await sendNotificationEmail(notificationId);
  helpers.logger.info(`send_notification_email: processed ${notificationId}`);
};

export default sendNotificationEmailTask;
