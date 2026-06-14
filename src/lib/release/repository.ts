import type { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/tenant-context";
import type { Principal } from "@/domains/authz/principal";
import { canReleaseCountry } from "@/domains/authz/release";
import { tenantVisibility } from "@/domains/authz/visibility";
import { visibilityWhere } from "@/lib/studies/where";
import {
  evaluateRelease,
  type ItemReleaseStatus,
  type ReleaseEligibility,
} from "@/domains/release/eligibility";
import { recordAuditEvents } from "@/lib/audit/repository";
import { auditRelease } from "@/domains/audit/events";
import { recordNotifications } from "@/lib/notifications/dispatch";
import { notifyCountryReleased } from "@/domains/notifications/events";

// Tenant-aware data-access adapter for the Country Release gate (issue #13). It
// owns what the pure evaluator can't: the Analyst role gate, computing each
// item's approved / in-flight counts to feed evaluateRelease, the atomic
// re-check-and-upsert that persists a release (ADR-0016), and the fail-closed
// client read path that exposes ONLY currently-released + Approved quotes
// (ADR-0002 / ADR-0008). The releasable judgement itself lives in the pure core
// src/domains/release/eligibility; this layer persists its result.

/** Raised for permission / state failures (not user-fixable by editing data —
 *  a blocked release returns the eligibility result instead, never throws). */
export class ReleaseAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseAccessError";
  }
}

/** The current release state of a Country: `released`/`reopened` mirror the row,
 *  `null` means no row exists yet — never released (ADR-0016). */
export type CountryReleaseState = "released" | "reopened" | null;

/** One Country's release picture for the analyst (issue #13 read AC / PRD #24):
 *  its derived eligibility plus its current persisted release state. */
export interface CountryReleaseStatus {
  readonly country: string;
  readonly eligibility: ReleaseEligibility;
  readonly releaseState: CountryReleaseState;
}

/** A released, approved Quote as the client may see it. Deliberately omits every
 *  internal-only field — Client Price (ADR-0003), the review trail (rejection
 *  reason, justification, reviewer, author identity) — leaving only the
 *  competitive data the client's results are built from. */
export interface ReleasedQuoteView {
  readonly id: string;
  readonly quoteNumber: number;
  readonly country: string;
  readonly clientPartNumber: string;
  readonly itemDescription: string;
  readonly competitorBrand: string | null;
  readonly dealerName: string | null;
  readonly dealerLocation: string | null;
  readonly dealerUrl: string | null;
  readonly price: string | null;
  readonly currency: string | null;
  readonly quantityQuoted: number | null;
  readonly convertedUsdPrice: string | null;
  readonly convertedUsdPricePerUnit: string | null;
  readonly stockStatus: string | null;
  readonly leadTime: string | null;
  readonly warranty: string | null;
  readonly discount: string | null;
  readonly notes: string | null;
  readonly dateQuoteReceived: Date | null;
}

/** Fold a Benchmark Item's quote states into the counts the pure gate reads.
 *  In-flight = Draft or Submitted; a Rejected quote is neither approved nor
 *  in-flight, so it never blocks release (ADR-0002). */
function toItemStatus(item: {
  requiredQuotes: number;
  quotes: { state: string }[];
}): ItemReleaseStatus {
  let approvedCount = 0;
  let inFlightCount = 0;
  for (const q of item.quotes) {
    if (q.state === "Approved") approvedCount += 1;
    else if (q.state === "Draft" || q.state === "Submitted") inFlightCount += 1;
  }
  return { requiredQuotes: item.requiredQuotes, approvedCount, inFlightCount };
}

const ITEM_COUNT_SELECT = {
  requiredQuotes: true,
  quotes: { select: { state: true } },
} as const;

/**
 * Release a Country's approved quotes to the client (Analyst verdict, ADR-0002).
 * The eligibility precondition is RE-CHECKED inside the write transaction —
 * counts are re-read and `evaluateRelease` re-run there — so a quote that goes
 * in-flight between a UI preview and this call can't slip a no-longer-eligible
 * Country out (the same atomic discipline as the quoteSeq allocation). When not
 * releasable, the eligibility result is returned verbatim and NOTHING is written.
 * On success the `(studyId, country)` row is upserted to `released`, stamping the
 * releasing analyst and time (re-release re-stamps; ADR-0016).
 */
