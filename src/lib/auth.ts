import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "./prisma";
import { sendEmail } from "./notifications";

// ─────────────────────────────────────────────────────────────────────────────
// Better Auth server instance — app-owned email/password, DB-backed sessions.
// See ADR-0005 (Better Auth in our Postgres), ADR-0006 (opaque server sessions
// over JWT) and ADR-0007 (authn separated from the principal).
//
// Self-signup is disabled: the ONLY way an account comes into existence is an
// Admin invite accepted server-side (src/lib/identity/*). Email verification is
// the invite acceptance itself, so we don't require a separate verify step here.
// ─────────────────────────────────────────────────────────────────────────────

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  appName: "QuoteFlow",
  secret: requiredEnv("BETTER_AUTH_SECRET"),
  baseURL: process.env.BETTER_AUTH_URL ?? appUrl,

  database: prismaAdapter(prisma, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    // Invite-only: no open self-signup path exists (issue #3 AC).
    disableSignUp: true,
    // Length beats complexity theatre (grilling Q11).
    minPasswordLength: 12,
    maxPasswordLength: 256,
    // Verification is handled by invite acceptance, not a second email.
    requireEmailVerification: false,
    // On reset, kill every existing session so a recovered account boots any
    // attacker still holding a live session (grilling Q11 / ADR-0006).
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
    async sendResetPassword({ user, url }) {
      // Deactivated accounts cannot reset — offboarding can't be undone via the
      // reset flow (grilling Q6/Q11). The endpoint still returns a generic
      // response (Better Auth's built-in non-enumeration), so skipping here
      // leaks nothing about whether the account exists or is active.
      const status = (user as { status?: string }).status;
      if (status === "deactivated") return;
      await sendEmail({
        to: user.email,
        subject: "Reset your QuoteFlow password",
        body: `A password reset was requested for your QuoteFlow account.\n\nReset it here (link expires in 1 hour):\n${url}\n\nIf you didn't request this, you can ignore this email.`,
      });
    },
  },

  // QuoteFlow identity fields, persisted on the user table. input:false means
  // they can never be set through Better Auth's public endpoints — only our
  // server-side invite/admin code writes them (ADR-0007: authority lives on the
  // principal, set by us, never client-supplied).
  user: {
    additionalFields: {
      kind: { type: "string", required: true, input: false },
      role: { type: "string", required: false, input: false },
      tenantId: { type: "string", required: false, input: false },
      status: { type: "string", required: false, input: false, defaultValue: "active" },
      deactivatedAt: { type: "date", required: false, input: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh once per day
  },

  // Must be last: makes Better Auth set session cookies from Next.js server
  // actions / route handlers.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
