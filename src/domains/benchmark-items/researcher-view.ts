import type { ResearcherItemView } from "@/lib/benchmark-items/repository";

// The researcher work surface (#7/#8): per-item work mode plus the client's
// guidance the researcher needs to describe the part to a dealer. Pure and
// IO-free so it is unit-testable — the page attaches quotes (IO) afterwards.

export type ItemMode = "mine" | "claimable" | "claimed" | "locked";

/** The client guidance a Researcher sees for a Benchmark Item — the full set the
 *  `mine` panel renders (#66). NO Client Price (ADR-0003). */
export interface GuidanceFields {
  readonly id: string;
  readonly country: string;
  readonly clientPartNumber: string;
  readonly itemDescription: string;
  readonly configurationComment: string | null;
  readonly quantity: number | null;
  readonly machineModel: string;
  readonly requiredQuotes: number;
}

export interface ResearcherEntry {
  readonly item: GuidanceFields;
  readonly mode: ItemMode;
}

/**
 * Resolve each Benchmark Item to the researcher's work mode, carrying the full
 * guidance the `mine` panel renders. Mode: mine (I'm Primary) / claimable
 * (unclaimed + I'm in the Country pool) / claimed (someone else's) / locked
 * (unclaimed, not my Country).
 */
export function resolveResearcherEntries(
  items: ResearcherItemView[],
  myCountries: Set<string>,
  userId: string,
): ResearcherEntry[] {
  return items.map((item) => {
    let mode: ItemMode;
    if (item.primaryResearcherId === userId) mode = "mine";
    else if (item.primaryResearcherId !== null) mode = "claimed";
    else if (myCountries.has(item.country)) mode = "claimable";
    else mode = "locked";
    return {
      mode,
      item: {
        id: item.id,
        country: item.country,
        clientPartNumber: item.clientPartNumber,
        itemDescription: item.itemDescription,
        configurationComment: item.configurationComment,
        quantity: item.quantity,
        machineModel: item.machineModel,
        requiredQuotes: item.requiredQuotes,
      },
    };
  });
}
