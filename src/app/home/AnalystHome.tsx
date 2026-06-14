import Link from "next/link";
import type { Principal } from "@/domains/authz/principal";
import { countReviewQueue } from "@/lib/quotes/repository";
import { countReleasableCountries } from "@/lib/release/repository";
import { ZeroState } from "./ZeroState";

// Analyst home (#58). The analyst works the review queue, then releases
// countries — so the home surfaces those two signals. (1) Review-queue depth:
// how many Quotes sit Submitted (the FIFO backlog), a cheap DB count. (2)
// Releasable countries: the actionable release backlog — countries currently
// Release-Eligible but not yet released — derived through the eligibility core
// (src/domains/release via the repository), the pricier of the two. Each count
// comes from the app-layer repository (ADR-0008), never an ad-hoc query here,
// and falls to the shared ZeroState convention at zero. Two launchpad CTAs, one
// per signal: /review for the queue, /studies for the release work.
export async function AnalystHome({ principal }: { principal: Principal }) {
  const [reviewQueue, releasable] = await Promise.all([
    countReviewQueue(principal),
    countReleasableCountries(principal),
  ]);

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Analyst</h2>

      {reviewQueue === 0 ? (
        <ZeroState message="No quotes awaiting review — the queue is clear." />
      ) : (
        <p style={{ margin: "0.25rem 0" }}>{reviewQueue} quotes awaiting review</p>
      )}

      {releasable === 0 ? (
        <ZeroState message="No countries ready to release." />
      ) : (
        <p style={{ margin: "0.25rem 0" }}>{releasable} countries ready to release</p>
      )}

      <p style={{ marginTop: "0.75rem" }}>
        <Link href="/review" style={{ fontWeight: 600 }}>
          Review quotes →
        </Link>
      </p>
      <p style={{ margin: "0.25rem 0" }}>
        <Link href="/studies" style={{ fontWeight: 600 }}>
          Release countries →
        </Link>
      </p>
    </section>
  );
}
