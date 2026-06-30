import { withTenant, type TenantClient } from "@/lib/tenant-context";
import type { Principal } from "@/domains/authz/principal";
import { isInternal } from "@/domains/authz/principal";
import { canCreateQuote, canReviewQuote } from "@/domains/authz/quotes";
import {
  transition,
  submitDocument,
  type DocumentHeader,
  type SubmittableLine,
  type SubmitDocumentResult,
  type TransitionResult,
} from "@/domains/quotes/lifecycle";
import { evaluatePriceFlag, isLineFlagged, type PriceFlagResult } from "@/domains/quotes/price-flag";
import { isValidCurrency } from "@/domains/quotes/currencies";
import { canonicalCountry } from "@/domains/benchmark-items/countries";
import { resolveQcThreshold } from "@/domains/benchmark-items/qc-threshold";
import {
  convertManual,
  parseManualRate,
  nextConversionStatus,
  type ConversionStatus,
} from "@/domains/quotes/conversion";
import { recordAuditEvents } from "@/lib/audit/repository";
import { auditQuoteLifecycle, auditDocumentSubmit, auditManualRateOverride } from "@/domains/audit/events";
import { recordNotifications } from "@/lib/notifications/dispatch";
import { notifyQuoteRejected } from "@/domains/notifications/events";
import type { PartProgress } from "@/domains/benchmark-items/researcher-view";

// Tenant-aware data-access adapter for the Market Quote aggregate (#87, ADR-0026).
// A Market Quote (dealer DOCUMENT) is created by a Researcher and gathers many
// Quote Lines (one per Benchmark Item it prices), each carrying the lifecycle
// `state`. This layer owns the gates the pure cores can't: the Researcher role
// (canCreateQuote), the Country-pool membership check (only the pool may work a
// market), the atomic per-(study, country) Market Quote Number and Quote Line
// Number allocation (ADR-0026, supersedes ADR-0010), owner-only writes, and the
// Draft-privacy read filter (ADR-0011). The Draft→Submitted decision and submit-
// time validation live in src/domains/quotes/lifecycle; this layer persists it.
//
// This slice keeps the lifecycle PER LINE (a mechanical port of the flat-quote
// paths); the document-level bulk submit and per-document rate pin land in a
// dependent slice. Conversion columns live on the Market Quote (one rate per
// document); each line keeps only its derived USD figures.

/** Raised for permission / existence / ownership failures (not user-fixable by
 *  filling in fields — that is the lifecycle core's `missing-fields` result). */
export class QuoteAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteAccessError";
  }
}

/** Raised when a write carries a malformed value the user must correct — distinct
 *  from an access failure. Forward-only (ADR-0032): only the value BEING WRITTEN is
 *  checked; a key absent from the edit is never revalidated, so legacy free-text
 *  currency / a null Dealer Country survive untouched until next edited. */
export class QuoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteValidationError";
  }
}

/** Forward-only write validation of the document header (ADR-0032). A supplied,
 *  non-empty `currency` must be a valid ISO 4217 code; a supplied, non-empty
 *  `sourceCountry` must be a canonical ISO 3166-1 name. `undefined` (field not in
 *  the edit) and null/blank are tolerated — required-ness is the submit gate's job. */
function validateHeaderWrite(header: MarketQuoteHeaderFields): void {
  if (
    header.currency !== undefined &&
    header.currency !== null &&
    header.currency.trim() !== "" &&
    !isValidCurrency(header.currency)
  ) {
    throw new QuoteValidationError(`Invalid currency code: "${header.currency}"`);
  }
  if (
    header.sourceCountry !== undefined &&
    header.sourceCountry !== null &&
    header.sourceCountry.trim() !== "" &&
    canonicalCountry(header.sourceCountry) === null
  ) {
    throw new QuoteValidationError(`Invalid Dealer Country: "${header.sourceCountry}"`);
  }
}

/** The document-header fields a Researcher sets when creating a Market Quote. The
 *  owning (studyId, country) are positional, not here. All optional — a Draft
 *  document saves partial data; source/date/currency become required only when its
 *  lines are submitted (validated per line by the lifecycle core). */
export interface MarketQuoteHeaderFields {
  readonly sourceName?: string | null;
  /** The dealer's validated country (ADR-0032): a canonical ISO 3166-1 short name.
   *  Forward-only — rejected on write if supplied non-empty and not in the list. */
  readonly sourceCountry?: string | null;
  readonly sourceLocality?: string | null;
  readonly sourceUrl?: string | null;
  readonly currency?: string | null;
  readonly dateQuoteReceived?: Date | null;
}

/** The editable per-item fields of a Quote Line. All optional — a Draft saves
 *  partial data and required-ness is enforced only at submit. The dealer/date/
 *  currency are NOT here; they live on the parent Market Quote. */
export interface QuoteLineFields {
  readonly competitorBrand?: string | null;
  readonly competitorPartNumber?: string | null;
  readonly competitorPartDescription?: string | null;
  readonly price?: number | string | null;
  readonly quantityQuoted?: number | null;
  readonly stockStatus?: string | null;
  readonly leadTimeValue?: number | string | null;
  readonly leadTimeUnit?: string | null;
  readonly warrantyOffered?: boolean | null;
  readonly warranty1Value?: number | string | null;
  readonly warranty1Unit?: string | null;
  readonly warranty2Value?: number | string | null;
  readonly warranty2Unit?: string | null;
  readonly discountAvailable?: boolean | null;
  readonly discountApplied?: boolean | null;
  readonly discountValue?: number | string | null;
  readonly discountType?: string | null;
  readonly landedCostIncluded?: boolean | null;
  readonly landedCostNote?: string | null;
  readonly notes?: string | null;
  readonly notesSecondary?: string | null;
  readonly confidenceCode?: "High" | "Moderate" | "Low" | null;
  readonly paperQuote?: boolean;
  /** The author's explanation for a flagged price (ADR-0014). */
  readonly justification?: string | null;
}

/** A Quote Line as a pool member may read it (issue #8 read AC, ported to the
 *  line). Client Price is not a line field, so nothing tenant-sensitive is here. */
export interface QuoteLineView {
  readonly id: string;
  readonly marketQuoteId: string;
  readonly benchmarkItemId: string;
  readonly quoteLineNumber: number;
  readonly state: "Draft" | "Submitted" | "Approved" | "Rejected";
  readonly createdById: string;
  readonly authorName: string;
  readonly competitorBrand: string | null;
  readonly competitorPartNumber: string | null;
  readonly competitorPartDescription: string | null;
  readonly price: string | null;
  /** The parent Market Quote's local currency, joined for display so the line's
   *  local `price` can be minor-unit formatted (ADR-0033). Null on a Draft
   *  document whose header currency is not yet set. Currency still lives on the
   *  document, never the line — this is a read-only display join. */
  readonly currency: string | null;
  readonly quantityQuoted: number | null;
  readonly stockStatus: string | null;
  readonly notes: string | null;
  readonly notesSecondary: string | null;
  readonly confidenceCode: "High" | "Moderate" | "Low" | null;
  readonly paperQuote: boolean;
  /** The analyst's reason on a Rejected line — the author needs it to revise. */
  readonly rejectionReason: string | null;
  readonly justification: string | null;
}

