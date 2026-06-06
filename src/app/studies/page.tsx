import Link from "next/link";
import { requireInternalPage } from "@/lib/identity/page-guards";
import { canReviewQuote } from "@/domains/authz/quotes";
import { listStudies } from "@/lib/studies/repository";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720, lineHeight: 1.5 } as const;

// The app shell's studies list (issue #24): the landing screen after login that
// leads an internal user to a study and its Import action. Internal staff see
// every tenant's studies (scope "all"), so each row shows the Client name to
// disambiguate same-named studies across tenants.
export default async function StudiesPage() {
  const principal = await requireInternalPage();
  const studies = await listStudies(principal);

  return (
    <main style={wrap}>
      {canReviewQuote(principal) && (
        <p style={{ marginTop: 0 }}>
          <Link href="/review">→ Review queue</Link>
        </p>
      )}
      <h1>Studies</h1>
      {studies.length === 0 ? (
        <p>No studies yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {studies.map((s) => (
            <li key={s.id} style={{ padding: "0.6rem 0", borderBottom: "1px solid #eee" }}>
              <Link href={`/studies/${s.id}`} style={{ fontWeight: 600 }}>
                {s.name}
              </Link>
              <span style={{ color: "#555" }}> — {s.clientName}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
