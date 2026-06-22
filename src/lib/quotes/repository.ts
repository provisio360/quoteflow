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
import { evaluatePriceFlag, type PriceFlagResult } from "@/domains/quotes/price-flag";
import { resolveQcThreshold } from "@/domains/benchmark-items/qc-threshold";
import { convertManual, parseManualRate, nextConversionStatus } from "@/domains/quotes/conversion";
import { recordAuditEvents } from "@/lib/audit/repository";
import { auditQuoteLifecycle, auditDocumentSubmit, auditManualRateOverride } from "@/domains/audit/events";
import { recordNotifications } from "@/lib/notifications/dispatch";
import { notifyQuoteRejected } from "@/domains/notifications/events";

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

/** The document-header fields a Researcher sets when creating a Market Quote. The
 *  owning (studyId, country) are positional, not here. All optional — a Draft
 *  document saves partial data; source/date/currency become required only when its
 *  lines are submitted (validated per line by the lifecycle core). */
export interface MarketQuoteHeaderFields {
  readonly sourceName?: string | null;
  readonly sourceLocation?: string | null;
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
  if (!canCreateQuote(principal)) {
    throw new QuoteAccessError("Only Researchers may create a Market Quote");
  }

  return withTenant(principal, async (tx) => {
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
  if (!canCreateQuote(principal)) {
    throw new QuoteAccessError("Only Researchers may add a Quote Line");
  }

  return withTenant(principal, async (tx) => {
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
      return await tx.quoteLine.create({
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
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new QuoteAccessError(
          "This Market Quote already has a Quote Line for that Benchmark Item",
        );
      }
      throw error;
    }
  });
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
  return rows.map(({ createdBy, ...r }) => ({
    ...r,
    authorName: createdBy.name,
    price: r.price === null ? null : r.price.toString(),
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
        sourceName: true,
        sourceLocation: true,
        currency: true,
        dateQuoteReceived: true,
        conversionStatus: true,
        exchangeRate: true,
        quoteLines: {
          select: { id: true, state: true, competitorBrand: true, price: true, quantityQuoted: true },
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
      sourceLocation: doc.sourceLocation,
      currency: doc.currency,
      dateQuoteReceived: doc.dateQuoteReceived,
    };
    const lines: SubmittableLine[] = doc.quoteLines.map((l) => ({
      lineId: l.id,
      state: l.state as SubmittableLine["state"],
      competitorBrand: l.competitorBrand,
      price: l.price === null ? null : Number(l.price),
      quantityQuoted: l.quantityQuoted,
    }));

    const result = submitDocument({ header, lines });
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
  readonly sourceLocation: string | null;
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
            sourceLocation: true,
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
      sourceLocation: r.marketQuote.sourceLocation,
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

    const flag = evaluatePriceFlag({
      usdPricePerUnit:
        line.convertedUsdPricePerUnit === null ? null : Number(line.convertedUsdPricePerUnit),
      clientPrice:
        line.benchmarkItem.clientPrice === null ? null : Number(line.benchmarkItem.clientPrice),
      threshold: resolveQcThreshold(
        line.benchmarkItem.qcThreshold === null ? null : Number(line.benchmarkItem.qcThreshold),
        Number(line.benchmarkItem.study.qcThreshold),
      ),
    });
    const flagged = flag.comparable && flag.flagged;
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
