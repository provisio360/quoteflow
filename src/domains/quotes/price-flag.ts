// Pure decision core — no framework, DB, or network imports (depends only on
// the equally-pure QC Threshold resolver).
//
import { resolveQcThreshold } from "@/domains/benchmark-items/qc-threshold";
//
// The QC out-of-range price flag (issue #11 / ADR-0014). A converted Quote's USD
// price-per-unit is compared to its Benchmark Item's Client Price using the
// SYMMETRIC relative percent difference; a divergence beyond the study's QC
// Threshold raises the flag. The flag is advisory (it never auto-rejects), but a
// flagged Quote cannot be approved without a Justification — that gate lives in
// the lifecycle core, which consumes the boolean this function produces.

/** Inputs the flag reads — primitives only, so the core never imports Prisma. */
export interface PriceFlagInput {
  /** The Quote's converted USD price-per-unit; null when not yet converted. */
  readonly usdPricePerUnit: number | null;
  /**
   * The Benchmark Item's expected USD price-per-unit (CONTEXT.md: Client Price).
   * Null when the item has no Client Price set — an item the client never priced
   * (ADR-0015); such an item is not comparable, exactly like an unconverted quote.
   */
  readonly clientPrice: number | null;
  /** The resolved QC Threshold, as a FRACTION (e.g. 0.25 = 25%; CONTEXT.md: QC
   *  Threshold). Per-item value with study-default fallback is resolved upstream. */
  readonly threshold: number;
}

export type PriceFlagResult =
  | { readonly comparable: false }
  | {
      readonly comparable: true;
      readonly flagged: boolean;
      readonly direction: "above" | "below" | "equal";
      /** The symmetric relative difference as a FRACTION (the value compared to
       *  the threshold). The Internal Export's "Quoted Price Difference to Client
       *  Price" column reads this directly (ADR-0029). */
      readonly relativeDiff: number;
      readonly percentDiff: number;
    };

/**
 * Evaluate a Quote against its Client Price. A Quote with no USD price-per-unit
 * (still pending / unconverted) is NOT comparable and never flagged. Otherwise
 * the symmetric relative percent difference
 *   percent_diff = |a - b| / ((a + b) / 2) * 100
 * is computed (a = USD price-per-unit, b = Client Price); the Quote is flagged
 * when it exceeds the threshold. `direction` reports whether the quote is dearer
 * (above) or cheaper (below) than the benchmark, for display only.
 */
export function evaluatePriceFlag(input: PriceFlagInput): PriceFlagResult {
  const { usdPricePerUnit, clientPrice, threshold } = input;
  if (usdPricePerUnit === null || clientPrice === null) return { comparable: false };

  const a = usdPricePerUnit;
  const b = clientPrice;
  const mean = (a + b) / 2;
  // Relative difference as a FRACTION, compared directly to the fraction
  // threshold; `percentDiff` (×100) is retained for display only.
  const relativeDiff = mean === 0 ? 0 : Math.abs(a - b) / mean;
  const percentDiff = relativeDiff * 100;
  const direction = a > b ? "above" : a < b ? "below" : "equal";
  return { comparable: true, flagged: relativeDiff > threshold, direction, relativeDiff, percentDiff };
}

/** Inputs the line-level flag reads — line + item + study primitives only. */
export interface LineFlagInput {
  /** The line's converted USD price-per-unit; null when not yet converted. */
  readonly usdPricePerUnit: number | null;
  /** The Benchmark Item's Client Price (USD/unit); null when the item is unpriced. */
  readonly clientPrice: number | null;
  /** The Benchmark Item's own QC Threshold (fraction), or null to fall back. */
  readonly itemThreshold: number | null;
  /** The Study's default QC Threshold (fraction), used when the item has none. */
  readonly studyThreshold: number;
}

/**
 * The single boolean the rest of the app keys off a Quote Line: resolve the
 * per-item/study QC Threshold (ADR-0026) and collapse `evaluatePriceFlag`'s
 * comparable+flagged result. A not-comparable line (pending, or item unpriced)
 * is never flagged. Both the approve gate and the researcher's Justification
 * field read exactly this (ADR-0014).
 */
export function isLineFlagged(input: LineFlagInput): boolean {
  const threshold = resolveQcThreshold(input.itemThreshold, input.studyThreshold);
  const flag = evaluatePriceFlag({
    usdPricePerUnit: input.usdPricePerUnit,
    clientPrice: input.clientPrice,
    threshold,
  });
  return flag.comparable && flag.flagged;
}
