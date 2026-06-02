import { getCurrentPrincipal } from "@/lib/identity/current-principal";
import { logoutAction } from "@/lib/identity/actions";

export default async function Home() {
  const principal = await getCurrentPrincipal();

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
