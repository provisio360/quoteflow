-- CreateTable
CREATE TABLE "benchmark_item" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "clientPartNumber" TEXT NOT NULL,
    "clientPartNumberKey" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "configurationComment" TEXT,
    "quantity" INTEGER,
    "machineModel" TEXT NOT NULL,
    "requiredQuotes" INTEGER NOT NULL,
    "clientPrice" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benchmark_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "benchmark_item_studyId_idx" ON "benchmark_item"("studyId");

-- CreateIndex
CREATE UNIQUE INDEX "benchmark_item_studyId_country_clientPartNumberKey_key" ON "benchmark_item"("studyId", "country", "clientPartNumberKey");

-- AddForeignKey
ALTER TABLE "benchmark_item" ADD CONSTRAINT "benchmark_item_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "study"("id") ON DELETE CASCADE ON UPDATE CASCADE;
