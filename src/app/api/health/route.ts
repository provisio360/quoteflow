import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deriveHealth } from "@/domains/health/status";

export const dynamic = "force-dynamic";

// End-to-end health probe: writes then reads a row through Prisma to prove the
// database round-trip, then derives status via the pure core.
export async function GET() {
  let dbOk = false;
  let lastNote: string | null = null;

  try {
    await prisma.healthCheck.create({ data: { note: "health ping" } });
    const latest = await prisma.healthCheck.findFirst({
      orderBy: { createdAt: "desc" },
    });
    lastNote = latest?.note ?? null;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const health = deriveHealth({ dbOk });
  return NextResponse.json(
    { ...health, lastNote },
    { status: health.status === "down" ? 503 : 200 },
  );
}
