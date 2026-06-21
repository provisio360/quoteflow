import type { ResearcherItemView } from "@/lib/benchmark-items/repository";

// The researcher work surface (#7/#8): per-item work mode plus the client's
// guidance the researcher needs to describe the part to a dealer. Pure and
// IO-free so it is unit-testable — the page attaches quotes (IO) afterwards.

export type ItemMode = "mine" | "claimable" | "claimed";

/** The client guidance a Researcher sees for a Benchmark Item — the full set the
 *  `mine` panel renders (#66). NO Client Price (ADR-0003). */
export interface GuidanceFields {
  readonly id: string;
  readonly country: string;
  readonly clientItemNumber: string;
  readonly itemDescription: string;
  readonly configurationComment: string | null;
  readonly quantity: number | null;
  readonly clientSourceUnit: string | null;
  readonly requiredQuotes: number;
}

export interface ResearcherEntry {
  readonly item: GuidanceFields;
  readonly mode: ItemMode;
}

/** The write affordances (and rejection-reason visibility) a researcher has on a
 *  single Quote in their work surface. */
export interface QuoteAffordances {
  readonly canEdit: boolean;
  readonly canSubmit: boolean;
  readonly canDelete: boolean;
  readonly canRevise: boolean;
  readonly showRejectionReason: boolean;
}

/**
 * What the viewing researcher may do with one Quote on the item's pool. Every
 * affordance — and the rejection-reason line — is owner-only: a quote is only
 * actionable by its author (#68). This is independent of the item's claim mode;
 * mode governs only the item-level affordances (Claim, + Add quote). Once
 * authorship is established, the state drives which actions apply: a Draft can be
 * edited/submitted/deleted, a Rejected quote can be revised and shows its reason.
 */
export function quoteAffordances(
  quote: { readonly state: string; readonly createdById: string },
  myUserId: string,
): QuoteAffordances {
  const mine = quote.createdById === myUserId;
  return {
    canEdit: mine && quote.state === "Draft",
    canSubmit: mine && quote.state === "Draft",
    canDelete: mine && quote.state === "Draft",
    canRevise: mine && quote.state === "Rejected",
    showRejectionReason: mine && quote.state === "Rejected",
  };
}

/**
 * Resolve each Benchmark Item to the researcher's work mode, carrying the full
 * guidance the `mine` panel renders. Mode: mine (I'm Primary) / claimable
 * (unclaimed, in my assigned Country) / claimed (someone else's).
 *
 * The caller scopes the query to the Researcher's assigned (study, country) pairs
 * (ADR-0025), so every item reaching here is already in an assigned Country. This
 * function keeps `myCountries` as an app-layer BACKSTOP: any item outside it is
 * DROPPED (not loaded data must never render), never tagged a `locked` row — that
 * mode is gone, so a future reader can't reintroduce a cross-boundary leak.
 */
export function resolveResearcherEntries(
  items: ResearcherItemView[],
  myCountries: Set<string>,
  userId: string,
): ResearcherEntry[] {
  return items
    .filter((item) => myCountries.has(item.country))
    .map((item) => {
    let mode: ItemMode;
    if (item.primaryResearcherId === userId) mode = "mine";
    else if (item.primaryResearcherId !== null) mode = "claimed";
    else mode = "claimable";
    return {
      mode,
      item: {
        id: item.id,
        country: item.country,
        clientItemNumber: item.clientItemNumber,
        itemDescription: item.itemDescription,
        configurationComment: item.configurationComment,
        quantity: item.quantity,
        clientSourceUnit: item.clientSourceUnit,
        requiredQuotes: item.requiredQuotes,
      },
    };
  });
}