export async function releaseCountry(
  principal: Principal,
  studyId: string,
  country: string,
): Promise<ReleaseEligibility> {
  if (!canReleaseCountry(principal)) {
    throw new ReleaseAccessError("Only Analysts may release a Country");
  }
  return withTenant(principal, async (tx) => {
    const items = await tx.benchmarkItem.findMany({
      where: { studyId, country },
      select: ITEM_COUNT_SELECT,
    });
    // An unknown (studyId, country) — no Benchmark Items — yields [] and is not
    // releasable, exactly like an empty Country (ADR-0016). No silent no-op row.
    const eligibility = evaluateRelease(items.map(toItemStatus));
    if (!eligibility.releasable) return eligibility;

    // The owning tenant — needed for the denormalized RLS clientId (ADR-0021) on
    // a first-release insert, and reused for the notification recipients below.
    // A releasable Country has Benchmark Items, so the study exists.
    const { clientId } = await tx.study.findUniqueOrThrow({
      where: { id: studyId },
      select: { clientId: true },
    });

    // First release of this (study, country) ever? releasedAt re-stamps on every
    // release, so it can't tell us — the persistent clientNotifiedAt marker can
    // (set once here, never cleared by reopen/re-release; ADR-0020).
    const existing = await tx.countryRelease.findUnique({
      where: { studyId_country: { studyId, country } },
      select: { clientNotifiedAt: true },
    });
    const firstRelease = existing === null || existing.clientNotifiedAt === null;

    const now = new Date();
    const row = await tx.countryRelease.upsert({
      where: { studyId_country: { studyId, country } },
      create: {
        studyId,
        clientId,
        country,
        state: "released",
        releasedById: principal.userId,
        releasedAt: now,
        clientNotifiedAt: now,
      },
      update: {
        state: "released",
        releasedById: principal.userId,
        releasedAt: now,
        ...(firstRelease ? { clientNotifiedAt: now } : {}),
      },
    });
    await recordAuditEvents(tx, [
      auditRelease("release", {
        actorId: principal.userId,
        studyId,
        countryReleaseId: row.id,
      }),
    ]);
    // Tell the tenant its Country is released — ONCE, on first release only
    // (ADR-0020). Recipients are the tenant's ACTIVE Client Users; a reopen and
    // any re-release stay silent.
    if (firstRelease) {
      const recipients = await tx.user.findMany({
        where: { tenantId: clientId, kind: "client", status: "active" },
        select: { id: true },
      });
      await recordNotifications(
        tx,
        recipients.map((u) =>
          notifyCountryReleased({
            recipientId: u.id,
            studyId,
            countryReleaseId: row.id,
            country,
          }),
        ),
      );
    }
    return eligibility;
  });
}

/**
 * Reopen a released Country (Analyst verdict, ADR-0002): pull its quotes back
 * from client view pending re-release. UNGATED by the precondition — always
 * allowed on a released Country — and quote-inert: it flips ONLY the release row
 * to `reopened`, never touching any quote's state, so re-release needs no
 * re-approval (ADR-0016). Throws if the Country is not currently released.
 */
export async function reopenCountry(
  principal: Principal,
  studyId: string,
  country: string,
): Promise<void> {
  if (!canReleaseCountry(principal)) {
    throw new ReleaseAccessError("Only Analysts may reopen a Country");
  }
  await withTenant(principal, async (tx) => {
    const existing = await tx.countryRelease.findUnique({
      where: { studyId_country: { studyId, country } },
      select: { id: true, state: true },
    });
    if (existing === null || existing.state !== "released") {
      throw new ReleaseAccessError(`Country "${country}" is not currently released`);
    }
    await tx.countryRelease.update({
      where: { studyId_country: { studyId, country } },
      data: { state: "reopened", reopenedById: principal.userId, reopenedAt: new Date() },
    });
    await recordAuditEvents(tx, [
      auditRelease("reopen", {
        actorId: principal.userId,
        studyId,
        countryReleaseId: existing.id,
      }),
    ]);
  });
}

/**
 * The client's released-results read (issue #13 / ADR-0002) — the first client-
 * facing quote read in the codebase. Fail-closed conjunction of three gates
 * (ADR-0008): the study must be visible to the principal (out-of-tenant collapses
 * to not-found → []), the quote's Country must be CURRENTLY released
 * (`state = released`), and the quote must be Approved. A merely-approved quote
 * in an unreleased or reopened Country is invisible; so is every other tenant's.
 */
export async function listReleasedQuotesForStudy(
  principal: Principal,
  studyId: string,
): Promise<ReleasedQuoteView[]> {
  return withTenant(principal, async (tx) => {
    // Tenant gate first: same filter-first lookup the study read paths use, so a
    // wrong-tenant (or unknown) studyId returns null and we expose nothing.
    const study = await tx.study.findFirst({
      where: { AND: [visibilityWhere(tenantVisibility(principal)), { id: studyId }] },
      select: { id: true },
    });
    if (study === null) return [];

    const released = await tx.countryRelease.findMany({
      where: { studyId, state: "released" },
      select: { country: true },
    });
    if (released.length === 0) return [];
    const releasedCountries = released.map((r) => r.country);

    const rows = await tx.quote.findMany({
      where: {
        state: "Approved",
        benchmarkItem: { studyId, country: { in: releasedCountries } },
      },
      orderBy: [{ benchmarkItem: { country: "asc" } }, { quoteNumber: "asc" }],
      select: {
        id: true,
        quoteNumber: true,
        competitorBrand: true,
        dealerName: true,
        dealerLocation: true,
        dealerUrl: true,
        price: true,
        currency: true,
        quantityQuoted: true,
        convertedUsdPrice: true,
        convertedUsdPricePerUnit: true,
        stockStatus: true,
        leadTime: true,
        warranty: true,
        discount: true,
        notes: true,
        dateQuoteReceived: true,
        benchmarkItem: {
          select: { country: true, clientPartNumber: true, itemDescription: true },
        },
      },
    });

    return rows.map((r) => ({
    id: r.id,
    quoteNumber: r.quoteNumber,
    country: r.benchmarkItem.country,
    clientPartNumber: r.benchmarkItem.clientPartNumber,
    itemDescription: r.benchmarkItem.itemDescription,
    competitorBrand: r.competitorBrand,
    dealerName: r.dealerName,
    dealerLocation: r.dealerLocation,
    dealerUrl: r.dealerUrl,
    price: decimalString(r.price),
    currency: r.currency,
    quantityQuoted: r.quantityQuoted,
    convertedUsdPrice: decimalString(r.convertedUsdPrice),
    convertedUsdPricePerUnit: decimalString(r.convertedUsdPricePerUnit),
    stockStatus: r.stockStatus,
    leadTime: r.leadTime,
    warranty: r.warranty,
    discount: r.discount,
    notes: r.notes,
    dateQuoteReceived: r.dateQuoteReceived,
  }));
  });
}

