import { prisma } from "@/lib/prisma";
import type { Principal } from "@/domains/authz/principal";
import { isInternal } from "@/domains/authz/principal";
import { canCreateQuote, canReviewQuote } from "@/domains/authz/quotes";
import {
  transition,
  type SubmittableQuote,
  type TransitionResult,
} from "@/domains/quotes/lifecycle";
import { evaluatePriceFlag, type PriceFlagResult } from "@/domains/quotes/price-flag";
import { recordAuditEvents } from "@/lib/audit/repository";
import { auditQuoteLifecycle } from "@/domains/audit/events";
import { recordNotifications } from "@/lib/notifications/dispatch";
import { notifyQuoteRejected } from "@/domains/notifications/events";

// Tenant-aware data-access adapter for the Quote lifecycle (issue #8). It owns
// the gates the pure core can't: the Researcher role (canCreateQuote), the
// Country-pool membership check (mirroring self-assign — only the pool may work
// an item), the atomic per-item Quote Number allocation (ADR-0010), owner-only
// writes, and the Draft-privacy read filter (ADR-0011). The Draft→Submitted
// decision and submit-time validation live in src/domains/quotes/lifecycle; this
// layer persists the result.

/** Raised for permission / existence / ownership failures (not user-fixable by
 *  filling in fields — that is the lifecycle core's `missing-fields` result). */
export class QuoteAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteAccessError";
  }
}

/** The editable fields of a Quote. All optional — a Draft saves partial data and
 *  required-ness is enforced only at submit (issue #8). */
export interface QuoteFields {
  readonly competitorBrand?: string | null;
  readonly dealerName?: string | null;
  readonly dealerLocation?: string | null;
  readonly dealerUrl?: string | null;
  readonly price?: number | string | null;
  readonly currency?: string | null;
  readonly quantityQuoted?: number | null;
  readonly stockStatus?: string | null;
  readonly leadTime?: string | null;
  readonly warranty?: string | null;
  readonly discount?: string | null;
  readonly notes?: string | null;
  readonly dateQuoteReceived?: Date | null;
  /** The author's explanation for a flagged price (ADR-0014). Editable while the
   *  quote is a Draft (typically added during a revise after a flag-rejection). */
  readonly justification?: string | null;
}

/** A Quote as a pool member may read it (issue #8 read AC). Client Price is not a
 *  Quote field at all, so there is nothing tenant-sensitive to strip here. */
export interface QuoteView {
  readonly id: string;
  readonly benchmarkItemId: string;
  readonly quoteNumber: number;
  readonly state: "Draft" | "Submitted" | "Approved" | "Rejected";
  readonly createdById: string;
  readonly competitorBrand: string | null;
  readonly dealerName: string | null;
  readonly dealerLocation: string | null;
  readonly dealerUrl: string | null;
  readonly price: string | null;
  readonly currency: string | null;
  readonly quantityQuoted: number | null;
  readonly stockStatus: string | null;
  readonly leadTime: string | null;
  readonly warranty: string | null;
  readonly discount: string | null;
  readonly notes: string | null;
  readonly dateQuoteReceived: Date | null;
}

const QUOTE_VIEW_SELECT = {
  id: true,
  benchmarkItemId: true,
  quoteNumber: true,
  state: true,
  createdById: true,
  competitorBrand: true,
  dealerName: true,
  dealerLocation: true,
  dealerUrl: true,
  price: true,
  currency: true,
  quantityQuoted: true,
  stockStatus: true,
  leadTime: true,
  warranty: true,
  discount: true,
  notes: true,
  dateQuoteReceived: true,
} as const;

/**
 * Create a new Draft Quote against a Benchmark Item, allocating its per-item
 * Quote Number. Gates, in order: the caller is a Researcher (role); the item
 * exists; the caller is in the item's Country pool (#6 — only the pool may work
 * it). The number is allocated by atomically incrementing the item's `quoteSeq`
 * inside the insert transaction (ADR-0010): two concurrent creators serialize on
 * the item row and get distinct consecutive numbers, with no MAX race.
 */