const QUOTE_LINE_VIEW_SELECT = {
  id: true,
  marketQuoteId: true,
  benchmarkItemId: true,
  quoteLineNumber: true,
  state: true,
  createdById: true,
  competitorBrand: true,
  competitorPartNumber: true,
  competitorPartDescription: true,
  price: true,
  quantityQuoted: true,
  stockStatus: true,
  notes: true,
  notesSecondary: true,
  confidenceCode: true,
  paperQuote: true,
  rejectionReason: true,
  justification: true,
  createdBy: { select: { name: true } },
  marketQuote: { select: { currency: true } },
} as const;

/**
 * Atomically allocate the next Market Quote Number for a (study, country),
 * creating the sequence row on first use (ADR-0026). Single-statement
 * INSERT … ON CONFLICT … DO UPDATE … RETURNING — the maybe-absent-row
 * generalization of ADR-0010's atomic-increment idiom: the row-level lock the
 * conflicting UPDATE takes serializes concurrent creators with no MAX race and no
 * retry loop. Runs on the tenant transaction's pinned connection, so the RLS GUC
 * applies.
 */
async function allocateMarketQuoteNumber(
  tx: TenantClient,
  studyId: string,
  clientId: string,
  country: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ seq: number }[]>`
    INSERT INTO "quote_number_sequence"
      ("id", "studyId", "clientId", "country", "marketQuoteSeq", "quoteLineSeq", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${studyId}, ${clientId}, ${country}, 1, 0, now(), now())
    ON CONFLICT ("studyId", "country") DO UPDATE
      SET "marketQuoteSeq" = "quote_number_sequence"."marketQuoteSeq" + 1, "updatedAt" = now()
    RETURNING "marketQuoteSeq" AS seq`;
  return rows[0].seq;
}

/** Atomically allocate the next (flat) Quote Line Number for a (study, country),
 *  creating the sequence row on first use — the line-counter twin of
 *  allocateMarketQuoteNumber (ADR-0026). */
async function allocateQuoteLineNumber(
  tx: TenantClient,
  studyId: string,
  clientId: string,
  country: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ seq: number }[]>`
    INSERT INTO "quote_number_sequence"
      ("id", "studyId", "clientId", "country", "marketQuoteSeq", "quoteLineSeq", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${studyId}, ${clientId}, ${country}, 0, 1, now(), now())
    ON CONFLICT ("studyId", "country") DO UPDATE
      SET "quoteLineSeq" = "quote_number_sequence"."quoteLineSeq" + 1, "updatedAt" = now()
    RETURNING "quoteLineSeq" AS seq`;
  return rows[0].seq;
}

/**
 * Create a new Draft Market Quote (dealer document) in a (study, country),
 * allocating its Market Quote Number. Gates, in order: the caller is a Researcher
 * (role); the study exists; the caller is in the (study, country) pool (#6 — only
 * the pool may work a market). The document has no lifecycle state; its Quote Lines
 * are added next and carry the state.
 */
export async function createMarketQuote(
  principal: Principal,
  studyId: string,
  country: string,
  header: MarketQuoteHeaderFields = {},
): Promise<{ readonly id: string; readonly marketQuoteNumber: number }> {
  return withTenant(principal, (tx) =>
    createMarketQuoteTx(tx, principal, studyId, country, header),
  );
}

/** The transactional body of {@link createMarketQuote}, factored out so the
 *  multi-line Quote Group seed ({@link seedMarketQuote}) can compose it with
 *  {@link addQuoteLineTx} inside ONE transaction (ADR-0038, #140) — keeping the
 *  Researcher-role, study-exists and Country-pool gates single-sourced. */
async function createMarketQuoteTx(
  tx: TenantClient,
  principal: Principal,
  studyId: string,
  country: string,
  header: MarketQuoteHeaderFields,
): Promise<{ readonly id: string; readonly marketQuoteNumber: number }> {
  if (!canCreateQuote(principal)) {
    throw new QuoteAccessError("Only Researchers may create a Market Quote");
  }
  validateHeaderWrite(header);

  const study = await tx.study.findUnique({
    where: { id: studyId },
    select: { id: true, clientId: true },
  });
  if (study === null) {
    throw new QuoteAccessError(`Study not found: ${studyId}`);
  }

  const membership = await tx.countryAssignment.findFirst({
    where: { studyId, country, researcherId: principal.userId },
    select: { id: true },
  });
  if (membership === null) {
    throw new QuoteAccessError(
      `Not assigned to Country "${country}" — ask the Engagement Manager`,
    );
  }

  const marketQuoteNumber = await allocateMarketQuoteNumber(
    tx,
    studyId,
    study.clientId,
    country,
  );
  return tx.marketQuote.create({
    data: {
      studyId,
      clientId: study.clientId,
      country,
      marketQuoteNumber,
      createdById: principal.userId,
      ...toData(header),
    },
    select: { id: true, marketQuoteNumber: true },
  });
}

/**
 * Seed a new Draft Market Quote from a Quote Group selection: the dealer document
 * plus one blank Draft [[Quote Line]] per selected Benchmark Item, all in ONE
 * transaction so a mid-loop failure rolls the whole document back (no half-seeded
 * document, ADR-0038). The group number is a non-persisted lens — nothing about the
 * grouping is stored; only the Market Quote and its lines are. Filing each line
 * auto-claims its unclaimed part first-come via {@link addQuoteLineTx} (#138). The
 * dealer + batch step's transient values are stamped onto every line at creation by
 * passing one document-uniform `fields` (ADR-0038, #141) — batch stays a stateless
 * writer (ADR-0036): nothing batch-level is persisted, the fields land line-level.
 * `fields` defaults to blank, so a part added in a later session inherits no defaults.
 */
export async function seedMarketQuote(
  principal: Principal,
  studyId: string,
  country: string,
  header: MarketQuoteHeaderFields,
  itemIds: readonly string[],
  fields: QuoteLineFields = {},
): Promise<{ readonly id: string; readonly marketQuoteNumber: number }> {
  return withTenant(principal, async (tx) => {
    const doc = await createMarketQuoteTx(tx, principal, studyId, country, header);
    for (const itemId of itemIds) {
      await addQuoteLineTx(tx, principal, doc.id, itemId, fields);
    }
    return doc;
  });
}

/**
 * Add a Draft Quote Line to a Market Quote, allocating its (flat) Quote Line
 * Number. Owner-only: only the document's author may add lines (a Market Quote is
 * single-author; ADR-0026). The Benchmark Item must be in the SAME (study, country)
 * as the document, and there may be at most one line per item per document — the
 * @@unique(marketQuoteId, benchmarkItemId) backstop surfaces a duplicate as an
 * access error. The line's scope (studyId/country/clientId/createdById) is
 * denormalized from the parent document on insert (ADR-0026).
 */
export async function addQuoteLine(
  principal: Principal,
  marketQuoteId: string,
  benchmarkItemId: string,
  fields: QuoteLineFields = {},
): Promise<{ readonly id: string; readonly quoteLineNumber: number }> {
  return withTenant(principal, (tx) =>
    addQuoteLineTx(tx, principal, marketQuoteId, benchmarkItemId, fields),
  );
}

