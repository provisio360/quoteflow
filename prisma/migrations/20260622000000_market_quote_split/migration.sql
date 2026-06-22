-- Issue #87 / ADR-0026: split the flat `quote` into the two-level aggregate
-- Market Quote (dealer document) + Quote Line (one per Benchmark Item it prices),
-- with two per-(study, country) numbering counters on `quote_number_sequence`.
--
-- The flat `quote` is RENAMED IN PLACE to `quote_line` (preserving every line's
-- id) so historical AuditEvent/Notification rows whose polymorphic `subjectId`
-- pointed at a quote still resolve to the surviving Quote Line. The document-level
-- facts (source, date, currency, pinned conversion) are LIFTED UP into one new
-- one-line `market_quote` per row (fresh ids — nothing references them yet). No
-- merging: each flat quote becomes its own one-line document.

-- ── 1. Enums ──────────────────────────────────────────────────────────────────
CREATE TYPE "ConfidenceCode" AS ENUM ('High', 'Moderate', 'Low');

-- Add the new audit/notification subject types; `Quote` is RETAINED as a legacy
-- value so pre-split history stays enum-valid. Not used in this migration, so
-- adding them inside the migration transaction is safe (PG12+).
ALTER TYPE "AuditSubjectType" ADD VALUE 'MarketQuote';
ALTER TYPE "AuditSubjectType" ADD VALUE 'QuoteLine';
ALTER TYPE "NotificationSubjectType" ADD VALUE 'QuoteLine';

-- ── 2. New document table: market_quote ───────────────────────────────────────
CREATE TABLE "market_quote" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "marketQuoteNumber" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "sourceName" TEXT,
    "sourceLocation" TEXT,
    "sourceUrl" TEXT,
    "currency" TEXT,
    "dateQuoteReceived" TIMESTAMP(3),
    "exchangeRate" DECIMAL(18,8),
    "rateDate" TIMESTAMP(3),
    "conversionStatus" "ConversionStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_quote_pkey" PRIMARY KEY ("id")
);

-- ── 3. New numbering table: quote_number_sequence ─────────────────────────────
CREATE TABLE "quote_number_sequence" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "marketQuoteSeq" INTEGER NOT NULL DEFAULT 0,
    "quoteLineSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_number_sequence_pkey" PRIMARY KEY ("id")
);

-- ── 4. Rename quote → quote_line; shed the constraints tied to lifted/dropped cols
ALTER TABLE "quote" RENAME TO "quote_line";
ALTER INDEX "quote_pkey" RENAME TO "quote_line_pkey";

ALTER TABLE "quote_line" DROP CONSTRAINT "quote_benchmarkItemId_fkey";
ALTER TABLE "quote_line" DROP CONSTRAINT "quote_createdById_fkey";
ALTER TABLE "quote_line" DROP CONSTRAINT "quote_reviewedById_fkey";
DROP INDEX "quote_benchmarkItemId_quoteNumber_key";
DROP INDEX "quote_benchmarkItemId_idx";
DROP INDEX "quote_createdById_idx";
DROP INDEX "quote_reviewedById_idx";
DROP INDEX "quote_clientId_idx";
-- The RENAME carried the row-level-security ENABLE and the `tenant_isolation`
-- policy with the table (they are attached to the table, not its name), so
-- quote_line stays tenant-protected with no further action.

