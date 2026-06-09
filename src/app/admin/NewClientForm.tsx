"use client";

import { useActionState } from "react";
import { createClientAction, type CreateClientResult } from "@/lib/clients/actions";

// The Admin "new client" form. A client component because the action returns its
// outcome for the same screen to render (useActionState); a successful create
// revalidates /admin so the list below updates.
export function NewClientForm() {
  const [result, formAction, pending] = useActionState<CreateClientResult | null, FormData>(
    createClientAction,
    null,
  );

  return (
    <form action={formAction} style={{ margin: "0.75rem 0", display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <input
        type="text"
        name="name"
        placeholder="Company name"
        aria-label="Company name"
        style={{ padding: "0.35rem 0.5rem", minWidth: "16rem" }}
      />
      <button type="submit" disabled={pending} style={{ padding: "0.35rem 0.8rem" }}>
        {pending ? "Adding…" : "Add client"}
      </button>
      {result?.ok === true && (
        <span role="status" style={{ color: "#0a0" }}>
          Added “{result.name}”.
        </span>
      )}
      {result?.ok === false && (
        <span role="alert" style={{ color: "#b00" }}>
          {result.error}
        </span>
      )}
    </form>
  );
}
