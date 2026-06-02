import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Proves a real write+read round-trip to Neon without starting the web server.
// Run with `npm run db:smoke`.
async function main() {
  const prisma = new PrismaClient();
  try {
    const created = await prisma.healthCheck.create({
      data: { note: "db-smoke" },
    });
    const count = await prisma.healthCheck.count();
    console.log(
      `DB round-trip OK — inserted ${created.id}, health_check rows: ${count}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("DB smoke failed:", err);
  process.exit(1);
});
