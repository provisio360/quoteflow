-- CreateTable
CREATE TABLE "export_audit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "exportType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_audit_clientId_idx" ON "export_audit"("clientId");

-- CreateIndex
CREATE INDEX "export_audit_studyId_idx" ON "export_audit"("studyId");

-- CreateIndex
CREATE INDEX "export_audit_userId_idx" ON "export_audit"("userId");

-- AddForeignKey
ALTER TABLE "export_audit" ADD CONSTRAINT "export_audit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
