import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deriveHealth } from "@/domains/health/status";

export const dynamic = "force-dynamic";

// End-to-end health probe: writes then reads a row through Prisma to prove the
// database round-trip, then derives status via the pure core.
export async function GET() {
  let dbOk = false;

  try {
    // Create + read round-trip proves the DB path. Result is intentionally
    // discarded — health-check row content is not echoed to unauthed callers.
    await prisma.healthCheck.create({ data: { note: "health ping" } });
    await prisma.healthCheck.findFirst({ orderBy: { createdAt: "desc" } });
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const health = deriveHealth({ dbOk });
  return NextResponse.json(health, {
    status: health.status === "down" ? 503 : 200,
  });
}
