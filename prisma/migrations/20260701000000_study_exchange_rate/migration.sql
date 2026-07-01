-- Issue #160 / ADR-0041: the per-Pricing-Study manual exchange-rate table an
-- Engagement Manager or Analyst seeds on study setup, ahead of the FX provider.
-- Entry & audit only — this slice does NOT feed quote conversion (a later slice).

-- ── 1. Audit vocabulary: the new set/edit action and its subject type ─────────
-- Set/edit writes a `studyRateSet` Audit Event (subject StudyExchangeRate, null
-- monetary pair — a Decimal(18,8) rate won't fit the pair's Decimal(14,4)).
-- Not used in this migration's own SQL, so adding the values here is safe.
ALTER TYPE "AuditAction" ADD VALUE 'studyRateSet';
ALTER TYPE "AuditSubjectType" ADD VALUE 'StudyExchangeRate';

-- ── 2. The table: rows keyed (study, currency, rateDate) ──────────────────────
-- `clientId` is the denormalized RLS backstop (ADR-0021), copied from the study
-- on insert and verified by WITH CHECK. `rateDate` is a date-only column;
-- `rate` matches the pinned Exchange Rate's Decimal(18,8) precision.
CREATE TABLE "study_exchange_rate" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rateDate" DATE NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_exchange_rate_pkey" PRIMARY KEY ("id")
);

-- One rate per currency per date within a study (currency-keyed, ADR-0041).
CREATE UNIQUE INDEX "study_exchange_rate_studyId_currency_rateDate_key"
  ON "study_exchange_rate"("studyId", "currency", "rateDate");
CREATE INDEX "study_exchange_rate_studyId_idx"  ON "study_exchange_rate"("studyId");
CREATE INDEX "study_exchange_rate_clientId_idx" ON "study_exchange_rate"("clientId");

ALTER TABLE "study_exchange_rate"
  ADD CONSTRAINT "study_exchange_rate_studyId_fkey"
  FOREIGN KEY ("studyId") REFERENCES "study"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. Row-level security (ADR-0021) ──────────────────────────────────────────
-- ALTER DEFAULT PRIVILEGES (issue #21 migration) already grants quoteflow_app DML
-- on tables created later, so only the RLS enable + uniform tenant policy remain.
ALTER TABLE "study_exchange_rate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "study_exchange_rate" FOR ALL
  USING      (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true));
