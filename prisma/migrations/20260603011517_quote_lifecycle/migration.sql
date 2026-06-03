-- CreateEnum
CREATE TYPE "QuoteState" AS ENUM ('Draft', 'Submitted', 'Approved', 'Rejected');

-- AlterTable
ALTER TABLE "benchmark_item" ADD COLUMN     "quoteSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "quote" (
    "id" TEXT NOT NULL,
    "benchmarkItemId" TEXT NOT NULL,
    "quoteNumber" INTEGER NOT NULL,
    "state" "QuoteState" NOT NULL DEFAULT 'Draft',
    "createdById" TEXT NOT NULL,
    "competitorBrand" TEXT,
    "dealerName" TEXT,
    "dealerLocation" TEXT,
    "dealerUrl" TEXT,
    "price" DECIMAL(14,4),
    "currency" TEXT,
    "quantityQuoted" INTEGER,
    "stockStatus" TEXT,
    "leadTime" TEXT,
    "warranty" TEXT,
    "discount" TEXT,
    "notes" TEXT,
    "dateQuoteReceived" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_benchmarkItemId_idx" ON "quote"("benchmarkItemId");

-- CreateIndex
CREATE INDEX "quote_createdById_idx" ON "quote"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "quote_benchmarkItemId_quoteNumber_key" ON "quote"("benchmarkItemId", "quoteNumber");

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_benchmarkItemId_fkey" FOREIGN KEY ("benchmarkItemId") REFERENCES "benchmark_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
