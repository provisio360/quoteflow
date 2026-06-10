"use client";

import { useActionState } from "react";
import {
  releaseCountryAction,
  reopenCountryAction,
  type ReleaseActionResult,
  type ReopenActionResult,
} from "@/lib/release/actions";
import type { ReleaseEligibility } from "@/domains/release/eligibility";

// One Country's release control for the Analyst (#13). The Release button mirrors
// the server gate — disabled when not releasable — but the repository re-checks
// atomically, so the disable is a courtesy, not the enforcement. Reopen appears
// only on a currently-released Country (a pure visibility lever, ADR-0016).
export function CountryReleaseRow({
  studyId,
  country,
  eligibility,
  releaseState,
}: {
  studyId: string;
  country: string;
  eligibility: ReleaseEligibility;
  releaseState: "released" | "reopened" | null;
}) {
  const [rel, releaseAction, relPending] = useActionState<ReleaseActionResult | null, FormData>(
    releaseCountryAction,
    null,
  );
  const [reo, reopenAction, reoPending] = useActionState<ReopenActionResult | null, FormData>(
    reopenCountryAction,
    null,
  );

  const released = releaseState === "released";
  const stateLabel = released ? "Released" : releaseState === "reopened" ? "Reopened" : "Not released";

  return (
    <li style={{ padding: "0.5rem 0", borderTop: "1px solid #eee" }}>
      <strong>{country}</strong>{" "}
      <span style={{ color: released ? "#0a0" : "#777" }}>— {stateLabel}</span>

      {!released && (
        <form action={releaseAction} style={{ display: "inline", marginLeft: "0.5rem" }}>
          <input type="hidden" name="studyId" value={studyId} />
          <input type="hidden" name="country" value={country} />
          <button
            type="submit"
            disabled={relPending || !eligibility.releasable}
            title={eligibility.releasable ? "Release to the client" : "Not releasable yet"}
            style={{ padding: "0.2rem 0.6rem" }}
          >
            Release
          </button>
        </form>
      )}

      {released && (
        <form action={reopenAction} style={{ display: "inline", marginLeft: "0.5rem" }}>
          <input type="hidden" name="studyId" value={studyId} />
          <input type="hidden" name="country" value={country} />
          <button type="submit" disabled={reoPending} style={{ padding: "0.2rem 0.6rem" }}>
            Reopen
          </button>
        </form>
      )}

      {!eligibility.releasable && (
        <span style={{ color: "#b80", marginLeft: "0.5rem", fontSize: "0.85rem" }}>
          {eligibility.reasons.shortItems} item(s) short of required quotes,{" "}
          {eligibility.reasons.inFlightItems} still in-flight.
        </span>
      )}

      {rel?.ok === true && !rel.eligibility.releasable && (
        <span role="alert" style={{ color: "#b00", marginLeft: "0.5rem" }}>
          No longer releasable — nothing was released.
        </span>
      )}
      {rel?.ok === false && (
        <span role="alert" style={{ color: "#b00", marginLeft: "0.5rem" }}>
          {rel.message}
        </span>
      )}
      {reo?.ok === false && (
        <span role="alert" style={{ color: "#b00", marginLeft: "0.5rem" }}>
          {reo.message}
        </span>
      )}
    </li>
  );
}
