// Pure decision core — no framework, DB, or network imports.
//
// Folds a study's released Benchmark Items and their approved quotes into the
// per-item client dashboard (issue #14): View A (the item's overall Competitor
// Price Range) and View B (that range partitioned by Competitor within the
// item). The released/approved/tenant gating and the Decimal↔number marshalling
// live in the adapter (src/lib/analytics); this core is pure arithmetic.
//
// The input is item-centric, not a flat quote list, precisely so a released item
// with NO approved quotes still produces a no-data row (CONTEXT.md: Competitor
// Price Range — "it was released, so the client still sees it"). Item identity
// (client part number + country) is enforced by the schema's unique key, so the
// adapter hands items in already-grouped; this core never re-derives identity.

import { priceRange, type PriceRange } from "./price-range";

/** One approved quote as the fold reads it: the competitor it priced and its USD
 *  price-per-unit (null when it has no per-unit figure — excluded from the range). */
export interface ItemQuote {
  readonly competitorBrand: string | null;
  readonly usdPricePerUnit: number | null;
}

/** A released Benchmark Item with its approved quotes (possibly none). */
export interface ItemWithQuotes {
  readonly country: string;
  readonly clientItemNumber: string;
  readonly itemDescription: string;
  readonly quotes: readonly ItemQuote[];
}

/** One Competitor's slice of an item's range (View B). A quote with no brand is
 *  grouped under the explicit `"(unspecified)"` label, never dropped. */
export interface CompetitorBreakdown {
  readonly competitor: string;
  readonly range: PriceRange;
}

/** One Benchmark Item's dashboard: View A (overall range) + View B (by competitor). */
export interface ItemDashboard {
  readonly country: string;
  readonly clientItemNumber: string;
  readonly itemDescription: string;
  readonly range: PriceRange;
  readonly byCompetitor: readonly CompetitorBreakdown[];
}

/**
 * Compute each released item's overall Competitor Price Range (View A) and the
 * same range partitioned by Competitor (View B). Item and competitor order is
 * preserved from the input. An item with no quotes (or only no-per-unit quotes)
 * yields an explicit no-data range rather than vanishing.
 */
export function buildItemDashboards(
  items: readonly ItemWithQuotes[],
): ItemDashboard[] {
  return items.map((item) => ({
    country: item.country,
    clientItemNumber: item.clientItemNumber,
    itemDescription: item.itemDescription,
    range: priceRange(item.quotes.map((q) => q.usdPricePerUnit)),
    byCompetitor: buildByCompetitor(item.quotes),
  }));
}

/** Partition an item's quotes by Competitor brand (View B), a null brand under
 *  the explicit `"(unspecified)"` label, preserving first-seen competitor order. */
function buildByCompetitor(
  quotes: readonly ItemQuote[],
): CompetitorBreakdown[] {
  const byBrand = new Map<string, ItemQuote[]>();
  for (const q of quotes) {
    const brand = q.competitorBrand ?? "(unspecified)";
    const list = byBrand.get(brand) ?? [];
    list.push(q);
    byBrand.set(brand, list);
  }
  return [...byBrand.entries()].map(([competitor, brandQuotes]) => ({
    competitor,
    range: priceRange(brandQuotes.map((q) => q.usdPricePerUnit)),
  }));
}
