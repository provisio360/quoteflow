// Pure decision cores — no framework, DB, or network imports.
//
// The entry-time mechanical sanity checks (issue #163 / ADR-0042). Unlike the
// peer-spread flag, these are benchmark-free fat-finger catches that fire
// independently of the peer population — even at n=0 peers. Both are advisory
// nudges, never gates: the researcher may still submit (ADR-0042).

/** Ratio at/above which the new line looks like a decimal slip vs its siblings. */
const SLIP_FACTOR = 10;

export interface DecimalSlipInput {
  /** The new line's live USD-per-unit (ADR-0041 preview); null when not yet known. */
  readonly liveUsdPerUnit: number | null;
  /** The OTHER lines' USD-per-unit on the SAME Market Quote document. Nulls (lines
   *  without a live USD yet) are ignored; a document's first line has none. */
  readonly siblingUsdPerUnit: readonly (number | null)[];
}

export type DecimalSlipResult =
  /** No comparison possible: no live USD on the new line, or no sibling with a USD. */
  | { readonly silent: true }
  | {
      readonly silent: false;
      readonly flagged: boolean;
      /** New line's USD-per-unit ÷ the siblings' median USD-per-unit. */
      readonly ratio: number;
      readonly direction: "higher" | "lower";
    };

/**
 * Compare the new line's USD-per-unit against the MEDIAN USD-per-unit of the other
 * lines on the same document. USD-per-unit (not raw price) is used so lines pricing
 * differently-scaled items on one document stay comparable (Q1). Fires when the
 * ratio is >= 10x or <= 0.1x — the hallmark of a misplaced decimal. Silent when the
 * new line has no live USD, or the document has no other line with a USD yet.
 */
export function decimalSlip(input: DecimalSlipInput): DecimalSlipResult {
  const { liveUsdPerUnit } = input;
  if (liveUsdPerUnit === null) return { silent: true };
  const siblings = input.siblingUsdPerUnit.filter((p): p is number => p !== null && p > 0);
  if (siblings.length === 0) return { silent: true };

  const med = median(siblings);
  if (med === 0) return { silent: true };
  const ratio = liveUsdPerUnit / med;
  const flagged = ratio >= SLIP_FACTOR || ratio <= 1 / SLIP_FACTOR;
  const direction = liveUsdPerUnit >= med ? "higher" : "lower";
  return { silent: false, flagged, ratio, direction };
}

/**
 * Advisory quantity sanity (Q3): a quoted quantity must be a positive, real number.
 * Returns false (nudge) for a null / non-numeric / non-positive quantity. Does not
 * replace the submit-time required-field validation — it just surfaces the fat
 * finger live at entry.
 */
export function quantityPlausible(quantityQuoted: number | null): boolean {
  return quantityQuoted !== null && Number.isFinite(quantityQuoted) && quantityQuoted > 0;
}

/** Median of a non-empty numeric list (mean of the middle pair when even). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
