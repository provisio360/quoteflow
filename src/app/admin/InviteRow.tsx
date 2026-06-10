"use client";

import { useActionState } from "react";
import {
  resendInviteAction,
  revokeInviteAction,
  type ResendInviteActionResult,
} from "@/lib/identity/actions";
import type { InviteSummary } from "@/lib/identity/invites";

// One invite in the Admin list. Only a pending invite is actionable (revoke /
// resend); resend returns a fresh accept-link to copy (email is log-only, #42).
export function InviteRow({ invite }: { invite: InviteSummary }) {
  const [resent, resendAction, pending] = useActionState<ResendInviteActionResult | null, FormData>(
    resendInviteAction,
    null,
  );

  const binding = invite.kind === "internal" ? (invite.role ?? "staff") : "client user";
  const actionable = invite.status === "pending";

  return (
    <li style={{ padding: "0.4rem 0", borderTop: "1px solid #eee" }}>
      <span>{invite.email}</span>{" "}
      <span style={{ color: "#777" }}>
        — {binding} · {invite.status}
      </span>
      {actionable && (
        <span style={{ marginLeft: "0.6rem" }}>
          <form action={revokeInviteAction} style={{ display: "inline" }}>
            <input type="hidden" name="inviteId" value={invite.id} />
            <button type="submit" style={{ padding: "0.15rem 0.5rem", marginRight: "0.3rem" }}>
              Revoke
            </button>
          </form>
          <form action={resendAction} style={{ display: "inline" }}>
            <input type="hidden" name="inviteId" value={invite.id} />
            <button type="submit" disabled={pending} style={{ padding: "0.15rem 0.5rem" }}>
              {pending ? "Resending…" : "Resend"}
            </button>
          </form>
        </span>
      )}
      {resent?.ok === true && (
        <input
          readOnly
          value={resent.acceptUrl}
          aria-label="New invite link"
          onFocus={(e) => e.currentTarget.select()}
          style={{ display: "block", width: "100%", marginTop: "0.3rem", padding: "0.3rem", fontFamily: "monospace" }}
        />
      )}
      {resent?.ok === false && (
        <span role="alert" style={{ color: "#b00", marginLeft: "0.5rem" }}>
          {resent.error}
        </span>
      )}
    </li>
  );
}
