-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('quoteRejected', 'countryReleased');

-- CreateEnum
CREATE TYPE "NotificationSubjectType" AS ENUM ('Quote', 'CountryRelease');

-- AlterTable
ALTER TABLE "country_release" ADD COLUMN     "clientNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "studyId" TEXT NOT NULL,
    "subjectType" "NotificationSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reason" TEXT,
    "country" TEXT,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_recipientId_readAt_idx" ON "notification"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "notification_recipientId_createdAt_idx" ON "notification"("recipientId", "createdAt");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
