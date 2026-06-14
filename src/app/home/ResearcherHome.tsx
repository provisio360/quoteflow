import Link from "next/link";
import type { Principal } from "@/domains/authz/principal";
import { countMyRejectedQuotes, countMyDrafts } from "@/lib/quotes/repository";
import { countMyAssignedCountries } from "@/lib/assignments/repository";
import { ZeroState } from "./ZeroState";

// Researcher home (#59). The researcher collects quotes, so the home surfaces
// their own work: (1) Rejected quotes to fix — own Quotes in Rejected state
// (createdById = me), the most actionable signal and notification-backed
// (CONTEXT.md: Notification); (2) Drafts in progress — own Quotes still in Draft
// (private to their author, ADR-0011); (3) Assigned countries — an orientation
// line, not a CTA: how many (study, country) pairs the researcher is on (a bare
// count of Country Assignments, ADR-0016). All three are self-scoped, derived
// through the app-layer repository (ADR-0008), and fall to the shared ZeroState
// convention at zero. One launchpad CTA to /studies, the researcher's work.
export async function ResearcherHome({ principal }: { principal: Principal }) {
  const [rejected, drafts, assignedCountries] = await Promise.all([
    countMyRejectedQuotes(principal),
    countMyDrafts(principal),
    countMyAssignedCountries(principal),
  ]);

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Researcher</h2>

      {rejected === 0 ? (
        <ZeroState message="No rejected quotes to fix — nothing sent back to you." />
      ) : (
        <p style={{ margin: "0.25rem 0" }}>{rejected} rejected quotes to fix</p>
      )}

      {drafts === 0 ? (
        <ZeroState message="No drafts in progress." />
      ) : (
        <p style={{ margin: "0.25rem 0" }}>{drafts} drafts in progress</p>
      )}

      {assignedCountries === 0 ? (
        <ZeroState message="You're not assigned to any countries yet." />
      ) : (
        <p style={{ margin: "0.25rem 0" }}>
          Assigned to {assignedCountries} countries
        </p>
      )}

      <p style={{ marginTop: "0.75rem" }}>
        <Link href="/studies" style={{ fontWeight: 600 }}>
          Go to your work →
        </Link>
      </p>
    </section>
  );
}
