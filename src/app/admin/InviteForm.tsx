"use client";

import { useActionState, useState } from "react";
import { createInviteAction, type CreateInviteActionResult } from "@/lib/identity/actions";

// The Admin "send invite" form. Kind toggles the binding: an internal invite
// carries a staff role; a client invite binds to a tenant (Client). On success
// it shows the accept-link to copy — invite email is log-only until Resend (#42).

const ROLES: { value: string; label: string }[] = [
  { value: "EngagementManager", label: "Engagement Manager" },
  { value: "Analyst", label: "Analyst" },
  { value: "Researcher", label: "Researcher" },
  { value: "Admin", label: "Admin" },
];

export function InviteForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [result, formAction, pending] = useActionState<CreateInviteActionResult | null, FormData>(
    createInviteAction,
    null,
  );
  const [kind, setKind] = useState<"internal" | "client">("internal");

  return (
    <form action={formAction} style={{ margin: "0.75rem 0", display: "grid", gap: "0.5rem", maxWidth: "32rem" }}>
      <input
        type="email"
        name="email"
        placeholder="email@company.com"
        aria-label="Invitee email"
        style={{ padding: "0.35rem 0.5rem" }}
      />
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <select
          name="kind"
          aria-label="Invite kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as "internal" | "client")}
          style={{ padding: "0.35rem" }}
        >
          <option value="internal">Internal staff</option>
          <option value="client">Client user</option>
        </select>

        {kind === "internal" ? (
          <select name="role" aria-label="Staff role" style={{ padding: "0.35rem" }}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        ) : (
          <select name="tenantId" aria-label="Client company" style={{ padding: "0.35rem" }}>
            <option value="">— pick a client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        <button type="submit" disabled={pending} style={{ padding: "0.35rem 0.8rem" }}>
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>

      {result?.ok === true && (
        <div role="status" style={{ color: "#0a0" }}>
          Invite created for {result.email}. Copy this link (expires{" "}
          {new Date(result.expiresAt).toLocaleString()}):
          <input
            readOnly
            value={result.acceptUrl}
            aria-label="Invite accept link"
            onFocus={(e) => e.currentTarget.select()}
            style={{ display: "block", width: "100%", marginTop: "0.3rem", padding: "0.3rem", fontFamily: "monospace" }}
          />
        </div>
      )}
      {result?.ok === false && (
        <span role="alert" style={{ color: "#b00" }}>
          {result.error}
        </span>
      )}
    </form>
  );
}