-- ── 5. Add the new Quote Line columns (the to-be-NOT-NULL ones start nullable) ─
ALTER TABLE "quote_line"
    ADD COLUMN "marketQuoteId" TEXT,
    ADD COLUMN "studyId" TEXT,
    ADD COLUMN "country" TEXT,
    ADD COLUMN "quoteLineNumber" INTEGER,
    ADD COLUMN "competitorPartNumber" TEXT,
    ADD COLUMN "competitorPartDescription" TEXT,
    ADD COLUMN "leadTimeValue" DECIMAL(14,4),
    ADD COLUMN "leadTimeUnit" TEXT,
    ADD COLUMN "warranty1Value" DECIMAL(14,4),
    ADD COLUMN "warranty1Unit" TEXT,
    ADD COLUMN "warranty2Value" DECIMAL(14,4),
    ADD COLUMN "warranty2Unit" TEXT,
    ADD COLUMN "discountAvailable" BOOLEAN,
    ADD COLUMN "discountApplied" BOOLEAN,
    ADD COLUMN "discountValue" DECIMAL(14,4),
    ADD COLUMN "discountType" TEXT,
    ADD COLUMN "landedCostIncluded" BOOLEAN,
    ADD COLUMN "landedCostNote" TEXT,
    ADD COLUMN "notesSecondary" TEXT,
    ADD COLUMN "confidenceCode" "ConfidenceCode",
    ADD COLUMN "paperQuote" BOOLEAN NOT NULL DEFAULT false;

-- ── 6. Backfill the denormalized scope from the parent Benchmark Item ─────────
UPDATE "quote_line" ql
   SET "studyId" = bi."studyId", "country" = bi."country"
  FROM "benchmark_item" bi
 WHERE bi."id" = ql."benchmarkItemId";

-- ── 7. Deterministic numbering, flat 1..N per (study, country) by (createdAt, id)
-- One-line documents, so the Market Quote Number and Quote Line Number coincide.
WITH numbered AS (
    SELECT "id",
           ROW_NUMBER() OVER (PARTITION BY "studyId", "country"
                              ORDER BY "createdAt", "id") AS n
      FROM "quote_line"
)
UPDATE "quote_line" ql
   SET "quoteLineNumber" = numbered.n
  FROM numbered
 WHERE numbered."id" = ql."id";

-- ── 8. Lift each line's document facts into its own one-line Market Quote ──────
-- A temp column carries the source line id so step 9 can link them back.
ALTER TABLE "market_quote" ADD COLUMN "_sourceLineId" TEXT;
INSERT INTO "market_quote" (
    "id", "studyId", "clientId", "country", "marketQuoteNumber", "createdById",
    "sourceName", "sourceLocation", "sourceUrl", "currency", "dateQuoteReceived",
    "exchangeRate", "rateDate", "conversionStatus", "createdAt", "updatedAt",
    "_sourceLineId"
)
SELECT gen_random_uuid()::text, ql."studyId", ql."clientId", ql."country",
       ql."quoteLineNumber", ql."createdById",
       ql."dealerName", ql."dealerLocation", ql."dealerUrl", ql."currency",
       ql."dateQuoteReceived", ql."exchangeRate", ql."rateDate",
       ql."conversionStatus", ql."createdAt", ql."updatedAt", ql."id"
  FROM "quote_line" ql;

-- ── 9. Link each line to its document, then drop the temp link column ─────────
UPDATE "quote_line" ql
   SET "marketQuoteId" = mq."id"
  FROM "market_quote" mq
 WHERE mq."_sourceLineId" = ql."id";
ALTER TABLE "market_quote" DROP COLUMN "_sourceLineId";

-- ── 10. Fold the legacy free-text trio into the secondary note ────────────────
-- concat_ws skips NULL parts; NULLIF makes an all-absent fold null (no note).
-- Mirrors the pure `foldLegacyText` reference exactly.
UPDATE "quote_line"
   SET "notesSecondary" = NULLIF(concat_ws('; ',
         CASE WHEN "leadTime" IS NOT NULL THEN 'Lead time: ' || "leadTime" END,
         CASE WHEN "warranty" IS NOT NULL THEN 'Warranty: ' || "warranty" END,
         CASE WHEN "discount" IS NOT NULL THEN 'Discount: ' || "discount" END
       ), '');

