import { prisma } from "@/lib/prisma";
import type { Principal } from "@/domains/authz/principal";
import { isInternal } from "@/domains/authz/principal";
import { canCreateQuote } from "@/domains/authz/quotes";
import {
  transition,
  type SubmittableQuote,
  type TransitionResult,
} from "@/domains/quotes/lifecycle";

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

  const result = transition(quote.state, "submit", submittable);
  if (!result.ok) return result;

  // Persist under a guard so a concurrent submit applies exactly once. Conversion
  // is NOT fetched here — submit only marks it pending, and the background sweep
  // pins the rate once the quote's date has closed (ADR-0013). This preserves the
  // invariant "null ⇔ Draft; once Submitted, always pending → auto/manual".
  await prisma.quote.updateMany({
    where: { id: quoteId, state: "Draft" },
    data: { state: "Submitted", conversionStatus: "pending" },
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