/** The transactional body of {@link addQuoteLine}, factored out so the Quote Group
 *  seed ({@link seedMarketQuote}) can file many lines in one transaction — the
 *  implicit first-come Primary-Researcher claim (#138) thus lives in ONE place. */
async function addQuoteLineTx(
  tx: TenantClient,
  principal: Principal,
  marketQuoteId: string,
  benchmarkItemId: string,
  fields: QuoteLineFields,
): Promise<{ readonly id: string; readonly quoteLineNumber: number }> {
  if (!canCreateQuote(principal)) {
    throw new QuoteAccessError("Only Researchers may add a Quote Line");
  }

  {
    const doc = await tx.marketQuote.findUnique({
      where: { id: marketQuoteId },
      select: { id: true, studyId: true, country: true, clientId: true, createdById: true },
    });
    if (doc === null) {
      throw new QuoteAccessError(`Market Quote not found: ${marketQuoteId}`);
    }
    if (doc.createdById !== principal.userId) {
      throw new QuoteAccessError("Only the document's author may add a Quote Line");
    }

    const item = await tx.benchmarkItem.findUnique({
      where: { id: benchmarkItemId },
      select: { id: true, studyId: true, country: true },
    });
    if (item === null) {
      throw new QuoteAccessError(`Benchmark Item not found: ${benchmarkItemId}`);
    }
    if (item.studyId !== doc.studyId || item.country !== doc.country) {
      throw new QuoteAccessError(
        "Benchmark Item is not in this Market Quote's study and country",
      );
    }

    const quoteLineNumber = await allocateQuoteLineNumber(
      tx,
      doc.studyId,
      doc.clientId,
      doc.country,
    );
    try {
      const line = await tx.quoteLine.create({
        data: {
          marketQuoteId,
          benchmarkItemId,
          clientId: doc.clientId,
          studyId: doc.studyId,
          country: doc.country,
          createdById: principal.userId,
          quoteLineNumber,
          state: "Draft",
          ...toData(fields),
        },
        select: { id: true, quoteLineNumber: true },
      });

      // Claiming is implicit: doing the work (filing a line) makes the filer the
      // item's Primary Researcher if it is still unclaimed (ADR-0038). First-come
      // and no-takeover — the conditional write only matches while the lead is
      // NULL, so a concurrent second filer's claim no-ops and the original Primary
      // stands. Authorship (createdById) is independent and untouched. The
      // cross-Country boundary is already held: the item shares the document's
      // Country and the author was assignment-gated at createMarketQuote (ADR-0025).
      await tx.benchmarkItem.updateMany({
        where: { id: benchmarkItemId, primaryResearcherId: null },
        data: { primaryResearcherId: principal.userId },
      });

      return line;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new QuoteAccessError(
          "This Market Quote already has a Quote Line for that Benchmark Item",
        );
      }
      throw error;
    }
  }
}

/**
 * Edit a Draft Quote Line's fields. Owner-only and Draft-only: the document's
 * author may edit only while the line is still a Draft (a Submitted line is
 * immutable to the researcher — corrections come via rejection).
 */
export async function updateDraftLine(
  principal: Principal,
  lineId: string,
  fields: QuoteLineFields,
): Promise<void> {
  await withTenant(principal, async (tx) => {
    await requireOwnDraftLine(tx, principal, lineId);
    await tx.quoteLine.update({ where: { id: lineId }, data: toData(fields) });
  });
}

/**
 * Batch line-fill (ADR-0036): stamp a partial group of line fields onto EVERY
 * Draft line of a Market Quote in one write — a Researcher convenience that spares
 * per-line retyping when a dealer gives the same answer for every item. Generic in
 * the group: it accepts any subset of QuoteLineFields, so later slices add field
 * groups with no change here. Gated identically to `updateDraftLine` but at the
 * DOCUMENT level: owner-only (the author who created the document — every Draft
 * line on a document shares that author, since `addQuoteLine` is author-only) and
 * Draft-only (the `state: "Draft"` filter leaves Submitted/Approved/Rejected
 * siblings untouched). Overwrite-all, not fill-blanks — a stamped value replaces a
 * line's current one, and a blank in the group clears it (`toData` writes null/""
 * through, omitting only `undefined`). It is a writer, not a relocation: the fields
 * stay line-level and per-line edit remains the override path. No new validation
 * (the document submit gate still catches half-pairs), no audit event, no
 * notification — Draft writes are not in the audited set and push nothing.
 *
 * The apply targets a chosen subset of the document's Draft lines (#151 / ADR-0039):
 * `lineIds` narrows the `updateMany` to the **intersection** of the requested ids
 * with {this document's Draft lines owned by the principal}. Ids that are foreign or
 * no longer writable (submitted in another tab) simply fail the `id IN (…)` filter and
 * are **dropped without error** — the owner/Draft gate above stays authoritative, the
 * subset only narrows which rows it writes. An empty `lineIds` writes nothing (0). The
 * caller always passes an explicit set — there is no "empty means all" path (ADR-0039);
 * "all" is every id. Returns the count actually written.
 */
export async function batchUpdateDraftLines(
  principal: Principal,
  marketQuoteId: string,
  group: QuoteLineFields,
  lineIds: string[],
): Promise<number> {
  return withTenant(principal, async (tx) => {
    if (!isInternal(principal)) {
      throw new QuoteAccessError("Internal staff only");
    }
    const doc = await tx.marketQuote.findUnique({
      where: { id: marketQuoteId },
      select: { createdById: true },
    });
    if (doc === null) {
      throw new QuoteAccessError(`Market Quote not found: ${marketQuoteId}`);
    }
    if (doc.createdById !== principal.userId) {
      throw new QuoteAccessError("Only the document's author may batch-fill its lines");
    }
    const result = await tx.quoteLine.updateMany({
      where: { id: { in: lineIds }, marketQuoteId, state: "Draft" },
      data: toData(group),
    });
    return result.count;
  });
}

/**
 * Edit a Draft Market Quote's document header (source/date/currency). Owner-only
 * and unconverted-only (#97): the author may change the shared facts ONLY while
 * the document has never been submitted (`conversionStatus === null`). Once
 * submitted the Exchange Rate is pinned to the Date Quote Received (ADR-0004), so
 * the header — the date especially — is frozen; a converted document is refused.
 */
export async function updateMarketQuote(
  principal: Principal,
  marketQuoteId: string,
  header: MarketQuoteHeaderFields,
): Promise<void> {
  validateHeaderWrite(header);
  await withTenant(principal, async (tx) => {
    const doc = await tx.marketQuote.findUnique({
      where: { id: marketQuoteId },
      select: { createdById: true, conversionStatus: true },
    });
    if (doc === null) {
      throw new QuoteAccessError(`Market Quote not found: ${marketQuoteId}`);
    }
    if (doc.createdById !== principal.userId) {
      throw new QuoteAccessError("Only the document's author may edit its header");
    }
    if (doc.conversionStatus !== null) {
      throw new QuoteAccessError(
        "A submitted Market Quote's header is locked — its exchange rate is pinned to the date",
      );
    }
    await tx.marketQuote.update({ where: { id: marketQuoteId }, data: toData(header) });
  });
}

/**
 * Hard-delete a Draft Quote Line (discard). Owner-only and Draft-only. The
 * sequence's `quoteLineSeq` is NOT rewound, so the discarded number becomes a
 * permanent gap and is never reused (ADR-0026).
 */
