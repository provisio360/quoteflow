"use client";

import { useActionState } from "react";
import { assignResearchersFormAction, type AssignResearchersResult } from "@/lib/assignments/actions";

type Researcher = { id: string; name: string };

// One Country's staffing row for the EM (issue #6). Shows who's already assigned
// and offers the unassigned active Researchers to add. Additive only — there is
// no un-assign in v1 (that is #25), matching the repository.
export function CountryAssignRow({
  studyId,
  country,
  assigned,
  available,
}: {
  studyId: string;
  country: string;
  assigned: Researcher[];
  available: Researcher[];
}) {
  const [result, formAction, pending] = useActionState<AssignResearchersResult | null, FormData>(
    assignResearchersFormAction,
    null,
  );

  return (
    <li style={{ padding: "0.6rem 0", borderTop: "1px solid #eee" }}>
      <strong>{country}</strong>
      <div style={{ color: "#555", margin: "0.2rem 0" }}>
        Assigned: {assigned.length === 0 ? "none yet" : assigned.map((a) => a.name).join(", ")}
      </div>

      {available.length === 0 ? (
        <span style={{ color: "#777" }}>All active researchers are assigned.</span>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="studyId" value={studyId} />
          <input type="hidden" name="country" value={country} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", margin: "0.3rem 0" }}>
            {available.map((r) => (
              <label key={r.id} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <input type="checkbox" name="researcherId" value={r.id} />
                {r.name}
              </label>
            ))}
          </div>
          <button type="submit" disabled={pending} style={{ padding: "0.3rem 0.7rem" }}>
            {pending ? "Assigning…" : "Assign"}
          </button>
        </form>
      )}

      {result?.ok === true && (
        <span role="status" style={{ color: "#0a0", marginLeft: "0.5rem" }}>
          Assigned ({result.assigned}).
        </span>
      )}
      {result?.ok === false && (
        <span role="alert" style={{ color: "#b00", marginLeft: "0.5rem" }}>
          {result.message}
        </span>
      )}
    </li>
  );
}
