// Pure decision core — no framework, DB, or network imports.
//
// The QC Threshold resolution (#86, amending ADR-0014). Each Benchmark Item may
// carry its own threshold; where it sets none it falls back to the study default.
// Both are FRACTIONS (CONTEXT.md: QC Threshold), so the result feeds the price
// flag without any unit conversion.

/**
 * Resolve the effective QC Threshold for an item: its own value when set,
 * otherwise the study default. A per-item `0` is a deliberate override (zero
 * tolerance), not absence — only `null` means "fall back".
 */
export function resolveQcThreshold(itemThreshold: number | null, studyThreshold: number): number {
  return itemThreshold ?? studyThreshold;
}
