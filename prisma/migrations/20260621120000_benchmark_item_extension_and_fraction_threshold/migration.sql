-- Benchmark Item extension + Client Price derivation + fraction QC Threshold (#86).
--
-- Hand-written to PRESERVE data: the identity and machine/model columns are
-- RENAMED (not dropped/re-added), and the study QC Threshold is CONVERTED from a
-- percentage to a fraction in place (÷100), not recreated. See ADR-0009/0014/
-- 0015/0027.

-- 1) BenchmarkItem identity rename (clientPartNumber -> clientItemNumber).
ALTER TABLE "benchmark_item" RENAME COLUMN "clientPartNumber" TO "clientItemNumber";
ALTER TABLE "benchmark_item" RENAME COLUMN "clientPartNumberKey" TO "clientItemNumberKey";
ALTER INDEX "benchmark_item_studyId_country_clientPartNumberKey_key"
  RENAME TO "benchmark_item_studyId_country_clientItemNumberKey_key";

-- 2) machineModel -> clientSourceUnit, now nullable (#86: not every brief has one).
ALTER TABLE "benchmark_item" RENAME COLUMN "machineModel" TO "clientSourceUnit";
ALTER TABLE "benchmark_item" ALTER COLUMN "clientSourceUnit" DROP NOT NULL;

-- 3) New nullable descriptive columns + per-item threshold + competitors + the
--    Client Price seed trio.
ALTER TABLE "benchmark_item"
  ADD COLUMN "sourceUnitIdentifier" TEXT,
  ADD COLUMN "clientCategory" TEXT,
  ADD COLUMN "clientItemOffering" TEXT,
  ADD COLUMN "itemSecondaryDescription" TEXT,
  ADD COLUMN "clientSecondaryItemNumber" TEXT,
  ADD COLUMN "qcThreshold" DECIMAL(6,4),
  ADD COLUMN "requiredCompetitors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "clientItemPrice" DECIMAL(14,4),
  ADD COLUMN "clientItemPriceCurrency" TEXT,
  ADD COLUMN "clientItemPriceQuantity" DECIMAL(14,4);

-- 4) Study QC Threshold: percentage -> fraction, in place. Always-run ÷100 is a
--    no-op on an empty table and correct on populated rows (e.g. 25.00 -> 0.2500).
ALTER TABLE "study" RENAME COLUMN "qcThresholdPct" TO "qcThreshold";
ALTER TABLE "study" ALTER COLUMN "qcThreshold" TYPE DECIMAL(6,4) USING ("qcThreshold" / 100);
