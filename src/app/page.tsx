import Link from "next/link";
import { getCurrentPrincipal } from "@/lib/identity/current-principal";
import { logoutAction } from "@/lib/identity/actions";
import { listStudies } from "@/lib/studies/repository";

export default async function Home() {
  const principal = await getCurrentPrincipal();
  // A Client User's own studies (tenant-scoped) — their entry to the dashboards.
  const clientStudies =
    principal?.kind === "client" ? await listStudies(principal) : [];

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", lineHeight: 1.5 }}>
      <h1>QuoteFlow</h1>
      <p>Walking skeleton is alive. Real screens arrive with the build slices.</p>

      {principal ? (
        <section>
          <p>
            Signed in as <strong>{principal.userId}</strong> —{" "}
            {principal.kind === "internal"
              ? `internal staff (${principal.role})`
              : `client user (tenant ${principal.tenantId})`}
            .
          </p>
          {principal.kind === "internal" && (
            <p>
              <a href="/studies">Studies</a> — pick a study to import a brief.
            </p>
          )}
          {principal.kind === "client" && (
            <div>
              <p style={{ marginBottom: "0.25rem" }}>Your dashboards:</p>
              {clientStudies.length === 0 ? (
                <p style={{ color: "#777" }}>No studies yet.</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0 }}>
                  {clientStudies.map((s) => (
                    <li key={s.id} style={{ padding: "0.3rem 0" }}>
                      <Link href={`/studies/${s.id}/dashboard`} style={{ fontWeight: 600 }}>
                        {s.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <form action={logoutAction}>
            <button type="submit" style={{ padding: "0.4rem 0.9rem" }}>
              Sign out
            </button>
          </form>
        </section>
      ) : (
        <p>
          Not signed in. <a href="/login">Sign in</a> (invite-only — no public sign-up).
        </p>
      )}

      <p style={{ marginTop: "1.5rem" }}>
        Health check: <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
