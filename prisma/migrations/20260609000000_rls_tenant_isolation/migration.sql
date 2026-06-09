-- Issue #21 / ADR-0021: Postgres Row-Level Security as the tenant-isolation
-- backstop beneath the app-layer policy (ADR-0008). This migration is run by the
-- OWNER role (DIRECT_URL); the owner bypasses RLS, so applying it never locks
-- itself out. The app connects as a separate non-owner role (quoteflow_app) that
-- these policies apply to.

-- ── 1. Denormalized, immutable owning-tenant column on every child table ──────
-- Added nullable, backfilled from the study chain, then pinned NOT NULL.
ALTER TABLE "benchmark_item"     ADD COLUMN "clientId" TEXT;
ALTER TABLE "quote"              ADD COLUMN "clientId" TEXT;
ALTER TABLE "country_assignment" ADD COLUMN "clientId" TEXT;
ALTER TABLE "country_release"    ADD COLUMN "clientId" TEXT;

UPDATE "benchmark_item" bi
  SET "clientId" = s."clientId" FROM "study" s WHERE s."id" = bi."studyId";
UPDATE "quote" q
  SET "clientId" = bi."clientId" FROM "benchmark_item" bi WHERE bi."id" = q."benchmarkItemId";
UPDATE "country_assignment" ca
  SET "clientId" = s."clientId" FROM "study" s WHERE s."id" = ca."studyId";
UPDATE "country_release" cr
  SET "clientId" = s."clientId" FROM "study" s WHERE s."id" = cr."studyId";

ALTER TABLE "benchmark_item"     ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "quote"              ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "country_assignment" ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "country_release"    ALTER COLUMN "clientId" SET NOT NULL;

CREATE INDEX "benchmark_item_clientId_idx"     ON "benchmark_item"("clientId");
CREATE INDEX "quote_clientId_idx"              ON "quote"("clientId");
CREATE INDEX "country_assignment_clientId_idx" ON "country_assignment"("clientId");
CREATE INDEX "country_release_clientId_idx"    ON "country_release"("clientId");

-- ── 2. The non-owner application role ─────────────────────────────────────────
-- A NOLOGIN group role the RLS policies apply to. Guarded by IF NOT EXISTS
-- because Postgres roles are CLUSTER-scoped: a bare CREATE ROLE would fail on
-- Prisma's shadow database (dropped/recreated per migrate) where the role
-- already exists. The real LOGIN role is provisioned out-of-band (Neon) and
-- GRANTed membership in this group (see the issue #21 runbook).
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'quoteflow_app') THEN
    CREATE ROLE quoteflow_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO quoteflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quoteflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO quoteflow_app;
-- Future tables/sequences created by the owner (later migrations) inherit these.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quoteflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO quoteflow_app;

-- ── 3. Enable RLS + the one uniform policy on every tenant-owned table ────────
-- Policy shape (FOR ALL, USING = WITH CHECK):
--   internal staff (app.is_internal='on')  → all rows
--   client user    (clientId = app.tenant_id) → own tenant only
--   neither GUC set → current_setting(...,true) is NULL → matches no rows (fail closed)
-- The owner is not subject to these (it owns the tables); the worker connects as
-- the owner too, by design (ADR-0021).

ALTER TABLE "study" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "study" FOR ALL
  USING      (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true));

ALTER TABLE "benchmark_item" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "benchmark_item" FOR ALL
  USING      (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true));

ALTER TABLE "quote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "quote" FOR ALL
  USING      (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true));

ALTER TABLE "country_assignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "country_assignment" FOR ALL
  USING      (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true));

ALTER TABLE "country_release" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "country_release" FOR ALL
  USING      (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true));

-- The Client (tenant) table itself: a client user may see only its OWN row; the
-- tenant key is the row's own id.
ALTER TABLE "client" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "client" FOR ALL
  USING      (current_setting('app.is_internal', true) = 'on' OR "id" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.is_internal', true) = 'on' OR "id" = current_setting('app.tenant_id', true));
