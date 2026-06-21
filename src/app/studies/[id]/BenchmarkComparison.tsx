import type { ItemBenchmark } from "@/lib/analytics/repository";

// The internal benchmark comparison — View D (issue #14 / ADR-0017). Rendered
// only on the internal study page (every viewer there is internal staff), it
// sets each released item's Competitor Price Range beside its Client Price so an
// analyst can see where the client's benchmark sits against the observed spread.
// Client-Price-bearing — NEVER part of the client dashboard (ADR-0003). An item
// with no data or no Client Price is shown as "not comparable" (mirrors the
// Price Flag, ADR-0015), rather than implying a false zero.

const cell = { border: "1px solid #ddd", padding: "0.35rem 0.6rem", textAlign: "left" } as const;
const num = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

export function BenchmarkComparison({ items }: { items: ItemBenchmark[] }) {
  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 style={{ fontSize: "1.1rem" }}>Benchmark vs released range (View D) — internal only</h2>
      <p style={{ color: "#555", fontSize: "0.9rem" }}>
        Released competitive range against the Client Price. Carries the Client Price — never shown
        to clients.
      </p>
      {items.length === 0 ? (
        <p style={{ color: "#777" }}>No released results yet.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", marginTop: "0.75rem", width: "100%" }}>
          <thead>
            <tr>
              <th style={cell}>Country</th>
              <th style={cell}>Client Part No.</th>
              <th style={num}>Min</th>
              <th style={num}>Median</th>
              <th style={num}>Max</th>
              <th style={num}>Client Price</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.clientItemNumber} ${item.country}`}>
                <td style={cell}>{item.country}</td>
                <td style={cell}>{item.clientItemNumber}</td>
                {item.range.hasData ? (
                  <>
                    <td style={num}>{usd(item.range.min)}</td>
                    <td style={num}>{usd(item.range.median)}</td>
                    <td style={num}>{usd(item.range.max)}</td>
                  </>
                ) : (
                  <td style={{ ...cell, color: "#999" }} colSpan={3}>
                    No competitive data
                  </td>
                )}
                <td style={num}>
                  {item.comparison.comparable ? (
                    usd(item.comparison.clientPrice)
                  ) : (
                    <span style={{ color: "#999" }}>not comparable</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function usd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  });
}