export async function deleteDraftLine(principal: Principal, lineId: string): Promise<void> {
  await withTenant(principal, async (tx) => {
    await requireOwnDraftLine(tx, principal, lineId);
    await tx.quoteLine.delete({ where: { id: lineId } });
  });
}

/**
 * List the Quote Lines on a Benchmark Item that the caller may read (issue #8 read
 * AC, ported). Internal staff only. Draft privacy (ADR-0011): the caller sees their
 * own lines in any state, plus other authors' lines only once they have left Draft.
 */
export async function listLinesForItem(
  principal: Principal,
  itemId: string,
): Promise<QuoteLineView[]> {
  if (!isInternal(principal)) {
    throw new QuoteAccessError("Internal staff only");
  }
  const rows = await withTenant(principal, (tx) =>
    tx.quoteLine.findMany({
      where: {
        benchmarkItemId: itemId,
        OR: [{ createdById: principal.userId }, { state: { not: "Draft" } }],
      },
      select: QUOTE_LINE_VIEW_SELECT,
      orderBy: { quoteLineNumber: "asc" },
    }),
  );
  return rows.map(({ createdBy, marketQuote, ...r }) => ({
    ...r,
    authorName: createdBy.name,
    currency: marketQuote.currency,
    price: r.price === null ? null : r.price.toString(),
  }));
}

/** One Draft line in a document group, shaped for the researcher's submit panel. */
export interface DraftMarketQuoteGroupLine {
  readonly lineId: string;
  readonly quoteLineNumber: number;
  readonly benchmarkItemId: string;
  /** "<Client Item Number> <item description>" — the row's human handle. */
  readonly itemLabel: string;
  readonly competitorBrand: string | null;
  readonly price: string | null;
  readonly quantityQuoted: number | null;
  /** Warranty Offered? gate, carried so an edit round-trips it — null blocks submit
   *  (ADR-0037). When not Yes the pairs below are absent (cleared on save). */
  readonly warrantyOffered: boolean | null;
  /** Warranty pairs, carried so an edit round-trips them — a half pair blocks the
   *  document's submit (ADR-0034) and editing the line is how it gets fixed. */
  readonly warranty1Value: string | null;
  readonly warranty1Unit: string | null;
  readonly warranty2Value: string | null;
  readonly warranty2Unit: string | null;
  /** Discount chain, carried so an edit round-trips it. Advisory metadata: the
   *  value is a recorded percentage (15 = 15%), never applied to the price. */
  readonly discountAvailable: boolean | null;
  readonly discountApplied: boolean | null;
  readonly discountValue: string | null;
  readonly discountType: string | null;
  /** Shipping Lead Time pair + Landed Cost, carried so an edit round-trips them. The
   *  lead-time pair gates submit on coherence; Landed Cost is required cross-border
   *  and editing the line is how either gap gets fixed (ADR-0035). */
  readonly leadTimeValue: string | null;
  readonly leadTimeUnit: string | null;
  readonly landedCostIncluded: boolean | null;
  readonly landedCostNote: string | null;
  /** The author's existing Justification, round-tripped into the edit field (ADR-0014). */
  readonly justification: string | null;
  /** True when this line was returned to its author for a Justification (its price
   *  is flagged against the hidden Client Price) — the only case the editor shows
   *  the Justification field. The Client Price itself never crosses to the client. */
  readonly flagged: boolean;
}

/** A researcher's own Draft Market Quote as the document-grouped view renders it
 *  (#97): the document facts plus ONLY its Draft lines (the set its Submit moves). */
export interface DraftMarketQuoteGroup {
  readonly marketQuoteId: string;
  readonly marketQuoteNumber: number;
  readonly country: string;
  readonly sourceName: string | null;
  readonly sourceCountry: string | null;
  readonly sourceLocality: string | null;
  readonly sourceUrl: string | null;
  readonly currency: string | null;
  readonly dateQuoteReceived: Date | null;
  /** Null ⇔ never submitted — the header is editable only then (`updateMarketQuote`). */
  readonly conversionStatus: ConversionStatus | null;
  readonly lines: readonly DraftMarketQuoteGroupLine[];
  /** Every Benchmark Item already on the document (ANY state) — the items a new
   *  line may NOT be added for (one line per item per document, in any state). */
  readonly itemIdsOnDocument: readonly string[];
}

/**
 * List a Researcher's own Draft Market Quotes in a study, grouped by document for
 * the document-grouped submit view (#97). Scope: documents the caller AUTHORED
 * (`createdById`) that still hold at least one Draft line — a fresh all-Draft
 * document OR one with a single line revised back to Draft after a rejection. Each
 * group carries only its Draft lines (the exact set the bulk Submit acts on);
 * Submitted/Approved/Rejected siblings stay in the per-item view. Ordered by
 * Market Quote Number, lines by Quote Line Number.
 */
export async function listDraftMarketQuotesForResearcher(
  principal: Principal,
  studyId: string,
): Promise<DraftMarketQuoteGroup[]> {
  if (!isInternal(principal)) {
    throw new QuoteAccessError("Internal staff only");
  }
  const rows = await withTenant(principal, (tx) =>
    tx.marketQuote.findMany({
      where: {
        studyId,
        createdById: principal.userId,
        quoteLines: { some: { state: "Draft" } },
      },
      select: {
        id: true,
        marketQuoteNumber: true,
        country: true,
        sourceName: true,
        sourceCountry: true,
        sourceLocality: true,
        sourceUrl: true,
        currency: true,
        dateQuoteReceived: true,
        conversionStatus: true,
        // The study default QC Threshold (fraction), the fallback when a line's
        // Benchmark Item has none — needed to decide the per-line flag (ADR-0014).
        study: { select: { qcThreshold: true } },
        quoteLines: {
          orderBy: { quoteLineNumber: "asc" },
          select: {
            id: true,
            state: true,
            quoteLineNumber: true,
            benchmarkItemId: true,
            competitorBrand: true,
            price: true,
            quantityQuoted: true,
            warrantyOffered: true,
            warranty1Value: true,
            warranty1Unit: true,
            warranty2Value: true,
            warranty2Unit: true,
            discountAvailable: true,
            discountApplied: true,
            discountValue: true,
            discountType: true,
            leadTimeValue: true,
            leadTimeUnit: true,
            landedCostIncluded: true,
            landedCostNote: true,
            // The author's existing Justification (round-trips into the edit field)
            // and the inputs that decide whether the field is shown at all (ADR-0014):
            // a flagged Draft line is one returned to its author for justification.
            justification: true,
            convertedUsdPricePerUnit: true,
            benchmarkItem: {
              select: {
                clientItemNumber: true,
                itemDescription: true,
                clientPrice: true,
                qcThreshold: true,
              },
            },
          },
        },
      },
      orderBy: { marketQuoteNumber: "asc" },
    }),
  );
  return rows.map((r) => ({
    marketQuoteId: r.id,
    marketQuoteNumber: r.marketQuoteNumber,
    country: r.country,
    sourceName: r.sourceName,
    sourceCountry: r.sourceCountry,
    sourceLocality: r.sourceLocality,
    sourceUrl: r.sourceUrl,
    currency: r.currency,
    dateQuoteReceived: r.dateQuoteReceived,
    conversionStatus: r.conversionStatus as ConversionStatus | null,
    // Only the Draft lines are shown (the set the bulk Submit moves); every item on
    // the document — any state — is barred from add-line (one line per item per doc).
    lines: r.quoteLines
      .filter((l) => l.state === "Draft")
      .map((l) => ({
        lineId: l.id,
        quoteLineNumber: l.quoteLineNumber,
        benchmarkItemId: l.benchmarkItemId,
        itemLabel: `${l.benchmarkItem.clientItemNumber} ${l.benchmarkItem.itemDescription}`,
        competitorBrand: l.competitorBrand,
        price: l.price === null ? null : l.price.toString(),
        quantityQuoted: l.quantityQuoted,
        warrantyOffered: l.warrantyOffered,
        warranty1Value: l.warranty1Value === null ? null : l.warranty1Value.toString(),
        warranty1Unit: l.warranty1Unit,
        warranty2Value: l.warranty2Value === null ? null : l.warranty2Value.toString(),
        warranty2Unit: l.warranty2Unit,
        discountAvailable: l.discountAvailable,
        discountApplied: l.discountApplied,
        discountValue: l.discountValue === null ? null : l.discountValue.toString(),
        discountType: l.discountType,
        leadTimeValue: l.leadTimeValue === null ? null : l.leadTimeValue.toString(),
        leadTimeUnit: l.leadTimeUnit,
        landedCostIncluded: l.landedCostIncluded,
        landedCostNote: l.landedCostNote,
        justification: l.justification,
        // True only for a line returned to its author for justification: a Draft
        // line is flagged only after it was submitted, converted, and revised back
        // (a fresh Draft has no USD yet, so is never flagged) — ADR-0014.
        flagged: isLineFlagged({
          usdPricePerUnit:
            l.convertedUsdPricePerUnit === null ? null : Number(l.convertedUsdPricePerUnit),
          clientPrice:
            l.benchmarkItem.clientPrice === null ? null : Number(l.benchmarkItem.clientPrice),
          itemThreshold:
            l.benchmarkItem.qcThreshold === null ? null : Number(l.benchmarkItem.qcThreshold),
          studyThreshold: Number(r.study.qcThreshold),
        }),
      })),
    itemIdsOnDocument: r.quoteLines.map((l) => l.benchmarkItemId),
  }));
}