export async function createDraftQuote(
  principal: Principal,
  itemId: string,
  fields: QuoteFields = {},
): Promise<{ readonly id: string; readonly quoteNumber: number }> {
  if (!canCreateQuote(principal)) {
    throw new QuoteAccessError("Only Researchers may create a Quote");
  }

  const item = await prisma.benchmarkItem.findUnique({
    where: { id: itemId },
    select: { id: true, studyId: true, country: true },
  });
  if (item === null) {
    throw new QuoteAccessError(`Benchmark Item not found: ${itemId}`);
  }

  const membership = await prisma.countryAssignment.findFirst({
    where: { studyId: item.studyId, country: item.country, researcherId: principal.userId },
    select: { id: true },
  });
  if (membership === null) {
    throw new QuoteAccessError(
      `Not assigned to Country "${item.country}" — ask the Engagement Manager`,
    );
  }

  return prisma.$transaction(async (tx) => {
    // Atomic monotonic allocation: the increment takes a row lock on the item,
    // so concurrent creators can't collide on a number (ADR-0010).
    const { quoteSeq } = await tx.benchmarkItem.update({
      where: { id: itemId },
      data: { quoteSeq: { increment: 1 } },
      select: { quoteSeq: true },
    });
    return tx.quote.create({
      data: {
        benchmarkItemId: itemId,
        quoteNumber: quoteSeq,
        createdById: principal.userId,
        state: "Draft",
        ...toData(fields),
      },
      select: { id: true, quoteNumber: true },
    });
  });
}

/**
 * Edit a Draft Quote's fields. Owner-only and Draft-only: a researcher may edit
 * only their own quote, and only while it is still a Draft (a Submitted quote is
 * immutable to the researcher — corrections come via rejection in #11).
 */
export async function updateDraftQuote(
  principal: Principal,
  quoteId: string,
  fields: QuoteFields,
): Promise<void> {
  await requireOwnDraft(principal, quoteId);
  await prisma.quote.update({ where: { id: quoteId }, data: toData(fields) });
}

/**
 * Hard-delete a Draft Quote (abandon). Owner-only and Draft-only. The item's
 * `quoteSeq` is NOT rewound, so the abandoned number becomes a permanent gap and
 * is never reused (ADR-0010).
 */
export async function deleteDraftQuote(principal: Principal, quoteId: string): Promise<void> {
  await requireOwnDraft(principal, quoteId);
  await prisma.quote.delete({ where: { id: quoteId } });
}

/**
 * Submit a Draft Quote. Owner-only; the Draft→Submitted decision and the
 * required-field validation are the pure core's (`transition`). Returns the
 * core's result verbatim: `missing-fields` (with the list) and
 * `illegal-transition` write nothing; `ok` persists the new state under a
 * conditional update so a concurrent submit can't double-apply.
 */
export async function submitQuote(
  principal: Principal,
  quoteId: string,
): Promise<TransitionResult> {
  if (!isInternal(principal)) {
    throw new QuoteAccessError("Internal staff only");
  }
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      createdById: true,
      state: true,
      competitorBrand: true,
      dealerName: true,
      dealerLocation: true,
      price: true,
      currency: true,
      quantityQuoted: true,
      dateQuoteReceived: true,
      benchmarkItem: { select: { studyId: true } },
    },
  });
  if (quote === null) {
    throw new QuoteAccessError(`Quote not found: ${quoteId}`);
  }
  if (quote.createdById !== principal.userId) {
    throw new QuoteAccessError("Only the author may submit their Quote");
  }

  const submittable: SubmittableQuote = {
    competitorBrand: quote.competitorBrand,
    dealerName: quote.dealerName,
    dealerLocation: quote.dealerLocation,
    price: quote.price === null ? null : Number(quote.price),
    currency: quote.currency,
    quantityQuoted: quote.quantityQuoted,
    dateQuoteReceived: quote.dateQuoteReceived,
  };

  const result = transition(quote.state, { kind: "submit", quote: submittable });
  if (!result.ok) return result;

  // Persist under a guard so a concurrent submit applies exactly once. Conversion
  // is NOT fetched here — submit only marks it pending, and the background sweep
  // pins the rate once the quote's date has closed (ADR-0013). This preserves the
  // invariant "null ⇔ Draft; once Submitted, always pending → auto/manual".
  //
  // `submittedAt` stamps FIFO queue position (#11). On a RESUBMIT (after revise)
  // this also clears the prior verdict — reason/reviewer/time — so a re-queued
  // quote carries no stale verdict; the author's `justification` is deliberately
  // left intact (the analyst must read it to approve a still-flagged quote).
  await prisma.$transaction(async (tx) => {
    const applied = await tx.quote.updateMany({
      where: { id: quoteId, state: "Draft" },
      data: {
        state: "Submitted",
        conversionStatus: "pending",
        submittedAt: new Date(),
        rejectionReason: null,
        reviewedById: null,
        reviewedAt: null,
      },
    });
    // Record only if the guarded update actually transitioned a row — a raced
    // concurrent submit that matched 0 rows changed nothing and logs nothing
    // (ADR-0019: one event per real change, atomic with the transition).
    if (applied.count === 1) {
      await recordAuditEvents(tx, [
        auditQuoteLifecycle("submit", {
          actorId: principal.userId,
          studyId: quote.benchmarkItem.studyId,
          quoteId,
        }),
      ]);
    }
  });
  return result;
}

