// Pure decision core — no framework, DB, or network imports.
//
// The Researcher's live peer-spread nudge (issue #163 / ADR-0042). As a Researcher
// types a Quote Line, its live USD-per-unit (ADR-0041 preview) is compared to the
// PEER MEDIAN — the other dealers' converted lines for the same Benchmark Item that
// ADR-0003 §3 already lets researchers see — using the SAME symmetric relative
// percent difference as the analyst QC flag (evaluatePriceFlag / ADR-0014), reusing
// the study's QC Threshold fraction. Anchored to the market, NEVER the Client Price:
// this is a second, deliberately-separate flag system, and the Client Price stays
// hidden from researchers (ADR-0003, ADR-0042). A soft nudge, never a gate.

/** Inputs the flag reads — primitives only, so the core never imports Prisma. */
export interface PeerSpreadInput {
  /** The new line's live USD-per-unit from the entry preview (ADR-0041); null when
   *  there is no live USD (a rate miss, or price/quantity not yet both entered). */
  readonly liveUsdPerUnit: number | null;
  /** The median USD-per-unit across the item's peers (Submitted+Approved, converted).
   *  Null when there are fewer than 2 converted peers — no real market median yet. */
  readonly peerMedianUsdPerUnit: number | null;
  /** The resolved study QC Threshold, as a FRACTION (e.g. 0.25 = 25%). One knob,
   *  reused from the analyst flag (ADR-0042), applied to the peer median instead. */
  readonly threshold: number;
}

export type PeerSpreadResult =
  /** No market defined for the item yet: < 2 peers, or no live USD on the new line.
   *  The first quote for an item is always silent — it degrades gracefully (ADR-0042). */
  | { readonly silent: true }
  | {
      readonly silent: false;
      readonly flagged: boolean;
      /** Whether the new line sits higher / lower than THE OTHER DEALERS (never a
       *  benchmark value — the researcher never sees the Client Price). */
      readonly direction: "higher" | "lower" | "equal";
      /** The symmetric relative difference as a FRACTION (compared to the threshold). */
      readonly relativeDiff: number;
      readonly percentDiff: number;
    };

/**
 * The peer median USD-per-unit, or `null` when there are fewer than 2 converted
 * peers — with 0 or 1 point there is no real market spread, so the flag stays
 * silent and the first quote for an item is never flaggable (ADR-0042). The
 * repository resolves the population (same item, Submitted+Approved, converted)
 * and hands the raw USD points here so this rule stays pure and unit-tested.
 */
export function peerMedian(pointsUsdPerUnit: readonly number[]): number | null {
  if (pointsUsdPerUnit.length < 2) return null;
  const sorted = [...pointsUsdPerUnit].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Evaluate the new line against the peer median. Silent when there is no live USD
 * or fewer than 2 converted peers (median null). Otherwise the symmetric relative
 * percent difference
 *   percent_diff = |a - b| / ((a + b) / 2) * 100
 * is computed (a = live USD-per-unit, b = peer median); the line is flagged when it
 * exceeds the threshold. `direction` reports higher/lower than the other dealers.
 */
export function peerSpreadFlag(input: PeerSpreadInput): PeerSpreadResult {
  const { liveUsdPerUnit, peerMedianUsdPerUnit, threshold } = input;
  if (liveUsdPerUnit === null || peerMedianUsdPerUnit === null) return { silent: true };

  const a = liveUsdPerUnit;
  const b = peerMedianUsdPerUnit;
  const mean = (a + b) / 2;
  const relativeDiff = mean === 0 ? 0 : Math.abs(a - b) / mean;
  const percentDiff = relativeDiff * 100;
  const direction = a > b ? "higher" : a < b ? "lower" : "equal";
  return { silent: false, flagged: relativeDiff > threshold, direction, relativeDiff, percentDiff };
}
