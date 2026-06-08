-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('submit', 'approve', 'reject', 'release', 'reopen', 'import', 'clientPriceChange', 'assign');

-- CreateEnum
CREATE TYPE "AuditSubjectType" AS ENUM ('Quote', 'BenchmarkItem', 'CountryRelease', 'CountryAssignment');

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "subjectType" "AuditSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "beforeValue" DECIMAL(14,4),
    "afterValue" DECIMAL(14,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_event_studyId_createdAt_idx" ON "audit_event"("studyId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_event_subjectType_subjectId_idx" ON "audit_event"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "audit_event_actorId_idx" ON "audit_event"("actorId");

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
