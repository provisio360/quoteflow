"use client";

import { useActionState, useState } from "react";
import { importBenchmarkItemsFormAction } from "@/lib/benchmark-items/actions";
import { uploadProblem } from "@/lib/benchmark-items/upload-validation";
import type { ImportOutcome } from "@/lib/benchmark-items/repository";

// The brief-upload form (issue #24). A client component because the action
// *returns* its outcome (insert/update counts or a per-row error report) for the
// same screen to render — `useActionState` holds that across the POST. The
// pre-submit guard reuses the very same `uploadProblem` rule the server action
// applies, so a rejected file reads identically whichever side catches it.

const field = { display: "block", marginTop: "1rem" } as const;
const cell = { border: "1px solid #ddd", padding: "0.35rem 0.6rem", textAlign: "left" } as const;

export function ImportForm({ studyId }: { studyId: string }) {
  const [outcome, formAction, pending] = useActionState<ImportOutcome | null, FormData>(
    importBenchmarkItemsFormAction,
    null,
  );
  // Client-side rejection (non-.xlsx / no file), surfaced before the POST.
  const [clientError, setClientError] = useState<string | null>(null);

  function guardSubmit(event: React.FormEvent<HTMLFormElement>) {
    const input = event.currentTarget.elements.namedItem("file");
    const file = input instanceof HTMLInputElement ? input.files?.[0] ?? null : null;
    const problem = uploadProblem(file && { name: file.name, size: file.size });
    if (problem !== null) {
      event.preventDefault();
      setClientError(problem);
    } else {
      setClientError(null);
    }
  }

  return (
    <>
      <form action={formAction} onSubmit={guardSubmit} style={{ marginTop: "1.5rem" }}>
        <input type="hidden" name="studyId" value={studyId} />
        <label style={field}>
          Brief spreadsheet (.xlsx)
          <input
            type="file"
            name="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: "block", marginTop: "0.25rem" }}
          />
        </label>
        <button type="submit" disabled={pending} style={{ marginTop: "1.25rem", padding: "0.5rem 1rem" }}>
          {pending ? "Importing…" : "Import"}
        </button>
      </form>

      {clientError !== null && (
        <p role="alert" style={{ color: "#b00", marginTop: "1rem" }}>
          {clientError}
        </p>
      )}

      {outcome?.ok === true && (
        <p role="status" style={{ color: "#0a0", marginTop: "1.5rem" }}>
          Import complete — inserted {outcome.inserted}, updated {outcome.updated}.
        </p>
      )}

      {outcome?.ok === false && (
        <section style={{ marginTop: "1.5rem" }}>
          <p role="alert" style={{ color: "#b00" }}>
            Import failed — nothing was saved. Fix the spreadsheet and try again.
          </p>
          <table style={{ borderCollapse: "collapse", marginTop: "0.75rem", width: "100%" }}>
            <thead>
              <tr>
                <th style={cell}>Row</th>
                <th style={cell}>Field</th>
                <th style={cell}>Problem</th>
              </tr>
            </thead>
            <tbody>
              {outcome.errors.map((e, i) => (
                <tr key={i}>
                  <td style={cell}>{e.row ?? "—"}</td>
                  <td style={cell}>{e.field ?? "—"}</td>
                  <td style={cell}>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