/**
 * The analyst's per-Country release picture for a study (issue #13 read AC / PRD
 * #24): every distinct Country, its derived Release Eligibility, and its current
 * persisted release state. Analyst-only — it is the data the release action is
 * driven from. The Country set is derived from the study's Benchmark Items (the
 * same source CountryAssignment uses), so a Country with no items never appears.
 */
export async function listCountryReleaseStatus(
  principal: Principal,
  studyId: string,
): Promise<CountryReleaseStatus[]> {
  if (!canReleaseCountry(principal)) {
    throw new ReleaseAccessError("Only Analysts may view release status");
  }
  const { items, releases } = await withTenant(principal, async (tx) => ({
    items: await tx.benchmarkItem.findMany({
      where: { studyId },
      select: { country: true, ...ITEM_COUNT_SELECT },
    }),
    releases: await tx.countryRelease.findMany({
      where: { studyId },
      select: { country: true, state: true },
    }),
  }));
  const stateByCountry = new Map<string, CountryReleaseState>(
    releases.map((r) => [r.country, r.state]),
  );

  // Group items by Country, preserving first-seen order.
  const byCountry = new Map<string, ItemReleaseStatus[]>();
  for (const item of items) {
    const list = byCountry.get(item.country) ?? [];
    list.push(toItemStatus(item));
    byCountry.set(item.country, list);
  }

  return [...byCountry.entries()].map(([country, statuses]) => ({
    country,
    eligibility: evaluateRelease(statuses),
    releaseState: stateByCountry.get(country) ?? null,
  }));
}

/**
 * How many Countries are ready for the analyst to release right now (#58 home
 * signal): currently Release-Eligible AND not already `released` — the actionable
 * release backlog, the mirror of the EM home's unstaffed-countries count. A
 * Country already `released` drops off (its work is done); a `reopened` one that
 * is still eligible stays IN (it is waiting on re-release). Spans all studies and
 * tenants (analysts are not tenant-scoped — CONTEXT.md: Analyst). The eligibility
 * verdict is the pure core's (`evaluateRelease`) over each Country's item counts —
 * never a re-derived rule here (issue #58 / ADR-0016) — which is why this counts
 * in app code, not SQL, and is the pricier of the home's two analyst signals.
 *
 * NOTE: the issue phrases this as "countries whose release eligibility is met";
 * we deliberately read it as the *unreleased* eligible set, so the number drains
 * to zero once everything ready has been released rather than counting finished
 * work forever. Analyst-only.
 */
export async function countReleasableCountries(principal: Principal): Promise<number> {
  if (!canReleaseCountry(principal)) {
    throw new ReleaseAccessError("Only Analysts may view release status");
  }
  const { items, releases } = await withTenant(principal, async (tx) => ({
    items: await tx.benchmarkItem.findMany({
      select: { studyId: true, country: true, ...ITEM_COUNT_SELECT },
    }),
    // Only `released` rows mask a Country; `reopened` (and absent) do not.
    releases: await tx.countryRelease.findMany({
      where: { state: "released" },
      select: { studyId: true, country: true },
    }),
  }));

  const releasedKeys = new Set(releases.map((r) => `${r.studyId} ${r.country}`));

  // Group items by (study, country) — the Country Release scope (ADR-0016).
  const byKey = new Map<string, ItemReleaseStatus[]>();
  for (const item of items) {
    const key = `${item.studyId} ${item.country}`;
    const list = byKey.get(key) ?? [];
    list.push(toItemStatus(item));
    byKey.set(key, list);
  }

  let count = 0;
  for (const [key, statuses] of byKey) {
    if (releasedKeys.has(key)) continue;
    if (evaluateRelease(statuses).releasable) count += 1;
  }
  return count;
}

/** Prisma Decimal → string (or null), matching the project's read-model convention. */
function decimalString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}
