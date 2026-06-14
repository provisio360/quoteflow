import Link from "next/link";
import type { ClientPrincipal } from "@/domains/authz/principal";
import { listStudiesWithReleasedCounts } from "@/lib/studies/repository";
import { ZeroState } from "./ZeroState";

// Client User home (#55, enriched #60). Unlike the internal sections, this keeps
// its dashboard list: it is the Client User's only route to their dashboards
// (the NavHeader carries no Studies link for clients), so it is core navigation,
// not a deferrable derived signal. Each study row now carries its currently-
// Released Country count (#60) — Client Users only ever see released data
// (ADR-0002), so the count tells them where there is data to look at. Two
// zero-states, both via the shared ZeroState convention: the list (no studies)
// and each row (a study with nothing released to them yet).
export async function ClientHome({ principal }: { principal: ClientPrincipal }) {
  const studies = await listStudiesWithReleasedCounts(principal);

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
              {s.releasedCountryCount === 0 ? (
                <ZeroState message="No countries released yet — nothing released to you here yet." />
              ) : (
                <span style={{ color: "#555", marginLeft: "0.5rem" }}>
                  — {s.releasedCountryCount}{" "}
                  {s.releasedCountryCount === 1 ? "country" : "countries"} released
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
