"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createStudyAction, type CreateStudyResult } from "@/lib/studies/actions";

// The "new study" form (EM/Analyst). Picks the Client (tenant) the study is for —
// an explicit choice, since internal staff have no tenant — plus the name and the
// study's QC Threshold. On success it links straight to the new study.
export function NewStudyForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [result, formAction, pending] = useActionState<CreateStudyResult | null, FormData>(
    createStudyAction,
    null,
  );

  return (
    <form action={formAction} style={{ display: "grid", gap: "0.5rem", maxWidth: "32rem", margin: "0.5rem 0 1.5rem" }}>
      <input type="text" name="name" placeholder="Study name" aria-label="Study name" style={{ padding: "0.35rem 0.5rem" }} />
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <select name="clientId" aria-label="Client" style={{ padding: "0.35rem" }} defaultValue="">
          <option value="">— pick a client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          QC threshold
          <input
            type="number"
            name="qcThresholdPct"
            min="0"
            step="0.01"
            defaultValue="25"
            aria-label="QC threshold percent"
            style={{ width: "5rem", padding: "0.35rem" }}
          />
          %
        </label>
        <button type="submit" disabled={pending} style={{ padding: "0.35rem 0.8rem" }}>
          {pending ? "Creating…" : "Create study"}
        </button>
      </div>
      {result?.ok === true && (
        <span role="status" style={{ color: "#0a0" }}>
          Created. <Link href={`/studies/${result.id}`}>Open the study →</Link>
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