/**
 * List the Quotes on a Benchmark Item that the caller may read (issue #8 read
 * AC). Internal staff only. Draft privacy (ADR-0011): the caller sees their own
 * quotes in any state, plus other authors' quotes only once they have left Draft
 * — never another author's Draft.
 */
export async function listQuotesForItem(
  principal: Principal,
  itemId: string,
): Promise<QuoteView[]> {
  if (!isInternal(principal)) {
    throw new QuoteAccessError("Internal staff only");
  }
  const rows = await prisma.quote.findMany({
    where: {
      benchmarkItemId: itemId,
      OR: [{ createdById: principal.userId }, { state: { not: "Draft" } }],
    },
    select: QUOTE_VIEW_SELECT,
    orderBy: { quoteNumber: "asc" },
  });
  return rows.map((r) => ({ ...r, price: r.price === null ? null : r.price.toString() }));
}

/** One row of the analyst review queue (#11): the Quote plus the Benchmark Item
 *  context and the computed QC flag the analyst needs to render a verdict. The
 *  Client Price is shown to the analyst (never to researchers; ADR-0003), so it
 *  is safe to surface here behind the Analyst-only gate. */
export interface ReviewQueueItem {
  readonly id: string;
  readonly quoteNumber: number;
  readonly competitorBrand: string | null;
  readonly dealerName: string | null;
  readonly dealerLocation: string | null;
  readonly price: string | null;
  readonly currency: string | null;
  readonly quantityQuoted: number | null;
  readonly convertedUsdPrice: string | null;
  readonly convertedUsdPricePerUnit: string | null;
  readonly conversionStatus: "pending" | "auto" | "manual" | null;
  readonly justification: string | null;
  readonly submittedAt: Date | null;
  readonly authorName: string;
  // Benchmark Item / study context:
  readonly studyName: string;
  readonly clientName: string;
  readonly country: string;
  readonly clientPartNumber: string;
  readonly itemDescription: string;
  /** Null when the item is unpriced (ADR-0015) — then `flag.comparable` is false. */
  readonly clientPrice: string | null;
  readonly qcThresholdPct: string;
  /** The QC out-of-range evaluation (ADR-0014); `comparable: false` while pending
   *  OR when the item has no Client Price (ADR-0015). */
  readonly flag: PriceFlagResult;
}

/**
 * The analyst review queue: every Submitted Quote across all studies and tenants
 * (analysts are not tenant-scoped — CONTEXT.md: Analyst), oldest-submitted first
 * so nothing starves (FIFO by `submittedAt`). Analyst-only. Each row carries the
 * computed QC flag (ADR-0014): a pending quote is `comparable: false` (no USD
 * figure yet), an `auto`/`manual` quote is compared against its item's Client
 * Price using the study's QC Threshold.
 */