/** One currently-Rejected line on the researcher's Needs-attention surface (#139,
 *  ADR-0038): the author's own line awaiting revision, carrying the rejection
 *  context the inbox shows (study/country/MQ#/line#, the analyst's reason) plus the
 *  item label to triage which part to fix. `studyId` lets the row build the same
 *  deep-link as the rejection Notification (`/studies/<id>#line-<n>`). NEVER carries
 *  a Client Price — the list computes no flag, so the benchmark never crosses to a
 *  researcher (ADR-0003). */
export interface RejectedLineView {
  readonly lineId: string;
  readonly studyId: string;
  readonly country: string;
  readonly marketQuoteNumber: number;
  readonly quoteLineNumber: number;
  /** "<Client Item Number> <item description>" — the row's human handle. */
  readonly itemLabel: string;
  /** The analyst's snapshotted rejection reason (cleared on resubmit, so always
   *  present here — a Rejected line has not been revised). For a flagged line it
   *  states only the divergence direction, never the Client Price (ADR-0003). */
  readonly reason: string | null;
  readonly reviewedAt: Date | null;
}

/**
 * List a Researcher's own currently-Rejected Quote Lines in a study — the
 * Needs-attention surface (#139, ADR-0038's third researcher surface). Scope: lines
 * the caller AUTHORED (`createdById`) whose `state` is still Rejected; revising one
 * (Rejected→Draft) drops it from this list and surfaces it in the Drafts view
 * instead. Read straight off the Quote Line (its `state` is the canonical truth and
 * `rejectionReason` the frozen reason), NOT the transient Notification outbox
 * (ADR-0020/0031) — so "revised ⇒ gone" needs no newest-per-line dismissal dance.
 * Ordered newest-verdict-first (`reviewedAt desc`). No Client Price is selected
 * (ADR-0003).
 */
export async function listRejectedLinesForResearcher(
  principal: Principal,
  studyId: string,
): Promise<RejectedLineView[]> {
  if (!isInternal(principal)) {
    throw new QuoteAccessError("Internal staff only");
  }
  const rows = await withTenant(principal, (tx) =>
    tx.quoteLine.findMany({
      where: { studyId, createdById: principal.userId, state: "Rejected" },
      select: {
        id: true,
        country: true,
        quoteLineNumber: true,
        rejectionReason: true,
        reviewedAt: true,
        marketQuote: { select: { marketQuoteNumber: true } },
        benchmarkItem: { select: { clientItemNumber: true, itemDescription: true } },
      },
      orderBy: { reviewedAt: "desc" },
    }),
  );
  return rows.map((r) => ({
    lineId: r.id,
    studyId,
    country: r.country,
    marketQuoteNumber: r.marketQuote.marketQuoteNumber,
    quoteLineNumber: r.quoteLineNumber,
    itemLabel: `${r.benchmarkItem.clientItemNumber} ${r.benchmarkItem.itemDescription}`,
    reason: r.rejectionReason,
    reviewedAt: r.reviewedAt,
  }));
}

/**
 * Bulk-submit a Market Quote document (#88, ADR-0026): the ONE bulk transition.
 * Owner-only. Every Draft line in the document moves Draft→Submitted together,
 * all-or-nothing — the pure `submitDocument` guard validates the shared document
 * facts once (a missing currency fails every line) and each line's own facts, and
 * if any Draft line is incomplete nothing transitions (the caller gets the per-line
 * missing-field report). Non-Draft siblings (from a prior revise loop) are untouched.
 *
 * Conversion (ADR-0026/0028): the Conversion Status machine decides the document's
 * move — an unconverted document becomes `pending` (the deferred sweep pins one rate
 * once its date closes); an already-`auto`/`manual` document is NOT re-pinned, but
 * each just-submitted line's USD is RE-DERIVED from the pinned rate (a corrected
 * price never leaves a stale USD — ADR-0028). One `submit` Audit Event per document,
 * subject the Market Quote.
 */
