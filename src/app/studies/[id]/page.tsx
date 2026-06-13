import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternalPage } from "@/lib/identity/page-guards";
import { getStudyDetail } from "@/lib/studies/repository";
import {
  canImportBenchmarkItems,
  canMaintainClientPrice,
  canSelfAssignBenchmarkItem,
} from "@/domains/authz/benchmark-items";
import { canAssignResearchers } from "@/domains/authz/assignments";
import {
  listBenchmarkItemsForAnalyst,
  listBenchmarkItemsForResearcher,
  listStudyCountries,
} from "@/lib/benchmark-items/repository";
import {
  listActiveResearchers,
  listAssignmentsForResearcher,
  listAssignmentsForStudy,
} from "@/lib/assignments/repository";
import { listQuotesForItem, type QuoteView } from "@/lib/quotes/repository";
import { getStudyBenchmarkComparison } from "@/lib/analytics/repository";
import { canReleaseCountry } from "@/domains/authz/release";
import { listCountryReleaseStatus } from "@/lib/release/repository";
import { ClientPriceList } from "./ClientPriceList";
import { BenchmarkComparison } from "./BenchmarkComparison";
import { CountryAssignRow } from "./CountryAssignRow";
import { ResearcherItem } from "./ResearcherItem";
import {
  resolveResearcherEntries,
  type GuidanceFields,
  type ItemMode,
} from "@/domains/benchmark-items/researcher-view";
import { CountryReleaseRow } from "./CountryReleaseRow";

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
  // View D (issue #14): the released competitor ranges set beside Client Price.
  // Internal-only — every viewer of this page is internal staff (the guard), and
  // the Client Price it carries is never exposed on the client dashboard.
  // View D carries Client Price → Analyst-only (ADR-0003), same gate as the QC list.
  const benchmark = canMaintainClientPrice(principal)
    ? await getStudyBenchmarkComparison(principal, study.id)
    : null;

  // EM-only staffing view (#6): each Country with who's assigned and which active
  // researchers remain to add. Derived from the study's Benchmark Items, so a
  // Country with no items never appears.
  const mayAssign = canAssignResearchers(principal);
  const staffing = mayAssign ? await buildStaffing(principal, study.id) : [];

  // Researcher work surface (#7/#8): the study's items grouped by Country, with a
  // per-item mode (mine / claimable / claimed / locked). Client Price never loaded.
  const mayResearch = canSelfAssignBenchmarkItem(principal);
  const research = mayResearch ? await buildResearcherView(principal, study.id) : [];

  // Analyst release gate (#13): each Country's eligibility + current release state.
  const mayRelease = canReleaseCountry(principal);
  const releaseStatus = mayRelease ? await listCountryReleaseStatus(principal, study.id) : [];

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

      <p style={{ marginTop: "1.5rem" }}>
        <Link href={`/studies/${study.id}/dashboard`} style={{ fontWeight: 600 }}>
          View client dashboard →
        </Link>{" "}
        <span style={{ color: "#777" }}>(released results, as the client sees them)</span>
      </p>

      {mayAssign && (
        <section style={{ marginTop: "2rem" }}>
          <h2 style={{ fontSize: "1.1rem" }}>Researcher assignment</h2>
          {staffing.length === 0 ? (
            <p style={{ color: "#777" }}>Import a brief first — Countries come from its items.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {staffing.map((s) => (
                <CountryAssignRow
                  key={s.country}
                  studyId={study.id}
                  country={s.country}
                  assigned={s.assigned}
                  available={s.available}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {mayResearch && (
        <section style={{ marginTop: "2rem" }}>
          <h2 style={{ fontSize: "1.1rem" }}>Your quote collection</h2>
          {research.length === 0 ? (
            <p style={{ color: "#777" }}>No Benchmark Items yet.</p>
          ) : (
            research.map((group) => (
              <div key={group.country} style={{ marginTop: "1rem" }}>
                <h3 style={{ fontSize: "1rem", margin: "0 0 0.25rem" }}>{group.country}</h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {group.items.map((entry) => (
                    <ResearcherItem
                      key={entry.item.id}
                      item={entry.item}
                      mode={entry.mode}
                      quotes={entry.quotes}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}

      {mayRelease && (
        <section style={{ marginTop: "2rem" }}>
          <h2 style={{ fontSize: "1.1rem" }}>Release to client</h2>
          {releaseStatus.length === 0 ? (
            <p style={{ color: "#777" }}>No Countries yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {releaseStatus.map((s) => (
                <CountryReleaseRow
                  key={s.country}
                  studyId={study.id}
                  country={s.country}
                  eligibility={s.eligibility}
                  releaseState={s.releaseState}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {qcItems !== null && <ClientPriceList studyId={study.id} items={qcItems} />}

      {benchmark !== null && <BenchmarkComparison items={benchmark} />}
    </main>
  );
}

type StaffedCountry = {
  country: string;
  assigned: { id: string; name: string }[];
  available: { id: string; name: string }[];
};

/** Per-Country: who is assigned, and which active researchers remain to add. */
async function buildStaffing(
  principal: Parameters<typeof listStudyCountries>[0],
  studyId: string,
): Promise<StaffedCountry[]> {
  const [countries, assignments, researchers] = await Promise.all([
    listStudyCountries(principal, studyId),
    listAssignmentsForStudy(principal, studyId),
    listActiveResearchers(principal),
  ]);
  const nameById = new Map(researchers.map((r) => [r.id, r.name]));

  const idsByCountry = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = idsByCountry.get(a.country) ?? new Set<string>();
    set.add(a.researcherId);
    idsByCountry.set(a.country, set);
  }

  return countries.map((country) => {
    const assignedIds = idsByCountry.get(country) ?? new Set<string>();
    return {
      country,
      assigned: [...assignedIds].map((id) => ({ id, name: nameById.get(id) ?? id })),
      available: researchers.filter((r) => !assignedIds.has(r.id)),
    };
  });
}

type ResearcherItemEntry = {
  item: GuidanceFields;
  mode: ItemMode;
  quotes: QuoteView[];
};
type ResearcherGroup = { country: string; items: ResearcherItemEntry[] };

/** The researcher's per-Country items with their work mode and (for owned items)
 *  their quotes. Mode resolution + guidance threading is the pure
 *  `resolveResearcherEntries`; this layer adds the IO: loading the items and
 *  assignments, then attaching quotes for the items that are mine. */
async function buildResearcherView(
  principal: Parameters<typeof listBenchmarkItemsForResearcher>[0] & { userId: string },
  studyId: string,
): Promise<ResearcherGroup[]> {
  const [items, assignments] = await Promise.all([
    listBenchmarkItemsForResearcher(principal, studyId),
    listAssignmentsForResearcher(principal),
  ]);
  const myCountries = new Set(
    assignments.filter((a) => a.studyId === studyId).map((a) => a.country),
  );

  const entries: ResearcherItemEntry[] = await Promise.all(
    resolveResearcherEntries(items, myCountries, principal.userId).map(async (e) => ({
      ...e,
      quotes: e.mode === "mine" ? await listQuotesForItem(principal, e.item.id) : [],
    })),
  );

  const byCountry = new Map<string, ResearcherItemEntry[]>();
  for (const e of entries) {
    const list = byCountry.get(e.item.country) ?? [];
    list.push(e);
    byCountry.set(e.item.country, list);
  }
  return [...byCountry.entries()].map(([country, list]) => ({ country, items: list }));
}
