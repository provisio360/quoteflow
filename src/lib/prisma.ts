import { PrismaClient } from "@prisma/client";

// Single shared Prisma client. The global cache avoids exhausting connections
// during Next.js dev hot-reloads. This is a thin persistence adapter — domain
// logic lives in src/domains and never imports this.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Connect as the non-owner `quoteflow_app` role when its connection string is
// provided (ADR-0021): that role is subject to the RLS backstop, so tenant
// context set via `withTenant` is actually enforced. Falls back to DATABASE_URL
// (the owner, which bypasses RLS) when APP_DATABASE_URL is unset — the
// transitional/dev state, and how migrations-era environments behave until the
// app-role login is provisioned (see the issue #21 Neon runbook).
const runtimeUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: runtimeUrl });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