export async function submitMarketQuote(
  principal: Principal,
  marketQuoteId: string,
): Promise<SubmitDocumentResult> {
  if (!isInternal(principal)) {
    throw new QuoteAccessError("Internal staff only");
  }
  return withTenant(principal, async (tx) => {
    const doc = await tx.marketQuote.findUnique({
      where: { id: marketQuoteId },
      select: {
        createdById: true,
        studyId: true,
        country: true,
        sourceName: true,
        sourceCountry: true,
        sourceLocality: true,
        currency: true,
        dateQuoteReceived: true,
        conversionStatus: true,
        exchangeRate: true,
        quoteLines: {
          select: {
            id: true,
            state: true,
            competitorBrand: true,
            price: true,
            quantityQuoted: true,
            // Warranty + lead-time pairs gate submit on coherence (ADR-0034/0035);
            // landed cost is conditionally required cross-border (ADR-0035); the
            // Warranty Offered? gate is required on presence (ADR-0037).
            warrantyOffered: true,
            warranty1Value: true,
            warranty1Unit: true,
            warranty2Value: true,
            warranty2Unit: true,
            leadTimeValue: true,
            leadTimeUnit: true,
            landedCostIncluded: true,
          },
        },
      },
    });
    if (doc === null) {
      throw new QuoteAccessError(`Market Quote not found: ${marketQuoteId}`);
    }
    if (doc.createdById !== principal.userId) {
      throw new QuoteAccessError("Only the author may submit their Market Quote");
    }

    const header: DocumentHeader = {
      sourceName: doc.sourceName,
      sourceCountry: doc.sourceCountry,
      sourceLocality: doc.sourceLocality,
      currency: doc.currency,
      dateQuoteReceived: doc.dateQuoteReceived,
    };
    const lines: SubmittableLine[] = doc.quoteLines.map((l) => ({
      lineId: l.id,
      state: l.state as SubmittableLine["state"],
      competitorBrand: l.competitorBrand,
      price: l.price === null ? null : Number(l.price),
      quantityQuoted: l.quantityQuoted,
      warrantyOffered: l.warrantyOffered,
      warranty1Value: l.warranty1Value === null ? null : Number(l.warranty1Value),
      warranty1Unit: l.warranty1Unit,
      warranty2Value: l.warranty2Value === null ? null : Number(l.warranty2Value),
      warranty2Unit: l.warranty2Unit,
      leadTimeValue: l.leadTimeValue === null ? null : Number(l.leadTimeValue),
      leadTimeUnit: l.leadTimeUnit,
      landedCostIncluded: l.landedCostIncluded,
    }));

    const result = submitDocument({ header, marketCountry: doc.country, lines });
    if (!result.ok) return result;

    // Move every targeted Draft line to Submitted under a state guard.
    await tx.quoteLine.updateMany({
      where: { id: { in: [...result.toSubmit] }, state: "Draft" },
      data: {
        state: "Submitted",
        submittedAt: new Date(),
        rejectionReason: null,
        reviewedById: null,
        reviewedAt: null,
      },
    });

    // The document's conversion move. `changed` ⇒ null→pending (guard on null so a
    // concurrent pin is never clobbered). An already-auto/manual document stays put
    // (sticky) but its just-submitted lines need their USD re-derived from the
    // pinned rate (ADR-0028).
    const conversion = nextConversionStatus(doc.conversionStatus, { kind: "submit" });
    if (conversion.ok && conversion.changed) {
      await tx.marketQuote.updateMany({
        where: { id: marketQuoteId, conversionStatus: null },
        data: { conversionStatus: "pending" },
      });
    } else if (
      conversion.ok &&
      (conversion.status === "auto" || conversion.status === "manual") &&
      doc.exchangeRate !== null
    ) {
      const rate = Number(doc.exchangeRate);
      const date = doc.dateQuoteReceived as Date;
      await Promise.all(
        doc.quoteLines
          .filter((l) => result.toSubmit.includes(l.id))
          .map((l) => {
            const pinned = convertManual(
              {
                price: Number(l.price),
                currency: doc.currency as string,
                quantityQuoted: l.quantityQuoted,
                dateQuoteReceived: date,
              },
              rate,
            );
            return tx.quoteLine.update({
              where: { id: l.id },
              data: {
                convertedUsdPrice: pinned.convertedUsdPrice,
                convertedUsdPricePerUnit: pinned.convertedUsdPricePerUnit,
              },
            });
          }),
      );
    }

    await recordAuditEvents(tx, [
      auditDocumentSubmit({
        actorId: principal.userId,
        studyId: doc.studyId,
        marketQuoteId,
      }),
    ]);
    return result;
  });
}

/** One row of the analyst review queue (#11), ported to the line: the Quote Line
 *  plus its parent document and Benchmark Item context and the computed QC flag. */
export interface ReviewQueueItem {
  readonly id: string;
  /** The parent document — the manual-rate override is per Market Quote (ADR-0026). */
  readonly marketQuoteId: string;
  readonly quoteLineNumber: number;
  readonly competitorBrand: string | null;
  readonly sourceName: string | null;
  readonly sourceCountry: string | null;
  readonly sourceLocality: string | null;
  readonly price: string | null;
  readonly currency: string | null;
  readonly quantityQuoted: number | null;
  readonly convertedUsdPrice: string | null;
  readonly convertedUsdPricePerUnit: string | null;
  readonly conversionStatus: "pending" | "auto" | "manual" | null;
  readonly justification: string | null;
  readonly submittedAt: Date | null;
  readonly authorName: string;
  readonly studyName: string;
  readonly clientName: string;
  readonly country: string;
  readonly clientItemNumber: string;
  readonly itemDescription: string;
  readonly clientPrice: string | null;
  readonly qcThreshold: string;
  readonly flag: PriceFlagResult;
}

/**
 * Just the depth of the analyst review queue — how many Quote Lines sit Submitted
 * across all studies and tenants. Analyst-only.
 */
export async function countReviewQueue(principal: Principal): Promise<number> {
  if (!canReviewQuote(principal)) {
    throw new QuoteAccessError("Only Analysts may review quotes");
  }
  return withTenant(principal, (tx) => tx.quoteLine.count({ where: { state: "Submitted" } }));
}

/**
 * How many Quote Lines the signed-in researcher has in a given state, keyed to
 * `createdById = me`. Self-scoped by construction, so no role gate beyond
 * isInternal. Spans all studies/tenants (researchers are not tenant-scoped).
 */
async function countMyLinesInState(
  principal: Principal,
  state: "Rejected" | "Draft",
): Promise<number> {
  if (!isInternal(principal)) {
    throw new QuoteAccessError("Internal staff only");
  }
  return withTenant(principal, (tx) =>
    tx.quoteLine.count({ where: { state, createdById: principal.userId } }),
  );
}

/** Count of the researcher's own Rejected Quote Lines — the most actionable signal. */
export function countMyRejectedLines(principal: Principal): Promise<number> {
  return countMyLinesInState(principal, "Rejected");
}

/** Count of the researcher's own Draft Quote Lines — work in progress. */
export function countMyDraftLines(principal: Principal): Promise<number> {
  return countMyLinesInState(principal, "Draft");
}

/**
 * Per-Benchmark-Item layered progress for the Collect surface (#142): for each
 * item in the study that has any line, its **approved** count (ALL authors — the
 * canonical [[Release Eligibility]] figure; line-count = distinct-Market-Quote
 * count under the `(marketQuote, item)` uniqueness) and the **caller's own**
 * in-flight (Draft/Submitted) count. A Rejected line counts toward neither. Two
 * `groupBy` reads, folded into one map keyed by `benchmarkItemId`; an item with no
 * line is simply absent (the pure `quoteGroups` defaults it to zero). Internal-only
 * and self-scoped on the in-flight half (`createdById = me`); approved is unscoped
 * by author by design. No Client Price is touched (ADR-0003 safe — counts only).
 */
