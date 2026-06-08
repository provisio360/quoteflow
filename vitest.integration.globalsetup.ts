import "dotenv/config";
import { runMigrations } from "graphile-worker";

// graphile-worker's schema is NOT part of the Prisma migrations — it is installed
// by the worker at runtime. The notification outbox (#17 / ADR-0020) enqueues
// jobs via `graphile_worker.add_job` INSIDE the reject/release transaction, so
// that schema must exist for the integration suite to exercise those paths. CI's
// fresh Postgres has only the Prisma migrations applied, so install graphile's
// schema once, up front, before any integration test runs. Idempotent — a no-op
// when the schema is already present (e.g. a dev DB the worker has run against).
export default async function setup(): Promise<void> {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DIRECT_URL/DATABASE_URL must be set for the integration suite");
  }
  // Uses the DIRECT (non-pooled) connection graphile-worker requires (ADR-0005).
  await runMigrations({ connectionString });
}
