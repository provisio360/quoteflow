import { PrismaClient } from "@prisma/client";

// Single shared Prisma client. The global cache avoids exhausting connections
// during Next.js dev hot-reloads. This is a thin persistence adapter — domain
// logic lives in src/domains and never imports this.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
