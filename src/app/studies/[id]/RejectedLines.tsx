import Link from "next/link";
import type { RejectedLineView } from "@/lib/quotes/repository";

// The researcher's "Needs attention" surface (#139 / ADR-0038): a worklist of the
// researcher's own currently-Rejected Quote Lines, each deep-linking to the line to
// revise it — the SAME destination as the rejection Notification (`#line-<n>`, the
// anchor ResearcherItem renders). Read-only, so a plain server component (ADR-0022).
// Revising a line returns it to Draft, dropping it from here and into the Drafts
// surface above. No Client Price is ever present (the list carries no flag, ADR-0003).

export function RejectedLines({ lines }: { lines: readonly RejectedLineView[] }) {
  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.1rem" }}>Needs attention</h2>
      {lines.length === 0 ? (
        <p style={{ color: "#555" }}>Nothing needs your attention.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {lines.map((l) => (
            <li
              key={l.lineId}
              style={{
                padding: "0.7rem 0.9rem",
                marginBottom: "0.5rem",
                borderRadius: 6,
                border: "1px solid #eee",
              }}
            >
              <div style={{ fontWeight: 600 }}>{l.itemLabel}</div>
              <div style={{ color: "#555" }}>
                {l.country} · market quote {l.marketQuoteNumber}, line {l.quoteLineNumber}
              </div>
              {l.reason && <div style={{ color: "#555" }}>Reason: {l.reason}</div>}
              <div style={{ color: "#555" }}>
                <Link href={`/studies/${l.studyId}#line-${l.quoteLineNumber}`}>
                  Revise and resubmit →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
