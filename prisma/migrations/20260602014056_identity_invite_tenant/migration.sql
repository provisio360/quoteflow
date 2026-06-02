-- CreateEnum
CREATE TYPE "PrincipalKind" AS ENUM ('internal', 'client');

-- CreateEnum
CREATE TYPE "InternalRole" AS ENUM ('Admin', 'EngagementManager', 'Researcher', 'Analyst');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'deactivated');

-- CreateTable
CREATE TABLE "client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "kind" "PrincipalKind" NOT NULL,
    "role" "InternalRole",
    "tenantId" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "kind" "PrincipalKind" NOT NULL,
    "role" "InternalRole",
    "tenantId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_tenantId_idx" ON "user"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "invite_tokenHash_key" ON "invite"("tokenHash");

-- CreateIndex
CREATE INDEX "invite_email_idx" ON "invite"("email");

-- CreateIndex
CREATE INDEX "invite_tenantId_idx" ON "invite"("tenantId");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite" ADD CONSTRAINT "invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite" ADD CONSTRAINT "invite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Principal invariant (role XOR tenant), the DB mirror of src/domains/authz.
-- internal => role present, tenant absent; client => tenant present, role absent.
-- This is defence-in-depth behind the app-layer toPrincipal() validator.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "user" ADD CONSTRAINT "user_kind_role_tenant_ck" CHECK (
  ("kind" = 'internal' AND "role" IS NOT NULL AND "tenantId" IS NULL)
  OR
  ("kind" = 'client' AND "role" IS NULL AND "tenantId" IS NOT NULL)
);

-- A deactivated user must record when; an active user must not.
ALTER TABLE "user" ADD CONSTRAINT "user_status_deactivatedat_ck" CHECK (
  ("status" = 'active' AND "deactivatedAt" IS NULL)
  OR
  ("status" = 'deactivated' AND "deactivatedAt" IS NOT NULL)
);

-- The same invariant on a pending Invite, so an invite can never mint an
-- illegal principal on acceptance.
ALTER TABLE "invite" ADD CONSTRAINT "invite_kind_role_tenant_ck" CHECK (
  ("kind" = 'internal' AND "role" IS NOT NULL AND "tenantId" IS NULL)
  OR
  ("kind" = 'client' AND "role" IS NULL AND "tenantId" IS NOT NULL)
);
