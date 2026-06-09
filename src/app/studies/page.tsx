import Link from "next/link";
import { requireInternalPage } from "@/lib/identity/page-guards";
import { canReviewQuote } from "@/domains/authz/quotes";
import { canCreateStudy } from "@/domains/authz/studies";
import { listStudies } from "@/lib/studies/repository";
import { listClients } from "@/lib/clients/repository";
import { NotificationsLink } from "@/app/notifications/NotificationsLink";
import { NewStudyForm } from "./NewStudyForm";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720, lineHeight: 1.5 } as const;

// The app shell's studies list (issue #24): the landing screen after login that
// leads an internal user to a study and its Import action. Internal staff see
// every tenant's studies (scope "all"), so each row shows the Client name to
// disambiguate same-named studies across tenants.
export default async function StudiesPage() {
  const principal = await requireInternalPage();
  const studies = await listStudies(principal);
  const mayCreate = canCreateStudy(principal);
  const clients = mayCreate ? await listClients(principal) : [];

  return (
    <main style={wrap}>
      <p style={{ marginTop: 0, display: "flex", gap: "1rem" }}>
        {canReviewQuote(principal) && <Link href="/review">→ Review queue</Link>}
        <NotificationsLink />
      </p>
      <h1>Studies</h1>
      {mayCreate && <NewStudyForm clients={clients} />}
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
