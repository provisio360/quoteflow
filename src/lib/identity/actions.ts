"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { requireAdmin } from "./current-principal";
import { isInternalRole } from "@/domains/authz/principal";
import {
  acceptInvite,
  createInvite,
  resendInvite,
  revokeInvite,
} from "./invites";

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

// ── Admin invite management (ADR-0022 Admin area) ───────────────────────────
// All three gate on requireAdmin. The raw accept-token is returned to the screen
// as a copyable link because invite email is log-only until Resend is configured
// (#42) — the Admin can hand the link over directly meanwhile.

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const acceptUrl = (rawToken: string) =>
  `${APP_URL}/accept-invite?token=${encodeURIComponent(rawToken)}`;

export type CreateInviteActionResult =
  | { ok: true; email: string; acceptUrl: string; expiresAt: string }
  | { ok: false; error: string };

function createInviteError(code: "email-in-use" | "invalid-binding" | "pending-invite-exists"): string {
  switch (code) {
    case "email-in-use":
      return "That email already has an account.";
    case "pending-invite-exists":
      return "There's already a pending invite for that email.";
    case "invalid-binding":
      return "Pick a staff role, or a client to bind a client user to.";
  }
}

export async function createInviteAction(
  _prev: CreateInviteActionResult | null,
  formData: FormData,
): Promise<CreateInviteActionResult> {
  const admin = await requireAdmin();
  const email = String(formData.get("email") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  if (email === "") return { ok: false, error: "Enter an email address." };

  let result;
  if (kind === "internal") {
    const role = String(formData.get("role") ?? "");
    if (!isInternalRole(role)) return { ok: false, error: "Pick a staff role." };
    result = await createInvite({ email, kind: "internal", role, invitedById: admin.userId });
  } else if (kind === "client") {
    const tenantId = String(formData.get("tenantId") ?? "");
    if (tenantId === "") return { ok: false, error: "Pick a client company." };
    result = await createInvite({ email, kind: "client", tenantId, invitedById: admin.userId });
  } else {
    return { ok: false, error: "Choose internal staff or a client user." };
  }

  if (!result.ok) return { ok: false, error: createInviteError(result.error) };
  revalidatePath("/admin");
  return { ok: true, email, acceptUrl: acceptUrl(result.rawToken), expiresAt: result.expiresAt.toISOString() };
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const inviteId = String(formData.get("inviteId") ?? "");
  if (inviteId !== "") await revokeInvite(inviteId);
  revalidatePath("/admin");
}

export type ResendInviteActionResult =
  | { ok: true; acceptUrl: string; expiresAt: string }
  | { ok: false; error: string };

export async function resendInviteAction(
  _prev: ResendInviteActionResult | null,
  formData: FormData,
): Promise<ResendInviteActionResult> {
  await requireAdmin();
  const inviteId = String(formData.get("inviteId") ?? "");
  const result = await resendInvite(inviteId);
  if (!result.ok) {
    return { ok: false, error: result.error === "already-accepted" ? "Already accepted." : "Invite not found." };
  }
  revalidatePath("/admin");
  return { ok: true, acceptUrl: acceptUrl(result.rawToken), expiresAt: result.expiresAt.toISOString() };
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
