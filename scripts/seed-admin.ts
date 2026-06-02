import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { createCredentialUser } from "../src/lib/identity/users";

// One-shot bootstrap for the very first Admin (grilling Q9). There is no public
// account-creation route by design, so the seed account must be minted out of
// band. This script is the ONLY non-invite creation path and it is deliberately
// guarded: it refuses to run if ANY Admin already exists, so it can never be
// used as a backdoor to mint extra admins in an established system.
//
// Run once:  SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run seed:admin

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || "QuoteFlow Admin";

  if (!email || !password) {
    throw new Error(
      "Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to seed the first admin.",
    );
  }
  if (password.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters.");
  }

  const existingAdmin = await prisma.user.findFirst({
    where: { kind: "internal", role: "Admin" },
    select: { id: true, email: true },
  });
  if (existingAdmin) {
    console.info(
      `An Admin already exists (${existingAdmin.email}). Seed is a no-op; ` +
        `create further users by invite.`,
    );
    return;
  }

  if (await prisma.user.findUnique({ where: { email } })) {
    throw new Error(`A user with email ${email} already exists.`);
  }

  const { id } = await createCredentialUser({
    email,
    name,
    password,
    identity: { kind: "internal", role: "Admin", tenantId: null },
  });
  console.info(`Seeded first Admin: ${email} (id=${id}). Log in and invite the rest.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