export async function countPartProgressForResearcher(
  principal: Principal,
  studyId: string,
): Promise<Map<string, PartProgress>> {
  if (!isInternal(principal)) {
    throw new QuoteAccessError("Internal staff only");
  }
  return withTenant(principal, async (tx) => {
    const [approved, mine] = await Promise.all([
      tx.quoteLine.groupBy({
        by: ["benchmarkItemId"],
        where: { studyId, state: "Approved" },
        _count: { _all: true },
      }),
      tx.quoteLine.groupBy({
        by: ["benchmarkItemId"],
        where: {
          studyId,
          state: { in: ["Draft", "Submitted"] },
          createdById: principal.userId,
        },
        _count: { _all: true },
      }),
    ]);

    const progress = new Map<string, PartProgress>();
    const ensure = (id: string): { approvedCount: number; myInFlightCount: number } => {
      let row = progress.get(id) as { approvedCount: number; myInFlightCount: number } | undefined;
      if (row === undefined) {
        row = { approvedCount: 0, myInFlightCount: 0 };
        progress.set(id, row);
      }
      return row;
    };
    for (const g of approved) ensure(g.benchmarkItemId).approvedCount = g._count._all;
    for (const g of mine) ensure(g.benchmarkItemId).myInFlightCount = g._count._all;
    return progress;
  });
}

/**
 * The analyst review queue: every Submitted Quote Line across all studies and
 * tenants, oldest-submitted first (FIFO by `submittedAt`). Analyst-only. Each row
 * carries the computed QC flag (ADR-0014): a line whose document is pending is
 * `comparable: false`; an auto/manual document's lines are compared against the
 * item's Client Price using the resolved QC Threshold.
 */
export async function listReviewQueue(principal: Principal): Promise<ReviewQueueItem[]> {
  if (!canReviewQuote(principal)) {
    throw new QuoteAccessError("Only Analysts may review quotes");
  }
  const rows = await withTenant(principal, (tx) =>
    tx.quoteLine.findMany({
      where: { state: "Submitted" },
      orderBy: { submittedAt: "asc" },
      select: {
        id: true,
        marketQuoteId: true,
        quoteLineNumber: true,
        competitorBrand: true,
        price: true,
        quantityQuoted: true,
        convertedUsdPrice: true,
        convertedUsdPricePerUnit: true,
        justification: true,
        submittedAt: true,
        createdBy: { select: { name: true } },
        marketQuote: {
          select: {
            sourceName: true,
            sourceCountry: true,
            sourceLocality: true,
            currency: true,
            conversionStatus: true,
          },
        },
        benchmarkItem: {
          select: {
            country: true,
            clientItemNumber: true,
            itemDescription: true,
            clientPrice: true,
            qcThreshold: true,
            study: { select: { name: true, qcThreshold: true, client: { select: { name: true } } } },
          },
        },
      },
    }),
  );

  return rows.map((r) => {
    const usdPerUnit =
      r.convertedUsdPricePerUnit === null ? null : Number(r.convertedUsdPricePerUnit);
    const clientPrice =
      r.benchmarkItem.clientPrice === null ? null : Number(r.benchmarkItem.clientPrice);
    const threshold = resolveQcThreshold(
      r.benchmarkItem.qcThreshold === null ? null : Number(r.benchmarkItem.qcThreshold),
      Number(r.benchmarkItem.study.qcThreshold),
    );
    const flag = evaluatePriceFlag({ usdPricePerUnit: usdPerUnit, clientPrice, threshold });
    return {
      id: r.id,
      marketQuoteId: r.marketQuoteId,
      quoteLineNumber: r.quoteLineNumber,
      competitorBrand: r.competitorBrand,
      sourceName: r.marketQuote.sourceName,
      sourceCountry: r.marketQuote.sourceCountry,
      sourceLocality: r.marketQuote.sourceLocality,
      price: r.price === null ? null : r.price.toString(),
      currency: r.marketQuote.currency,
      quantityQuoted: r.quantityQuoted,
      convertedUsdPrice: r.convertedUsdPrice === null ? null : r.convertedUsdPrice.toString(),
      convertedUsdPricePerUnit:
        r.convertedUsdPricePerUnit === null ? null : r.convertedUsdPricePerUnit.toString(),
      conversionStatus: r.marketQuote.conversionStatus,
      justification: r.justification,
      submittedAt: r.submittedAt,
      authorName: r.createdBy.name,
      studyName: r.benchmarkItem.study.name,
      clientName: r.benchmarkItem.study.client.name,
      country: r.benchmarkItem.country,
      clientItemNumber: r.benchmarkItem.clientItemNumber,
      itemDescription: r.benchmarkItem.itemDescription,
      clientPrice:
        r.benchmarkItem.clientPrice === null ? null : r.benchmarkItem.clientPrice.toString(),
      qcThreshold: threshold.toString(),
      flag,
    };
  });
}

/**
 * Approve a Submitted Quote Line (Analyst verdict). The approve guard is the pure
 * core's: blocked while the parent document's conversion is `pending` (ADR-0013),
 * and — if the line is flagged against its Client Price — blocked until the author
 * has supplied a Justification (ADR-0014). Pinned under a `state = Submitted` guard.
 */
export async function approveLine(
  principal: Principal,
  lineId: string,
): Promise<TransitionResult> {
  if (!canReviewQuote(principal)) {
    throw new QuoteAccessError("Only Analysts may review quotes");
  }
  return withTenant(principal, async (tx) => {
    const line = await tx.quoteLine.findUnique({
      where: { id: lineId },
      select: {
        state: true,
        studyId: true,
        convertedUsdPricePerUnit: true,
        justification: true,
        marketQuote: { select: { conversionStatus: true } },
        benchmarkItem: {
          select: {
            clientPrice: true,
            qcThreshold: true,
            study: { select: { qcThreshold: true } },
          },
        },
      },
    });
    if (line === null) {
      throw new QuoteAccessError(`Quote Line not found: ${lineId}`);
    }

    const flagged = isLineFlagged({
      usdPricePerUnit:
        line.convertedUsdPricePerUnit === null ? null : Number(line.convertedUsdPricePerUnit),
      clientPrice:
        line.benchmarkItem.clientPrice === null ? null : Number(line.benchmarkItem.clientPrice),
      itemThreshold:
        line.benchmarkItem.qcThreshold === null ? null : Number(line.benchmarkItem.qcThreshold),
      studyThreshold: Number(line.benchmarkItem.study.qcThreshold),
    });
    const hasJustification = line.justification !== null && line.justification.trim() !== "";

    const result = transition(line.state, {
      kind: "approve",
      conversionStatus: line.marketQuote.conversionStatus,
      flagged,
      hasJustification,
    });
    if (!result.ok) return result;

    const applied = await tx.quoteLine.updateMany({
      where: { id: lineId, state: "Submitted" },
      data: { state: "Approved", reviewedById: principal.userId, reviewedAt: new Date() },
    });
    if (applied.count === 1) {
      await recordAuditEvents(tx, [
        auditQuoteLifecycle("approve", {
          actorId: principal.userId,
          studyId: line.studyId,
          lineId,
        }),
      ]);
    }
    return result;
  });
}

/** Outcome of a manual rate override: success, or a user-fixable rejection. */
export type SetManualRateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "invalid-rate" | "not-pending" };

/**
 * Set a manual Exchange Rate on a Market Quote whose conversion is `pending` (#70 /
 * ADR-0023/0026) — the analyst's escape hatch for a currency the provider doesn't
 * cover. The rate now lives on the DOCUMENT (one rate for every line), so this
 * derives each line's USD figures from that single rate and pins the rate + status
 * on the document. Analyst-gated. Sticky: the guarded update only fires while
 * `conversionStatus = pending`. The override is one `manualRateOverride` Audit Event
 * (subject = Market Quote) carrying the document-total USD as `after` (ADR-0023).
 */
