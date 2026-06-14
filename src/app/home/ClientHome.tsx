import Link from "next/link";
import type { ClientPrincipal } from "@/domains/authz/principal";
import { listStudies } from "@/lib/studies/repository";
import { ZeroState } from "./ZeroState";

// Client User home (#55). Unlike the internal sections, this keeps its dashboard
// list now: it is the Client User's only route to their dashboards (the
// NavHeader carries no Studies link for clients), so it is core navigation, not
// a deferrable derived signal. The empty case is the first consumer of the
// shared ZeroState convention.
export async function ClientHome({ principal }: { principal: ClientPrincipal }) {
  const studies = await listStudies(principal);

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Your dashboards</h2>
      {studies.length === 0 ? (
        <ZeroState message="No studies yet — your dashboards appear here once a study is released to you." />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {studies.map((s) => (
            <li key={s.id} style={{ padding: "0.3rem 0" }}>
              <Link href={`/studies/${s.id}/dashboard`} style={{ fontWeight: 600 }}>
                {s.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
