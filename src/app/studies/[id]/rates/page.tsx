import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireInternalPage } from "@/lib/identity/page-guards";
import { getStudyDetail } from "@/lib/studies/repository";
import { canManageStudyRates } from "@/domains/authz/exchange-rates";
import { listStudyRates } from "@/lib/exchange-rates/repository";
import { listStudyCountries } from "@/lib/benchmark-items/repository";
import { RatesForm } from "./RatesForm";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720, lineHeight: 1.5 } as const;
const cell = { border: "1px solid #ddd", padding: "0.35rem 0.6rem", textAlign: "left" } as const;

// The Study Exchange Rate setup screen (#160, ADR-0041): an EM/Analyst seeds
// manual local-currency→USD rates ahead of the FX provider. Gated twice over —
// internal-only via the page guard, then to the study-setup pair (EM + Analyst),
// so a Researcher/Admin reaching this URL is bounced to the study rather than
// shown a form whose action would only reject them. Entry is country-first; the
// study's own market countries are pre-suggested at the top of the picker.
export default async function RatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requireInternalPage();
  const { id } = await params;

  const study = await getStudyDetail(principal, id);
  if (study === null) notFound();
  if (!canManageStudyRates(principal)) redirect(`/studies/${id}`);

  const [rates, suggestedCountries] = await Promise.all([
    listStudyRates(principal, id),
    listStudyCountries(principal, id),
  ]);

  return (
    <main style={wrap}>
      <p style={{ marginBottom: "0.5rem" }}>
        <Link href={`/studies/${study.id}`}>← {study.name}</Link>
      </p>
      <h1>Exchange rates</h1>
      <p style={{ color: "#555" }}>
        Manual local-currency→USD rates for <strong>{study.name}</strong> ({study.clientName}). Pick a
        country to fill its currency, set the date the rate applies from and the rate. USD needs no row
        (it converts 1:1).
      </p>

      <RatesForm studyId={study.id} suggestedCountries={suggestedCountries} />

      <h2 style={{ marginTop: "2rem", fontSize: "1.1rem" }}>Saved rates</h2>
      {rates.length === 0 ? (
        <p style={{ color: "#777" }}>No rates yet.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", marginTop: "0.75rem", width: "100%" }}>
          <thead>
            <tr>
              <th style={cell}>Currency</th>
              <th style={cell}>Date</th>
              <th style={cell}>Rate (→ USD)</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td style={cell}>{r.currency}</td>
                <td style={cell}>{r.rateDate}</td>
                <td style={cell}>{r.rate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
