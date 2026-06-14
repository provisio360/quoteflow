import Link from "next/link";
import type { Principal } from "@/domains/authz/principal";
import { countUnstaffedCountries } from "@/lib/assignments/repository";
import { ZeroState } from "./ZeroState";

// Engagement Manager home (#57). Putting Researchers onto Countries (Country
// Assignment) is the EM's exclusive job, so the home surfaces the one signal
// that drives that work: unstaffed countries — distinct (study, country) pairs
// that have Benchmark Items but no Country Assignment yet (the open setup
// backlog). The count is derived in the app layer via the assignments
// repository (ADR-0008), never an ad-hoc query in the page, and falls to the
// shared ZeroState convention at zero. The launchpad CTA goes to /studies.
export async function EngagementManagerHome({ principal }: { principal: Principal }) {
  const unstaffed = await countUnstaffedCountries(principal);

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Engagement Manager</h2>

      {unstaffed === 0 ? (
        <ZeroState message="No unstaffed countries — every country with items has researchers." />
      ) : (
        <p style={{ margin: "0.25rem 0" }}>{unstaffed} unstaffed countries</p>
      )}

      <p style={{ marginTop: "0.75rem" }}>
        <Link href="/studies" style={{ fontWeight: 600 }}>
          Set up studies →
        </Link>
      </p>
    </section>
  );
}
