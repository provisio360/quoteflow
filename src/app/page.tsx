import { getCurrentPrincipal } from "@/lib/identity/current-principal";
import { resolveHomeView } from "@/app/home/resolve";
import { AdminHome } from "@/app/home/AdminHome";
import { EngagementManagerHome } from "@/app/home/EngagementManagerHome";
import { ResearcherHome } from "@/app/home/ResearcherHome";
import { AnalystHome } from "@/app/home/AnalystHome";
import { ClientHome } from "@/app/home/ClientHome";

// The logged-in home is a thin per-role hybrid (#55): a launchpad plus a few
// derived signals, branched by principal category. This slice lays the shell;
// each category's signals land in their own follow-up slices. Identity, nav,
// notifications, and logout stay owned by the persistent NavHeader (ADR-0022) —
// the home never duplicates them.

const main = {
  fontFamily: "system-ui, sans-serif",
  padding: "2rem",
  lineHeight: 1.5,
} as const;

export default async function Home() {
  const principal = await getCurrentPrincipal();
  const view = resolveHomeView(principal);

  if (view === "logged-out") {
    return (
      <main style={main}>
        <h1>QuoteFlow</h1>
        <p>
          <a href="/login">Sign in</a> (invite-only — no public sign-up).
        </p>
      </main>
    );
  }

  return (
    <main style={main}>
      <h1>QuoteFlow</h1>
      {view === "admin" && <AdminHome />}
      {view === "engagement-manager" && <EngagementManagerHome />}
      {view === "researcher" && <ResearcherHome />}
      {view === "analyst" && <AnalystHome />}
      {view === "client" && principal?.kind === "client" && (
        <ClientHome principal={principal} />
      )}
    </main>
  );
}
