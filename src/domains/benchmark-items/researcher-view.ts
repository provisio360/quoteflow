import type { ResearcherItemView } from "@/lib/benchmark-items/repository";
import {
  DOC_REQUIRED_TO_SUBMIT,
  type DocRequiredField,
  type IncompleteLine,
  type LineRequiredField,
} from "@/domains/quotes/lifecycle";

const DOC_FIELDS = new Set<string>(DOC_REQUIRED_TO_SUBMIT);

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

/** A Benchmark Item the researcher may add a line for, with its picker label. */
export interface AddLineCandidate {
  readonly id: string;
  readonly label: string;
}

/**
 * The items a researcher may add a new [[Quote Line]] for to an existing Market
 * Quote: every Benchmark Item in the document's Country that the document does not
 * already cover (one line per Benchmark Item, #97/Q7) — NOT filtered to items the
 * researcher already leads. Pre-claiming is gone (ADR-0038): filing the first line
 * for an unclaimed item auto-claims it, so the picker offers peer-led and unclaimed
 * parts alike. A line for an item already on the document is barred by the
 * `@@unique(marketQuoteId, benchmarkItemId)` backstop, so it is never offered. The
 * Country filter is the cross-boundary backstop (ADR-0025): callers already scope
 * `items` to the researcher's assigned (study, country) pairs.
 */
export function addLineCandidates(
  items: readonly ResearcherItemView[],
  docCountry: string,
  itemIdsOnDoc: ReadonlySet<string>,
): AddLineCandidate[] {
  return items
    .filter((item) => item.country === docCountry && !itemIdsOnDoc.has(item.id))
    .map((item) => ({ id: item.id, label: `${item.clientItemNumber} ${item.itemDescription}` }));
}

/** The per-part progress counts the Collect surface reads (#142): the approved
 *  figure is ALL-author (the canonical [[Release Eligibility]] count of distinct
 *  Market Quotes with an approved line — line-count = distinct-MQ-count under the
 *  `(marketQuote, item)` uniqueness); the in-flight figure is the VIEWING
 *  researcher's OWN Draft/Submitted lines only (a peer's Drafts are private,
 *  ADR-0011). A part absent from the map has no quotes yet (both zero). */
export interface PartProgress {
  readonly approvedCount: number;
  readonly myInFlightCount: number;
}

const NO_PROGRESS: PartProgress = { approvedCount: 0, myInFlightCount: 0 };

/** A part as the Quote Group part-picker lists it: the picker label fields plus
 *  its layered progress (#142). `preChecked` is the picker's default selection,
 *  keyed on the APPROVED figure alone (`approved < Required`) — the in-flight
 *  layer is collection visibility only and never suppresses the pre-check
 *  (ADR-0038). Always false for an off-slot `otherParts` entry (the escape hatch
 *  is never nudged). */
export interface QuoteGroupPart {
  readonly id: string;
  readonly clientItemNumber: string;
  readonly itemDescription: string;
  readonly requiredQuotes: number;
  readonly approvedCount: number;
  readonly myInFlightCount: number;
  readonly preChecked: boolean;
}

/** One Quote Group: an ordinal dealer-document slot (ADR-0038). `members` are the
 *  parts in this slot's position membership (Required Quotes >= N); `otherParts` is
 *  the collapsed escape hatch — the Country's off-slot parts (Required Quotes < N) a
 *  dealer carrying one is never blocked from adding. The number is a bucket label,
 *  never persisted on the seeded Market Quote. */
export interface QuoteGroup {
  readonly groupNumber: number;
  readonly members: readonly QuoteGroupPart[];
  readonly otherParts: readonly QuoteGroupPart[];
}

/**
 * Build the Quote Group lens for ONE Country's Benchmark Items (caller scopes the
 * read to a single Country). A non-persisted ordinal lens (ADR-0038): there are
 * `max(Required Quotes)` groups, and group N lists the parts whose Required Quotes
 * reaches N (`>= N`), so later groups are sparser and group 1 the fullest. A Country
 * with no parts (or every part at Required Quotes 0) yields no groups. The group
 * number labels a slot and is never stored on the Market Quote a group seeds.
 */
