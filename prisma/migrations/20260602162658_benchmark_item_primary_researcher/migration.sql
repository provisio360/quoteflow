-- AlterTable
ALTER TABLE "benchmark_item" ADD COLUMN     "primaryResearcherId" TEXT;

-- CreateIndex
CREATE INDEX "benchmark_item_primaryResearcherId_idx" ON "benchmark_item"("primaryResearcherId");

-- AddForeignKey
ALTER TABLE "benchmark_item" ADD CONSTRAINT "benchmark_item_primaryResearcherId_fkey" FOREIGN KEY ("primaryResearcherId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