export async function setMarketQuoteManualRate(
  principal: Principal,
  marketQuoteId: string,
  rateInput: string | number,
): Promise<SetManualRateResult> {
  if (!canReviewQuote(principal)) {
    throw new QuoteAccessError("Only Analysts may set a manual exchange rate");
  }
  const parsed = parseManualRate(rateInput);
  if (!parsed.ok) return { ok: false, reason: "invalid-rate" };

  return withTenant(principal, async (tx) => {
    const doc = await tx.marketQuote.findUnique({
      where: { id: marketQuoteId },
      select: {
        conversionStatus: true,
        currency: true,
        dateQuoteReceived: true,
        studyId: true,
        quoteLines: { select: { id: true, price: true, quantityQuoted: true } },
      },
    });
    if (doc === null) {
      throw new QuoteAccessError(`Market Quote not found: ${marketQuoteId}`);
    }
    if (doc.conversionStatus !== "pending") {
      return { ok: false, reason: "not-pending" };
    }

    // Derive each line's USD from the one document rate; sum the totals for the
    // audit `after` (ADR-0023: the money that moved across the whole document).
    let total = 0;
    let pinnedRateDate: Date | null = null;
    let pinnedRate = parsed.rate;
    const lineUpdates = doc.quoteLines.map((line) => {
      const pinned = convertManual(
        {
          price: Number(line.price),
          currency: doc.currency ?? "",
          quantityQuoted: line.quantityQuoted,
          dateQuoteReceived: doc.dateQuoteReceived as Date,
        },
        parsed.rate,
      );
      total += Number(pinned.convertedUsdPrice);
      pinnedRateDate = pinned.rateDate;
      pinnedRate = pinned.exchangeRate;
      return tx.quoteLine.update({
        where: { id: line.id },
        data: {
          convertedUsdPrice: pinned.convertedUsdPrice,
          convertedUsdPricePerUnit: pinned.convertedUsdPricePerUnit,
        },
      });
    });

    // Sticky guard: only a still-pending document is overridden, so a concurrent
    // auto-pin or a second override can't double-apply. The count gates the lines'
    // USD writes and the atomic audit (ADR-0019).
    const applied = await tx.marketQuote.updateMany({
      where: { id: marketQuoteId, conversionStatus: "pending" },
      data: { conversionStatus: "manual", exchangeRate: pinnedRate, rateDate: pinnedRateDate },
    });
    if (applied.count !== 1) {
      return { ok: false, reason: "not-pending" };
    }
    await Promise.all(lineUpdates);
    await recordAuditEvents(tx, [
      auditManualRateOverride({
        actorId: principal.userId,
        studyId: doc.studyId,
        marketQuoteId,
        after: total,
      }),
    ]);
    return { ok: true };
  });
}

/**
 * Reject a Submitted Quote Line with a reason (Analyst verdict). Also the vehicle
 * for "return for justification": the reason states the divergence direction, never
 * the Client Price value (ADR-0003). The reason is required (the core's guard). On
 * success the line returns to its author as Rejected, and the author is notified.
 */
export async function rejectLine(
  principal: Principal,
  lineId: string,
  reason: string,
): Promise<TransitionResult> {
  if (!canReviewQuote(principal)) {
    throw new QuoteAccessError("Only Analysts may review quotes");
  }
  return withTenant(principal, async (tx) => {
    const line = await tx.quoteLine.findUnique({
      where: { id: lineId },
      select: {
        state: true,
        createdById: true,
        studyId: true,
        createdBy: { select: { status: true } },
      },
    });
    if (line === null) {
      throw new QuoteAccessError(`Quote Line not found: ${lineId}`);
    }

    const result = transition(line.state, { kind: "reject", reason });
    if (!result.ok) return result;

    const applied = await tx.quoteLine.updateMany({
      where: { id: lineId, state: "Submitted" },
      data: {
        state: "Rejected",
        rejectionReason: reason,
        reviewedById: principal.userId,
        reviewedAt: new Date(),
      },
    });
    if (applied.count === 1) {
      await recordAuditEvents(tx, [
        auditQuoteLifecycle("reject", {
          actorId: principal.userId,
          studyId: line.studyId,
          lineId,
        }),
      ]);
      // Push the rejection to its AUTHOR (createdById; ADR-0020). Only an active
      // author is notified; a deactivated author is skipped.
      if (line.createdBy.status === "active") {
        await recordNotifications(tx, [
          notifyQuoteRejected({
            recipientId: line.createdById,
            studyId: line.studyId,
            lineId,
            reason,
          }),
        ]);
      }
    }
    return result;
  });
}

/**
 * Revise a Rejected Quote Line back to Draft (the author's return path; ADR-0014).
 * The ONLY way out of Rejected. Owner-only. Clears the FIFO stamp; the Quote Line
 * Number is retained. The revise loop does NOT re-pin conversion — the rate lives
 * on the parent document and stands (ADR-0026). The rejection reason stays visible
 * while the author works the Draft (cleared on resubmit, in submitLine).
 */
export async function reviseLine(
  principal: Principal,
  lineId: string,
): Promise<TransitionResult> {
  if (!isInternal(principal)) {
    throw new QuoteAccessError("Internal staff only");
  }
  return withTenant(principal, async (tx) => {
    const line = await tx.quoteLine.findUnique({
      where: { id: lineId },
      select: { createdById: true, state: true },
    });
    if (line === null) {
      throw new QuoteAccessError(`Quote Line not found: ${lineId}`);
    }
    if (line.createdById !== principal.userId) {
      throw new QuoteAccessError("Only the author may revise their Quote Line");
    }

    const result = transition(line.state, { kind: "revise" });
    if (!result.ok) return result;

    await tx.quoteLine.updateMany({
      where: { id: lineId, state: "Rejected", createdById: principal.userId },
      data: { state: "Draft", submittedAt: null },
    });
    return result;
  });
}

/** Load a Quote Line and assert the caller owns it and it is still a Draft. The
 *  single gate behind every researcher write that mutates an existing line. */
async function requireOwnDraftLine(
  tx: TenantClient,
  principal: Principal,
  lineId: string,
): Promise<void> {
  if (!isInternal(principal)) {
    throw new QuoteAccessError("Internal staff only");
  }
  const line = await tx.quoteLine.findUnique({
    where: { id: lineId },
    select: { createdById: true, state: true },
  });
  if (line === null) {
    throw new QuoteAccessError(`Quote Line not found: ${lineId}`);
  }
  if (line.createdById !== principal.userId) {
    throw new QuoteAccessError("Only the author may edit their Quote Line");
  }
  if (line.state !== "Draft") {
    throw new QuoteAccessError("Only a Draft Quote Line can be edited");
  }
}

/** True for a Prisma unique-constraint violation (P2002), without importing the
 *  Prisma namespace — the @@unique(marketQuoteId, benchmarkItemId) backstop. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/** Map the optional input fields to a Prisma data object, omitting keys not
 *  supplied so an edit only touches the fields it carries. */
function toData(fields: object) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data[key] = value;
  }
  return data;
}
