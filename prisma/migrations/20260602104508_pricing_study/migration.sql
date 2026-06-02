-- CreateTable
CREATE TABLE "study" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "study_clientId_idx" ON "study"("clientId");

-- CreateIndex
CREATE INDEX "study_createdById_idx" ON "study"("createdById");

-- AddForeignKey
ALTER TABLE "study" ADD CONSTRAINT "study_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study" ADD CONSTRAINT "study_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
