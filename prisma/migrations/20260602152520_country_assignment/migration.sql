-- CreateTable
CREATE TABLE "country_assignment" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "researcherId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "country_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "country_assignment_researcherId_idx" ON "country_assignment"("researcherId");

-- CreateIndex
CREATE INDEX "country_assignment_studyId_idx" ON "country_assignment"("studyId");

-- CreateIndex
CREATE UNIQUE INDEX "country_assignment_studyId_country_researcherId_key" ON "country_assignment"("studyId", "country", "researcherId");

-- AddForeignKey
ALTER TABLE "country_assignment" ADD CONSTRAINT "country_assignment_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "study"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_assignment" ADD CONSTRAINT "country_assignment_researcherId_fkey" FOREIGN KEY ("researcherId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_assignment" ADD CONSTRAINT "country_assignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
