// Pure decision core — no framework, DB, or network imports.
//
// The Country Release Eligibility gate (issue #13 / ADR-0016, ADR-0002). A
// Country is releasable only when EVERY Benchmark Item has at least its Required
// Quotes approved AND no item carries an in-flight (Draft/Submitted) quote. A
// Rejected quote is NOT in-flight and never blocks. The judgement is derived,
// never stored; the repository computes the per-item counts and hands them in,
// so this core imports no Prisma and is exhaustively unit-testable.

/** Per-item counts the gate reads (CONTEXT.md: Release Eligibility). */
export interface ItemReleaseStatus {
  /** The item's Required Quotes — the approved count it must reach. May be 0. */
  readonly requiredQuotes: number;
  /** How many of the item's quotes are currently Approved. */
  readonly approvedCount: number;
  /** How many are in-flight — Draft or Submitted (a Rejected one is excluded). */
  readonly inFlightCount: number;
}

/**
 * The eligibility verdict. Not a bare boolean: when blocked it names WHY, as
 * counts, so a caller can explain "N items need more approved quotes, M have
 * work in progress" without leaking which specific quotes — mirroring the
 * reasons-bearing shape of TransitionResult / PriceFlagResult.
 */
export type ReleaseEligibility =
  | { readonly releasable: true }
  | {
      readonly releasable: false;
      readonly reasons: {
        readonly shortItems: number;
        readonly inFlightItems: number;
      };
    };

/**
 * Evaluate whether a Country may be released from its items' counts. Releasable
 * iff there is at least one item and every item meets Required Quotes with no
 * in-flight work. An empty Country (no Benchmark Items) is NOT releasable —
 * releasing nothing is meaningless (ADR-0016).
 */
export function evaluateRelease(
  items: readonly ItemReleaseStatus[],
): ReleaseEligibility {
  let shortItems = 0;
  let inFlightItems = 0;
  for (const item of items) {
    if (item.approvedCount < item.requiredQuotes) shortItems += 1;
    if (item.inFlightCount > 0) inFlightItems += 1;
  }
  // An empty Country is not releasable (releasing nothing is meaningless), and
  // neither is one with any short or in-flight item.
  if (items.length > 0 && shortItems === 0 && inFlightItems === 0) {
    return { releasable: true };
  }
  return { releasable: false, reasons: { shortItems, inFlightItems } };
}
