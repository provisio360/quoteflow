import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireInternalPage } from "@/lib/identity/page-guards";
import { canViewClientPrice } from "@/domains/authz/benchmark-items";
import { getStudyDetail } from "@/lib/studies/repository";
import { listAuditEventsForStudy } from "@/lib/audit/repository";
import { auditActionLabel } from "@/domains/audit/events";
import { formatMoney, NO_AMOUNT } from "@/domains/quotes/format-money";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 960, lineHeight: 1.5 } as const;
const th = { textAlign: "left", padding: "0.4rem 0.75rem", borderBottom: "2px solid #ccc", fontSize: "0.85rem", color: "#555" } as const;
const td = { padding: "0.4rem 0.75rem", borderBottom: "1px solid #eee", fontSize: "0.9rem", verticalAlign: "top" } as const;

/** A before→after monetary pair for display; "—" stands in for an unset side
 *  (the audited pair is always USD — Client Price / converted document total). */
function pair(before: number | null, after: number | null): string {
  if (before === null && after === null) return "";
  return `${before === null ? NO_AMOUNT : formatMoney(before, "USD")} → ${after === null ? NO_AMOUNT : formatMoney(after, "USD")}`;
}

// The internal audit-log view (issue #72 / ADR-0024): a read-only, per-study
// window over the Audit Event stream ADR-0019 shipped write-only. Gated to
// Client-Price viewers (Analyst + EM) because clientPriceChange events carry the
// value (ADR-0003) — defence in depth behind the read repository's own gate. A
// Researcher or client user is bounced to /login, never shown the page (TC040).
export default async function StudyAuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requireInternalPage();
  if (!canViewClientPrice(principal)) redirect("/login");

  const { id } = await params;
  const study = await getStudyDetail(principal, id);
  if (study === null) notFound();

  const events = await listAuditEventsForStudy(principal, study.id);

  return (
    <main style={wrap}>
      <p style={{ marginBottom: "0.5rem" }}>
        <Link href={`/studies/${study.id}`}>← {study.name}</Link>
      </p>
      <h1>Audit log</h1>
      <p style={{ color: "#777" }}>
        Internal-only change history for <strong>{study.name}</strong>, newest first.
      </p>

      {events.length === 0 ? (
        <p style={{ color: "#777", marginTop: "1.5rem" }}>No audit events recorded yet.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%", marginTop: "1rem" }}>
          <thead>
            <tr>
              <th style={th}>When</th>
              <th style={th}>Actor</th>
              <th style={th}>Action</th>
              <th style={th}>Subject</th>
              <th style={th}>Before → After</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td style={td}>{e.createdAt.toLocaleString()}</td>
                <td style={td}>{e.actorName}</td>
                <td style={td}>{auditActionLabel(e.action)}</td>
                <td style={td}>{e.subjectLabel}</td>
                <td style={td}>{pair(e.beforeValue, e.afterValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
