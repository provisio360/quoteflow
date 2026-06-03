import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternalPage } from "@/lib/identity/page-guards";
import { getStudyDetail } from "@/lib/studies/repository";
import { canImportBenchmarkItems } from "@/domains/authz/benchmark-items";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720, lineHeight: 1.5 } as const;

// The app shell's study-detail screen (issue #24): a minimal overview that
// confirms which study you are on and hosts the brief-import entry point. The
// Import link is shown only to the roles that may import (EM + Analyst); other
// internal staff see the study but no import affordance. Item/quote listing is a
// later slice — this screen exists to reach Import.
export default async function StudyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requireInternalPage();
  const { id } = await params;
  const study = await getStudyDetail(principal, id);
  if (study === null) notFound();

  const mayImport = canImportBenchmarkItems(principal);

  return (
    <main style={wrap}>
      <p style={{ marginBottom: "0.5rem" }}>
        <Link href="/studies">← Studies</Link>
      </p>
      <h1>{study.name}</h1>
      <p style={{ color: "#555" }}>
        Client: <strong>{study.clientName}</strong>
        <br />
        Created: {study.createdAt.toLocaleDateString()}
      </p>

      {mayImport && (
        <p style={{ marginTop: "1.5rem" }}>
          <Link href={`/studies/${study.id}/import`} style={{ fontWeight: 600 }}>
            Import brief →
          </Link>
        </p>
      )}
    </main>
  );
}
