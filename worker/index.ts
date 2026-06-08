import "dotenv/config";
import { run } from "graphile-worker";
import healthPing from "./tasks/health-ping";
import fillPendingConversions from "./tasks/fill-pending-conversions";
import sendNotificationEmail from "./tasks/send-notification-email";

// Long-running background worker. Uses the DIRECT (non-pooled) Neon connection:
// graphile-worker relies on session features and LISTEN/NOTIFY that a PgBouncer
// transaction pooler does not support (see ADR-0005).
async function main() {
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString) throw new Error("DIRECT_URL is not set");

  const runner = await run({
    connectionString,
    concurrency: 1,
    taskList: {
      health_ping: healthPing,
      fill_pending_conversions: fillPendingConversions,
      send_notification_email: sendNotificationEmail,
    },
    // Deferred FX sweep, hourly on the hour (ADR-0013): ~24h ceiling, ~1h typical.
    crontab: "0 * * * * fill_pending_conversions",
  });

  await runner.promise;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
