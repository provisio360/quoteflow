// The cross-border decision behind Landed Cost (ADR-0035). Landed cost — whether
// the quoted price already includes shipping/duties to land the part — only means
// anything when the part crosses a border, i.e. the Dealer Country differs from the
// market Country. This single predicate is the source of truth for both the entry
// form's visibility and the submit-time required gate, so the two can never drift.

/** True when the Dealer Country and market Country are both known and differ — the
 *  only case in which Landed Cost is asked for and required. A blank/absent country
 *  on either side yields false (no provenance yet to judge a domestic-vs-import). */
export function landedCostApplies(
  dealerCountry: string | null | undefined,
  marketCountry: string | null | undefined,
): boolean {
  const dealer = (dealerCountry ?? "").trim();
  const market = (marketCountry ?? "").trim();
  if (dealer === "" || market === "") return false;
  return dealer !== market;
}
