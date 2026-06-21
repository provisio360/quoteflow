import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDashboardPage } from "@/lib/identity/page-guards";
import { getStudyDetail } from "@/lib/studies/repository";
import { getStudyDashboard } from "@/lib/analytics/repository";
import type { PriceRange } from "@/domains/analytics/price-range";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 860, lineHeight: 1.5 } as const;
const th = { textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "2px solid #ddd" } as const;
const td = { padding: "0.4rem 0.6rem", borderBottom: "1px solid #eee" } as const;
const numTd = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

// The client dashboards (issue #14): View A — the Competitor Price Range
// (min/median/max USD per unit) per released Benchmark Item — and View B, the
// same range broken down by Competitor. Reachable by the tenant's Client Users
// and by internal staff; the read is tenant-scoped (ADR-0008) and carries NO
// Client Price (ADR-0003) — that is the internal View D, never shown here.
export default async function StudyDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requireDashboardPage();
  const { id } = await params;
  // Visibility gate: an out-of-tenant or unknown study is not-found, never a leak.
  const study = await getStudyDetail(principal, id);
  if (study === null) notFound();

  const items = await getStudyDashboard(principal, study.id);

  return (
    <main style={wrap}>
      <h1>{study.name}</h1>
      <p style={{ color: "#555" }}>Released competitive pricing (USD per unit).</p>

      {/* Exports (issue #15): the client Excel of released data (no Client Price);
          internal staff also get the full audited export of all non-Draft quotes. */}
      <p style={{ margin: "0.5rem 0 0", display: "flex", gap: "1rem" }}>
        <a href={`/api/studies/${study.id}/export?type=client`}>⬇ Export released data (Excel)</a>
        {principal.kind === "internal" && (
          <a href={`/api/studies/${study.id}/export?type=internal`}>⬇ Full export (internal)</a>
        )}
      </p>

      {items.length === 0 ? (
        <p>No released results yet.</p>
      ) : (
        items.map((item) => (
          <section key={`${item.clientItemNumber} ${item.country}`} style={{ marginTop: "2rem" }}>
            <h2 style={{ marginBottom: "0.25rem" }}>
              {item.itemDescription}{" "}
              <span style={{ color: "#777", fontWeight: 400, fontSize: "0.9em" }}>
                ({item.clientItemNumber} · {item.country})
              </span>
            </h2>

            {/* View A — overall competitor price range. */}
            <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: "1rem" }}>
              <thead>
                <tr>
                  <th style={th}>Competitor price range</th>
                  <th style={{ ...th, textAlign: "right" }}>Min</th>
                  <th style={{ ...th, textAlign: "right" }}>Median</th>
                  <th style={{ ...th, textAlign: "right" }}>Max</th>
                  <th style={{ ...th, textAlign: "right" }}>Quotes</th>
                </tr>
              </thead>
              <tbody>
                <RangeRow label="All competitors" range={item.range} />
              </tbody>
            </table>

            {/* View B — broken down by competitor. */}
            <h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem", color: "#444" }}>By competitor</h3>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Competitor</th>
                  <th style={{ ...th, textAlign: "right" }}>Min</th>
                  <th style={{ ...th, textAlign: "right" }}>Median</th>
                  <th style={{ ...th, textAlign: "right" }}>Max</th>
                  <th style={{ ...th, textAlign: "right" }}>Quotes</th>
                </tr>
              </thead>
              <tbody>
                {item.byCompetitor.length === 0 ? (
                  <tr>
                    <td style={{ ...td, color: "#999" }} colSpan={5}>
                      No competitive data
                    </td>
                  </tr>
                ) : (
                  item.byCompetitor.map((c) => (
                    <RangeRow key={c.competitor} label={c.competitor} range={c.range} />
                  ))
                )}
              </tbody>
            </table>
          </section>
        ))
      )}

      {principal.kind === "internal" && (
        <p style={{ marginTop: "2rem" }}>
          <Link href={`/studies/${study.id}`}>← Back to study (internal)</Link>
        </p>
      )}
    </main>
  );
}

/** One range as a row: min / median / max / count, or a no-data placeholder. */
function RangeRow({ label, range }: { label: string; range: PriceRange }) {
  if (!range.hasData) {
    return (
      <tr>
        <td style={td}>{label}</td>
        <td style={{ ...td, color: "#999" }} colSpan={4}>
          No competitive data
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td style={td}>{label}</td>
      <td style={numTd}>{usd(range.min)}</td>
      <td style={numTd}>{usd(range.median)}</td>
      <td style={numTd}>{usd(range.max)}</td>
      <td style={numTd}>{range.count}</td>
    </tr>
  );
}

/** USD per unit, trimmed to a sensible display precision (data is Decimal(14,4)). */
function usd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  });
}