-- ── 11. Seed the sequence rows to the highest number already allocated ────────
INSERT INTO "quote_number_sequence" (
    "id", "studyId", "clientId", "country",
    "marketQuoteSeq", "quoteLineSeq", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text, "studyId", min("clientId"), "country",
       count(*), count(*), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "quote_line"
 GROUP BY "studyId", "country";

-- ── 12. Drop the columns now lifted to market_quote or folded away ────────────
ALTER TABLE "quote_line"
    DROP COLUMN "quoteNumber",
    DROP COLUMN "dealerName",
    DROP COLUMN "dealerLocation",
    DROP COLUMN "dealerUrl",
    DROP COLUMN "currency",
    DROP COLUMN "dateQuoteReceived",
    DROP COLUMN "exchangeRate",
    DROP COLUMN "rateDate",
    DROP COLUMN "conversionStatus",
    DROP COLUMN "leadTime",
    DROP COLUMN "warranty",
    DROP COLUMN "discount";

-- ── 13. Pin the backfilled scope columns NOT NULL ─────────────────────────────
ALTER TABLE "quote_line"
    ALTER COLUMN "marketQuoteId" SET NOT NULL,
    ALTER COLUMN "studyId" SET NOT NULL,
    ALTER COLUMN "country" SET NOT NULL,
    ALTER COLUMN "quoteLineNumber" SET NOT NULL;

-- ── 14. Indexes on the new tables + the reshaped quote_line ───────────────────
CREATE INDEX "market_quote_studyId_idx" ON "market_quote"("studyId");
CREATE INDEX "market_quote_createdById_idx" ON "market_quote"("createdById");
CREATE INDEX "market_quote_clientId_idx" ON "market_quote"("clientId");
CREATE UNIQUE INDEX "market_quote_studyId_country_marketQuoteNumber_key" ON "market_quote"("studyId", "country", "marketQuoteNumber");

CREATE INDEX "quote_line_marketQuoteId_idx" ON "quote_line"("marketQuoteId");
CREATE INDEX "quote_line_benchmarkItemId_idx" ON "quote_line"("benchmarkItemId");
CREATE INDEX "quote_line_createdById_idx" ON "quote_line"("createdById");
CREATE INDEX "quote_line_reviewedById_idx" ON "quote_line"("reviewedById");
CREATE INDEX "quote_line_clientId_idx" ON "quote_line"("clientId");
CREATE UNIQUE INDEX "quote_line_marketQuoteId_benchmarkItemId_key" ON "quote_line"("marketQuoteId", "benchmarkItemId");
CREATE UNIQUE INDEX "quote_line_studyId_country_quoteLineNumber_key" ON "quote_line"("studyId", "country", "quoteLineNumber");

CREATE INDEX "quote_number_sequence_clientId_idx" ON "quote_number_sequence"("clientId");
CREATE UNIQUE INDEX "quote_number_sequence_studyId_country_key" ON "quote_number_sequence"("studyId", "country");

-- ── 15. Foreign keys ──────────────────────────────────────────────────────────
ALTER TABLE "market_quote" ADD CONSTRAINT "market_quote_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "study"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "market_quote" ADD CONSTRAINT "market_quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_marketQuoteId_fkey" FOREIGN KEY ("marketQuoteId") REFERENCES "market_quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_benchmarkItemId_fkey" FOREIGN KEY ("benchmarkItemId") REFERENCES "benchmark_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_number_sequence" ADD CONSTRAINT "quote_number_sequence_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "study"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 16. Row-level security on the two NEW tables (quote_line kept its policy) ──
-- ALTER DEFAULT PRIVILEGES (issue #21 migration) already grants quoteflow_app DML
-- on tables created later, so only the RLS enable + uniform tenant policy remain.
ALTER TABLE "market_quote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "market_quote" FOR ALL
  USING      (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true));

ALTER TABLE "quote_number_sequence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "quote_number_sequence" FOR ALL
  USING      (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.is_internal', true) = 'on' OR "clientId" = current_setting('app.tenant_id', true));

-- ── 17. Drop the superseded per-item Quote Number allocator (ADR-0010) ────────
ALTER TABLE "benchmark_item" DROP COLUMN "quoteSeq";