export function quoteGroups(
  items: readonly GuidanceFields[],
  counts: ReadonlyMap<string, PartProgress> = new Map(),
): QuoteGroup[] {
  const maxRequired = items.reduce((max, item) => Math.max(max, item.requiredQuotes), 0);
  // `member` carries the approved-keyed pre-check default; an off-slot part is the
  // escape hatch — counts shown for context, never pre-checked (ADR-0038, #142).
  const part = (i: GuidanceFields, isMember: boolean): QuoteGroupPart => {
    const progress = counts.get(i.id) ?? NO_PROGRESS;
    return {
      id: i.id,
      clientItemNumber: i.clientItemNumber,
      itemDescription: i.itemDescription,
      requiredQuotes: i.requiredQuotes,
      approvedCount: progress.approvedCount,
      myInFlightCount: progress.myInFlightCount,
      preChecked: isMember && progress.approvedCount < i.requiredQuotes,
    };
  };
  const groups: QuoteGroup[] = [];
  for (let n = 1; n <= maxRequired; n += 1) {
    groups.push({
      groupNumber: n,
      members: items.filter((i) => i.requiredQuotes >= n).map((i) => part(i, true)),
      otherParts: items.filter((i) => i.requiredQuotes < n).map((i) => part(i, false)),
    });
  }
  return groups;
}

/** The Rejected-line affordances a researcher has on a single Quote in the item
 *  view (Draft mutation + Submit moved to the document panel, #97/Q8). */
export interface QuoteAffordances {
  readonly canRevise: boolean;
  readonly showRejectionReason: boolean;
}

/** A Draft line in a document group, with the labels its panel row renders. */
export interface DraftLineLabel {
  readonly lineId: string;
  readonly quoteLineNumber: number;
  readonly itemLabel: string;
}

/** One reported line and the line-level fields it still lacks (doc fields stripped). */
export interface ReportedLine extends DraftLineLabel {
  readonly missing: readonly LineRequiredField[];
}

/** The `lines-incomplete` report shaped for the document panel: the shared
 *  document shortfall surfaced ONCE, and the per-line shortfall against each
 *  line's Quote Line number + item label (a line whose only gap is a document
 *  field is covered by the banner, so it drops out of the per-line list). */
export interface SubmitReport {
  readonly docMissing: readonly DocRequiredField[];
  readonly lines: readonly ReportedLine[];
}

/**
 * Partition a failed bulk submit's per-line report into the document banner and
 * the per-line rows the researcher acts on. `submitDocument` prepends the shared
 * document-missing fields to EVERY incomplete line; here we lift them back out so
 * a missing currency reads once at the top rather than echoing on every row.
 */
export function partitionSubmitReport(
  perLine: readonly IncompleteLine[],
  draftLines: readonly DraftLineLabel[],
): SubmitReport {
  const labelById = new Map(draftLines.map((l) => [l.lineId, l]));

  // The document fields are identical across every incomplete line — take the set
  // that appears on all of them (robust to an empty report).
  const docMissing = DOC_REQUIRED_TO_SUBMIT.filter((field) =>
    perLine.every((line) => line.missing.includes(field)),
  );

  const lines: ReportedLine[] = [];
  for (const line of perLine) {
    const missing = line.missing.filter(
      (field): field is LineRequiredField => !DOC_FIELDS.has(field),
    );
    if (missing.length === 0) continue; // only doc fields short → banner covers it
    const label = labelById.get(line.lineId);
    if (label === undefined) continue; // not a Draft line in this group
    lines.push({ ...label, missing });
  }

  return { docMissing, lines };
}

/**
 * What the viewing researcher may do with one Quote on the item's pool. Every
 * affordance — and the rejection-reason line — is owner-only: a quote is only
 * actionable by its author (#68). This is independent of the item's claim mode;
 * mode governs only the item-level affordances (Claim, + Add quote). Once
 * authorship is established, the state drives which actions apply: a Rejected
 * quote can be revised and shows its reason. Draft edit/delete + Submit live in
 * the document panel now (#97/Q8), so the item view exposes neither.
 */
export function quoteAffordances(
  quote: { readonly state: string; readonly createdById: string },
  myUserId: string,
): QuoteAffordances {
  const mine = quote.createdById === myUserId;
  return {
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
