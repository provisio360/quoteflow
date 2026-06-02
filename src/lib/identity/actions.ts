"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { acceptInvite } from "./invites";

// Server actions backing the login / accept-invite forms. Calling auth.api.*
// inside a server action sets the session cookie via the nextCookies plugin
// (ADR-0006: opaque server-side session cookie).

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (err) {
    // Non-enumeration: same generic message whether the email is unknown or the
    // password is wrong (grilling Q11).
    if (err instanceof APIError) {
      redirect("/login?error=invalid-credentials");
    }
    throw err;
  }
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}

export async function acceptInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!name || !token) redirect(`/accept-invite?token=${encodeURIComponent(token)}&error=missing-fields`);

  const result = await acceptInvite({ token, name, password });
  if (!result.ok) {
    redirect(`/accept-invite?token=${encodeURIComponent(token)}&error=${result.error}`);
  }

  // Acceptance succeeded — log the new user straight in.
  try {
    const invite = await getInviteEmailForToken(token);
    if (invite) {
      await auth.api.signInEmail({ body: { email: invite, password }, headers: await headers() });
    }
  } catch {
    // If auto-login fails for any reason, the account still exists — send them
    // to login to sign in manually rather than erroring the whole acceptance.
    redirect("/login");
  }
  redirect("/");
}

// Small helper kept here (not exported as an action) to find the email the just-
// accepted token belonged to, for auto-login.
async function getInviteEmailForToken(token: string): Promise<string | null> {
  const { hashToken } = await import("./tokens");
  const { prisma } = await import("@/lib/prisma");
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { email: true },
  });
  return invite?.email ?? null;
}