export async function listReviewQueue(principal: Principal): Promise<ReviewQueueItem[]> {
  if (!canReviewQuote(principal)) {
    throw new QuoteAccessError("Only Analysts may review quotes");
  }
  const rows = await prisma.quote.findMany({
    where: { state: "Submitted" },
    orderBy: { submittedAt: "asc" },
    select: {
      id: true,
      quoteNumber: true,
      competitorBrand: true,
      dealerName: true,
      dealerLocation: true,
      price: true,
      currency: true,
      quantityQuoted: true,
      convertedUsdPrice: true,
      convertedUsdPricePerUnit: true,
      conversionStatus: true,
      justification: true,
      submittedAt: true,
      createdBy: { select: { name: true } },
      benchmarkItem: {
        select: {
          country: true,
          clientPartNumber: true,
          itemDescription: true,
          clientPrice: true,
          study: { select: { name: true, qcThresholdPct: true, client: { select: { name: true } } } },
        },
      },
    },
  });

  return rows.map((r) => {
    const usdPerUnit = r.convertedUsdPricePerUnit === null ? null : Number(r.convertedUsdPricePerUnit);
    const clientPrice = r.benchmarkItem.clientPrice === null ? null : Number(r.benchmarkItem.clientPrice);
    const flag = evaluatePriceFlag({
      usdPricePerUnit: usdPerUnit,
      clientPrice,
      thresholdPct: Number(r.benchmarkItem.study.qcThresholdPct),
    });
    return {
      id: r.id,
      quoteNumber: r.quoteNumber,
      competitorBrand: r.competitorBrand,
      dealerName: r.dealerName,
      dealerLocation: r.dealerLocation,
      price: r.price === null ? null : r.price.toString(),
      currency: r.currency,
      quantityQuoted: r.quantityQuoted,
      convertedUsdPrice: r.convertedUsdPrice === null ? null : r.convertedUsdPrice.toString(),
      convertedUsdPricePerUnit:
        r.convertedUsdPricePerUnit === null ? null : r.convertedUsdPricePerUnit.toString(),
      conversionStatus: r.conversionStatus,
      justification: r.justification,
      submittedAt: r.submittedAt,
      authorName: r.createdBy.name,
      studyName: r.benchmarkItem.study.name,
      clientName: r.benchmarkItem.study.client.name,
      country: r.benchmarkItem.country,
      clientPartNumber: r.benchmarkItem.clientPartNumber,
      itemDescription: r.benchmarkItem.itemDescription,
      clientPrice: r.benchmarkItem.clientPrice === null ? null : r.benchmarkItem.clientPrice.toString(),
      qcThresholdPct: r.benchmarkItem.study.qcThresholdPct.toString(),
      flag,
    };
  });
}

/**
 * Approve a Submitted Quote (Analyst verdict). The approve guard is the pure
 * core's (`transition`): blocked while conversion is `pending` (ADR-0013), and —
 * if the quote is flagged against its Client Price — blocked until the author has
 * supplied a Justification (ADR-0014). On success, the verdict and its analyst/
 * time are pinned under a `state = Submitted` guard so a concurrent verdict can't
 * double-apply.
 */
export async function approveQuote(
  principal: Principal,
  quoteId: string,
): Promise<TransitionResult> {
  if (!canReviewQuote(principal)) {
    throw new QuoteAccessError("Only Analysts may review quotes");
  }
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      state: true,
      conversionStatus: true,
      convertedUsdPricePerUnit: true,
      justification: true,
      benchmarkItem: {
        select: { studyId: true, clientPrice: true, study: { select: { qcThresholdPct: true } } },
      },
    },
  });
  if (quote === null) {
    throw new QuoteAccessError(`Quote not found: ${quoteId}`);
  }

  const flag = evaluatePriceFlag({
    usdPricePerUnit:
      quote.convertedUsdPricePerUnit === null ? null : Number(quote.convertedUsdPricePerUnit),
    clientPrice:
      quote.benchmarkItem.clientPrice === null ? null : Number(quote.benchmarkItem.clientPrice),
    thresholdPct: Number(quote.benchmarkItem.study.qcThresholdPct),
  });
  const flagged = flag.comparable && flag.flagged;
  const hasJustification = quote.justification !== null && quote.justification.trim() !== "";

  const result = transition(quote.state, {
    kind: "approve",
    conversionStatus: quote.conversionStatus,
    flagged,
    hasJustification,
  });
  if (!result.ok) return result;

  await prisma.$transaction(async (tx) => {
    const applied = await tx.quote.updateMany({
      where: { id: quoteId, state: "Submitted" },
      data: { state: "Approved", reviewedById: principal.userId, reviewedAt: new Date() },
    });
    if (applied.count === 1) {
      await recordAuditEvents(tx, [
        auditQuoteLifecycle("approve", {
          actorId: principal.userId,
          studyId: quote.benchmarkItem.studyId,
          quoteId,
        }),
      ]);
    }
  });
  return result;
}

