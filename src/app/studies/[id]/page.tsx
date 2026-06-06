import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternalPage } from "@/lib/identity/page-guards";
import { getStudyDetail } from "@/lib/studies/repository";
import {
  canImportBenchmarkItems,
  canMaintainClientPrice,
} from "@/domains/authz/benchmark-items";
import { listBenchmarkItemsForAnalyst } from "@/lib/benchmark-items/repository";
import { ClientPriceList } from "./ClientPriceList";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720, lineHeight: 1.5 } as const;

// The app shell's study-detail screen (issue #24): a minimal overview that
// confirms which study you are on and hosts the brief-import entry point. The
// Import link is shown only to the roles that may import (EM + Analyst); other
// internal staff see the study but no import affordance. Analysts additionally
// get the Client Price QC list (#12) — gated here so a researcher reaching this
// same page never receives the Client Price at all (ADR-0003).
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
  // Analyst-only: fetch the Client-Price-bearing list ONLY for analysts, so the
  // value never crosses the server boundary for anyone else (ADR-0003).
  const qcItems = canMaintainClientPrice(principal)
    ? await listBenchmarkItemsForAnalyst(principal, study.id)
    : null;

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

      {qcItems !== null && <ClientPriceList studyId={study.id} items={qcItems} />}
    </main>
  );
}
