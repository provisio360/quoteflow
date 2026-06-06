import { describe, it, expect } from "vitest";
import { buildItemDashboards, type ItemWithQuotes } from "./dashboard";

// Folding released Benchmark Items + their approved quotes into the per-item
// dashboard (issue #14): View A is the item's overall Competitor Price Range;
// View B is that range partitioned by Competitor within the item. Pure — the
// released/approved/tenant gating and Decimal parsing live in the adapter
// (src/lib/analytics); this builds the shape the dashboards render.

function item(over: Partial<ItemWithQuotes> = {}): ItemWithQuotes {
  return {
    country: "France",
    clientPartNumber: "CP-1",
    itemDescription: "Widget",
    quotes: [],
    ...over,
  };
}

describe("buildItemDashboards", () => {
  it("computes an item's overall range from its quotes (View A)", () => {
    const [dash] = buildItemDashboards([
      item({
        quotes: [
          { competitorBrand: "Acme", usdPricePerUnit: 10 },
          { competitorBrand: "Acme", usdPricePerUnit: 30 },
        ],
      }),
    ]);
    expect(dash).toEqual({
      country: "France",
      clientPartNumber: "CP-1",
      itemDescription: "Widget",
      range: { hasData: true, min: 10, max: 30, median: 20, count: 2 },
      byCompetitor: [
        { competitor: "Acme", range: { hasData: true, min: 10, max: 30, median: 20, count: 2 } },
      ],
    });
  });

  it("emits one dashboard per item, preserving input order", () => {
    const dashes = buildItemDashboards([
      item({ country: "France", quotes: [{ competitorBrand: "Acme", usdPricePerUnit: 10 }] }),
      item({ country: "Germany", quotes: [{ competitorBrand: "Acme", usdPricePerUnit: 50 }] }),
    ]);
    expect(dashes.map((d) => ({ country: d.country, range: d.range }))).toEqual([
      { country: "France", range: { hasData: true, min: 10, max: 10, median: 10, count: 1 } },
      { country: "Germany", range: { hasData: true, min: 50, max: 50, median: 50, count: 1 } },
    ]);
  });

  it("partitions an item's range by competitor (View B) while View A spans all", () => {
    const [dash] = buildItemDashboards([
      item({
        quotes: [
          { competitorBrand: "Acme", usdPricePerUnit: 10 },
          { competitorBrand: "Acme", usdPricePerUnit: 30 },
          { competitorBrand: "Globex", usdPricePerUnit: 100 },
        ],
      }),
    ]);
    expect(dash.range).toEqual({ hasData: true, min: 10, max: 100, median: 30, count: 3 });
    expect(dash.byCompetitor).toEqual([
      { competitor: "Acme", range: { hasData: true, min: 10, max: 30, median: 20, count: 2 } },
      { competitor: "Globex", range: { hasData: true, min: 100, max: 100, median: 100, count: 1 } },
    ]);
  });

  it("groups a quote with no competitor brand under \"(unspecified)\"", () => {
    const [dash] = buildItemDashboards([
      item({ quotes: [{ competitorBrand: null, usdPricePerUnit: 10 }] }),
    ]);
    expect(dash.byCompetitor).toEqual([
      { competitor: "(unspecified)", range: { hasData: true, min: 10, max: 10, median: 10, count: 1 } },
    ]);
  });

  it("keeps an item whose quotes all lack a per-unit figure as a no-data row", () => {
    // The quotes exist but none is usable; the item was released, so it stays —
    // a no-data View A range, and its competitor slice is also no-data.
    const [dash] = buildItemDashboards([
      item({ quotes: [{ competitorBrand: "Acme", usdPricePerUnit: null }] }),
    ]);
    expect(dash.range).toEqual({ hasData: false });
    expect(dash.byCompetitor).toEqual([{ competitor: "Acme", range: { hasData: false } }]);
  });

  it("keeps a released item with zero approved quotes as a no-data row (no competitors)", () => {
    // e.g. Required Quotes = 0: released, no approved quotes at all. Still shown.
    const [dash] = buildItemDashboards([item({ quotes: [] })]);
    expect(dash.range).toEqual({ hasData: false });
    expect(dash.byCompetitor).toEqual([]);
  });
});