/**
 * Reject a Submitted Quote with a reason (Analyst verdict). Also the vehicle for
 * "return for justification": the reason states the divergence direction, never
 * the Client Price value (ADR-0003). The reason is required (the pure core's
 * `missing-reason` guard). On success the quote returns to its author as Rejected
 * under a `state = Submitted` guard.
 */
export async function rejectQuote(
  principal: Principal,
  quoteId: string,
  reason: string,
): Promise<TransitionResult> {
  if (!canReviewQuote(principal)) {
    throw new QuoteAccessError("Only Analysts may review quotes");
  }
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      state: true,
      createdById: true,
      createdBy: { select: { status: true } },
      benchmarkItem: { select: { studyId: true } },
    },
  });
  if (quote === null) {
    throw new QuoteAccessError(`Quote not found: ${quoteId}`);
  }

  const result = transition(quote.state, { kind: "reject", reason });
  if (!result.ok) return result;

  await prisma.$transaction(async (tx) => {
    const applied = await tx.quote.updateMany({
      where: { id: quoteId, state: "Submitted" },
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
          studyId: quote.benchmarkItem.studyId,
          quoteId,
        }),
      ]);
      // Push the rejection to its AUTHOR — the one who can revise it (createdById,
      // not necessarily the item's Primary Researcher; ADR-0020). Only an active
      // author is notified; a deactivated (offboarded) author is skipped.
      if (quote.createdBy.status === "active") {
        await recordNotifications(tx, [
          notifyQuoteRejected({
            recipientId: quote.createdById,
            studyId: quote.benchmarkItem.studyId,
            quoteId,
            reason,
          }),
        ]);
      }
    }
  });
  return result;
}

/**
 * Revise a Rejected Quote back to Draft (the author's return path; ADR-0014). The
 * ONLY way out of Rejected. Owner-only — only the author may revise their own
 * quote. Resets conversion to unconverted (null) and clears the FIFO stamp, so a
 * later resubmit re-converts from scratch and re-queues at the back; the Quote
 * Number is retained. The rejection reason is left visible while the author works
 * the Draft (it is cleared on resubmit, in submitQuote).
 */
export async function reviseQuote(
  principal: Principal,
  quoteId: string,
): Promise<TransitionResult> {
  if (!isInternal(principal)) {
    throw new QuoteAccessError("Internal staff only");
  }
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { createdById: true, state: true },
  });
  if (quote === null) {
    throw new QuoteAccessError(`Quote not found: ${quoteId}`);
  }
  if (quote.createdById !== principal.userId) {
    throw new QuoteAccessError("Only the author may revise their Quote");
  }

  const result = transition(quote.state, { kind: "revise" });
  if (!result.ok) return result;

  await prisma.quote.updateMany({
    where: { id: quoteId, state: "Rejected", createdById: principal.userId },
    data: { state: "Draft", conversionStatus: null, submittedAt: null },
  });
  return result;
}

/** Load a Quote and assert the caller owns it and it is still a Draft. The single
 *  gate behind every researcher write that mutates an existing Quote. */
async function requireOwnDraft(principal: Principal, quoteId: string): Promise<void> {
  if (!isInternal(principal)) {
    throw new QuoteAccessError("Internal staff only");
  }
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { createdById: true, state: true },
  });
  if (quote === null) {
    throw new QuoteAccessError(`Quote not found: ${quoteId}`);
  }
  if (quote.createdById !== principal.userId) {
    throw new QuoteAccessError("Only the author may edit their Quote");
  }
  if (quote.state !== "Draft") {
    throw new QuoteAccessError("Only a Draft Quote can be edited");
  }
}

/** Map the optional input fields to a Prisma data object, omitting keys not
 *  supplied so an edit only touches the fields it carries. */
function toData(fields: QuoteFields) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data[key] = value;
  }
  return data;
}
