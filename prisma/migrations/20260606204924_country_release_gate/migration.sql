-- CreateEnum
CREATE TYPE "ReleaseState" AS ENUM ('released', 'reopened');

-- CreateTable
CREATE TABLE "country_release" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "state" "ReleaseState" NOT NULL,
    "releasedById" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL,
    "reopenedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_release_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "country_release_studyId_idx" ON "country_release"("studyId");

-- CreateIndex
CREATE UNIQUE INDEX "country_release_studyId_country_key" ON "country_release"("studyId", "country");

-- AddForeignKey
ALTER TABLE "country_release" ADD CONSTRAINT "country_release_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "study"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_release" ADD CONSTRAINT "country_release_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_release" ADD CONSTRAINT "country_release_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
