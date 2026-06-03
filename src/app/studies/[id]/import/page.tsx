import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireInternalPage } from "@/lib/identity/page-guards";
import { getStudyDetail } from "@/lib/studies/repository";
import { canImportBenchmarkItems } from "@/domains/authz/benchmark-items";
import { ImportForm } from "./ImportForm";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720, lineHeight: 1.5 } as const;

// The brief-upload screen (issue #24). Gated twice over: internal-only via the
// page guard, then to import-capable roles (EM + Analyst) — a Researcher/Admin
// who reaches this URL directly is bounced back to the study rather than shown a
// form whose action would only reject them. The study is resolved through the
// tenant-scoped read so an unknown id is a 404, not a broken form.
export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requireInternalPage();
  const { id } = await params;

  const study = await getStudyDetail(principal, id);
  if (study === null) notFound();
  if (!canImportBenchmarkItems(principal)) redirect(`/studies/${id}`);

  return (
    <main style={wrap}>
      <p style={{ marginBottom: "0.5rem" }}>
        <Link href={`/studies/${study.id}`}>← {study.name}</Link>
      </p>
      <h1>Import brief</h1>
      <p style={{ color: "#555" }}>
        Upload the Benchmark Item brief (.xlsx) for <strong>{study.name}</strong> ({study.clientName}).
        Re-importing updates matching items and adds new ones; it never deletes.
      </p>
      <ImportForm studyId={study.id} />
    </main>
  );
}
