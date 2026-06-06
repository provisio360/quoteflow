-- AlterTable
ALTER TABLE "quote" ADD COLUMN     "justification" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AlterTable
-- Required going forward (set at study setup). Existing rows are pre-launch test
-- data only (grilling for #11): backfill them with a placeholder 25% via a
-- transient column default, then drop the default so new studies must supply it.
ALTER TABLE "study" ADD COLUMN     "qcThresholdPct" DECIMAL(5,2) NOT NULL DEFAULT 25.00;
ALTER TABLE "study" ALTER COLUMN  "qcThresholdPct" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "quote_reviewedById_idx" ON "quote"("reviewedById");

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
