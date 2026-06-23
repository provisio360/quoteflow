import { withTenant } from "@/lib/tenant-context";
import type { Principal } from "@/domains/authz/principal";
import { isInternal } from "@/domains/authz/principal";
import {
  canImportBenchmarkItems,
  canSelfAssignBenchmarkItem,
  canMaintainClientPrice,
} from "@/domains/authz/benchmark-items";
import { getStudy } from "@/lib/studies/repository";
import {
  validateImport,
  type ImportError,
  type ValidatedBenchmarkItem,
} from "@/domains/benchmark-items/import";
import { resolveUpserts, benchmarkItemKey } from "@/domains/benchmark-items/resolve";
import { recordAuditEvents } from "@/lib/audit/repository";
import { auditClientPriceChange, auditImport } from "@/domains/audit/events";
import { resolveCountryVisibility } from "@/lib/authz/country-scope";
import { itemVisibilityWhere } from "./where";

// Tenant-aware data-access adapter for the Benchmark Item bulk import (issue #5).
// The ONLY sanctioned write path: it role-gates the principal, resolves the
// target study through the tenant-scoped studies repository (ADR-0008 — a
// principal can't write into a study it can't see), validates the whole file,
// and applies the upsert in a SINGLE transaction. Validation is all-or-nothing
// (ADR-0009) and so is persistence: a mid-write failure rolls back, so a study
// is never half-loaded.

/** Raised for permission/existence failures (not user-fixable file content). */
export class BenchmarkItemAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkItemAccessError";
  }
}

export type ImportOutcome =
  | { readonly ok: true; readonly inserted: number; readonly updated: number }
  | { readonly ok: false; readonly errors: readonly ImportError[] };

/**
 * Validate and upsert a brief spreadsheet (already parsed to a raw cell grid)
 * into a study. Throws `BenchmarkItemAccessError` for permission/not-found
 * failures; returns the per-row error report (writing nothing) for invalid file
 * content; returns insert/update counts on success.
 */
export async function importBenchmarkItems(
  principal: Principal,
  studyId: string,
  grid: readonly (readonly string[])[],
): Promise<ImportOutcome> {
  if (!canImportBenchmarkItems(principal)) {
    throw new BenchmarkItemAccessError(
      "Only Engagement Managers and Analysts may import Benchmark Items",
    );
  }

  // Tenant-scoped existence check — out-of-tenant / missing both resolve to null.
  const study = await getStudy(principal, studyId);
  if (study === null) {
    throw new BenchmarkItemAccessError(`Study not found: ${studyId}`);
  }

  const validation = validateImport(grid);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const { inserted, updated } = await withTenant(principal, async (tx) => {
    const existing = await tx.benchmarkItem.findMany({
      where: { studyId },
      select: { country: true, clientItemNumberKey: true },
    });
    const existingKeys = new Set(existing.map(benchmarkItemKey));

    const { inserts, updates } = resolveUpserts(validation.items, existingKeys);

    if (inserts.length > 0) {
      await tx.benchmarkItem.createMany({
        // clientId is the denormalized RLS tenant column (ADR-0021), copied from
        // the parent study; the upsert key never changes tenant, so updates leave
        // it untouched.
        data: inserts.map((item) => ({ ...toRow(studyId, item), clientId: study.clientId })),
      });
    }

    // For the update set, read each existing row's Client Price group so we can
    // tell a TRULY-unpriced item (never seeded: clientPrice null AND seed trio
    // null) apart from one an analyst has set or CLEARED (clientPrice null but
    // the trio still present — `setClientPrice` clears only the derived value).
    // ADR-0030: a re-import may seed the former but must never touch the latter.
    const priceStateByKey = new Map<string, { clientPrice: unknown; clientItemPrice: unknown }>();
    if (updates.length > 0) {
      const existingPrices = await tx.benchmarkItem.findMany({
        where: { studyId, OR: updates.map((i) => ({ country: i.country, clientItemNumberKey: i.clientItemNumberKey })) },
        select: { country: true, clientItemNumberKey: true, clientPrice: true, clientItemPrice: true },
      });
      for (const r of existingPrices) priceStateByKey.set(benchmarkItemKey(r), { clientPrice: r.clientPrice, clientItemPrice: r.clientItemPrice });
    }

    // Keys seeded to a real (non-null) Client Price on update — audited below as
    // a null -> value Client Price change (ADR-0030), like `setClientPrice`.
    const seededAfterByKey = new Map<string, number>();

    for (const item of updates) {
      const key = benchmarkItemKey(item);
      const existing = priceStateByKey.get(key);
      const trulyUnpriced = existing != null && existing.clientPrice === null && existing.clientItemPrice === null;

      // Re-import overwrites the brief fields. The Client Price group is normally
      // STRIPPED — derived value and raw seed trio are insert-only, analyst-owned
      // after first seeding (ADR-0015, ADR-0027): a re-brief must not stomp a
      // curated benchmark or leave an incoherent seed. The one exception (ADR-0030):
      // a TRULY-unpriced item is seeded from the brief, writing the whole group
      // together so the trio still derives to clientPrice. (Do not widen this to
      // overwrite a value that is set or cleared — that is the forbidden fix.)
      const full = toRow(studyId, item);
      const {
        clientPrice: _cp,
        clientItemPrice: _cip,
        clientItemPriceCurrency: _cipc,
        clientItemPriceQuantity: _cipq,
        ...briefFields
      } = full;
      await tx.benchmarkItem.update({
        where: {
          studyId_country_clientItemNumberKey: {
            studyId,
            country: item.country,
            clientItemNumberKey: item.clientItemNumberKey,
          },
        },
        data: trulyUnpriced ? full : briefFields,
      });
      if (trulyUnpriced && item.clientPrice !== null) seededAfterByKey.set(key, item.clientPrice);
    }

    // One audit event per item actually written (ADR-0019: per affected row). A
    // no-op re-import (no inserts and no updates) touches nothing and logs
    // nothing. createMany returns no ids, so resolve the affected rows' ids by
    // their upsert keys in one query. Import normally leaves Client Price alone,
    // but ADR-0030 lets it SEED a truly-unpriced item — that null -> value
    // transition is audited as a Client Price change too, like `setClientPrice`.
    const affected = [...inserts, ...updates];
    if (affected.length > 0) {
      const rows = await tx.benchmarkItem.findMany({
        where: {
          studyId,
          OR: affected.map((item) => ({
            country: item.country,
            clientItemNumberKey: item.clientItemNumberKey,
          })),
        },
        select: { id: true, country: true, clientItemNumberKey: true },
      });
      const events = rows.map((r) => auditImport({ actorId: principal.userId, studyId, itemId: r.id }));
      for (const r of rows) {
        const after = seededAfterByKey.get(benchmarkItemKey(r));
        if (after !== undefined) {
          events.push(
            auditClientPriceChange({ actorId: principal.userId, studyId, itemId: r.id, before: null, after }),
          );
        }
      }
      await recordAuditEvents(tx, events);
    }

    return { inserted: inserts.length, updated: updates.length };
  });

  return { ok: true, inserted, updated };
}

// ─────────────────────────────────────────────────────────────────────────────
// Researcher-facing read path (issue #7) — the guidance view a Researcher uses
// to describe the part to a dealer. Client Price is NEVER selected here, so it
// cannot leak into a researcher payload by accident (ADR-0003: the hiding is the
// point). Internal-only: a client user's released-data view is a separate,
// later concern (#14), so internal scope is "all" and no tenant filter applies.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Benchmark Item as a Researcher may see it: the client's guidance plus the
 * current Primary Researcher (so the UI can show "claimed / claim"), and
 * deliberately NO `clientPrice` field — the type structurally lacks it, and the
 * query below never selects it. `primaryResearcherId` is null when unclaimed.
 */
export interface ResearcherItemView {
  readonly id: string;
  readonly studyId: string;
  readonly country: string;
  readonly clientItemNumber: string;
  readonly itemDescription: string;
  readonly configurationComment: string | null;
  readonly quantity: number | null;
  readonly clientSourceUnit: string | null;
  readonly requiredQuotes: number;
  readonly primaryResearcherId: string | null;
}

// The single source of the researcher-visible columns. Listing them explicitly
// (rather than omitting from a full row) means Client Price is never fetched —
// the structural guarantee behind the ADR-0003 payload test.
const RESEARCHER_VIEW_SELECT = {
  id: true,
  studyId: true,
  country: true,
  clientItemNumber: true,
  itemDescription: true,
  configurationComment: true,
  quantity: true,
  clientSourceUnit: true,
  requiredQuotes: true,
  primaryResearcherId: true,
} as const;

/**
 * Load one Benchmark Item as the Client-Price-hidden guidance view, or `null`
 * if it does not exist. Internal staff only — a client user gets an access
 * error (their released-data view is #14, not this work view).
 */
/**
 * The distinct Countries of a study, derived from its Benchmark Items (ADR-0009)
 * — the set the EM assigns researchers to and the Analyst releases. Internal-only
 * and Client-Price-free, so any internal role may read it (unlike the analyst
 * QC list). Empty until a brief is imported.
 */
export async function listStudyCountries(
  principal: Principal,
  studyId: string,
): Promise<string[]> {
  if (!isInternal(principal)) {
    throw new BenchmarkItemAccessError("Internal staff only");
  }
  const rows = await withTenant(principal, (tx) =>
    tx.benchmarkItem.findMany({
      where: { studyId },
      distinct: ["country"],
      orderBy: { country: "asc" },
      select: { country: true },
    }),
  );
  return rows.map((r) => r.country);
}

export async function getBenchmarkItemForResearcher(
  principal: Principal,
  itemId: string,
): Promise<ResearcherItemView | null> {
  if (!isInternal(principal)) {
    throw new BenchmarkItemAccessError("Internal staff only");
  }
  return withTenant(principal, (tx) =>
    tx.benchmarkItem.findUnique({
      where: { id: itemId },
      select: RESEARCHER_VIEW_SELECT,
    }),
  );
}

/**
 * A study's Benchmark Items as a Researcher sees them (#7): the guidance view
 * with NO Client Price (RESEARCHER_VIEW_SELECT never selects it), carrying
 * `primaryResearcherId` so the UI can show claim / mine / claimed-by-other.
 * Ordered by Country then Client Part Number. Internal-only.
 *
 * Scoped to the Researcher's assigned (study, country) pairs (ADR-0025): items in
 * Countries they are not assigned to are NOT loaded — confidentiality, not mere
 * UI hiding (this is what replaced the old cross-boundary "locked" row). The
 * country layer is a no-op `all` for EM / Analyst / Admin, who load every item.
 */
export async function listBenchmarkItemsForResearcher(
  principal: Principal,
  studyId: string,
): Promise<ResearcherItemView[]> {
  if (!isInternal(principal)) {
    throw new BenchmarkItemAccessError("Internal staff only");
  }
  return withTenant(principal, async (tx) => {
    const country = await resolveCountryVisibility(principal, tx);
    return tx.benchmarkItem.findMany({
      where: { AND: [{ studyId }, itemVisibilityWhere(country)] },
      orderBy: [{ country: "asc" }, { clientItemNumber: "asc" }],
      select: RESEARCHER_VIEW_SELECT,
    });
  });
}

export interface SelfAssignResult {
  /** The Primary Researcher now on the item — always the calling researcher. */
  readonly primaryResearcherId: string;
}

/**
 * Self-assign a Benchmark Item, becoming its Primary Researcher (issue #7).
 *
 * Preconditions, in order: the caller is a Researcher (role-gated); the item
 * exists; and the caller already has a Country Assignment for the item's Country
 * (#6 — only the pool may work it). The claim itself is **first-come and never
 * stolen**: a conditional `updateMany` that only writes when `primaryResearcherId`
 * is still NULL, so two concurrent claimers cannot both win — exactly one update
 * affects a row. If the conditional write matches nothing, the item is already
 * claimed: by the caller → idempotent success; by someone else → rejected.
 *
 * Throws `BenchmarkItemAccessError` for permission, unknown-item,
 * not-in-pool, or already-claimed-by-another — none of which change the lead.
 */
export async function selfAssignBenchmarkItem(
  principal: Principal,
  itemId: string,
): Promise<SelfAssignResult> {
  if (!canSelfAssignBenchmarkItem(principal)) {
    throw new BenchmarkItemAccessError(
      "Only Researchers may self-assign a Benchmark Item",
    );
  }

  return withTenant(principal, async (tx) => {
    const item = await tx.benchmarkItem.findUnique({
      where: { id: itemId },
      select: { id: true, studyId: true, country: true },
    });
    if (item === null) {
      throw new BenchmarkItemAccessError(`Benchmark Item not found: ${itemId}`);
    }

    // The caller must be in the item's Country pool (#6). Only Researchers are ever
    // in a pool, so this also re-confirms the role at the data layer.
    const membership = await tx.countryAssignment.findFirst({
      where: {
        studyId: item.studyId,
        country: item.country,
        researcherId: principal.userId,
      },
      select: { id: true },
    });
    if (membership === null) {
      throw new BenchmarkItemAccessError(
        `Not assigned to Country "${item.country}" — ask the Engagement Manager`,
      );
    }

    // Atomic first-come claim: writes only while the lead is still unclaimed.
    const claimed = await tx.benchmarkItem.updateMany({
      where: { id: itemId, primaryResearcherId: null },
      data: { primaryResearcherId: principal.userId },
    });
    if (claimed.count === 1) {
      return { primaryResearcherId: principal.userId };
    }

    // The claim matched no row: the item already has a primary researcher.
    const current = await tx.benchmarkItem.findUnique({
      where: { id: itemId },
      select: { primaryResearcherId: true },
    });
    if (current?.primaryResearcherId === principal.userId) {
      return { primaryResearcherId: principal.userId }; // idempotent re-claim
    }
    throw new BenchmarkItemAccessError(
      `Benchmark Item ${itemId} already has a primary researcher`,
    );
  });
}

/**
 * The Analyst's QC list view of a Benchmark Item. UNLIKE the researcher view
 * (RESEARCHER_VIEW_SELECT), this DOES carry `clientPrice` — the analyst owns and
 * reads it (ADR-0003/0015). `clientPrice` is null for an unpriced item.
 */
export interface AnalystItemView {
  readonly id: string;
  readonly country: string;
  readonly clientItemNumber: string;
  readonly itemDescription: string;
  readonly requiredQuotes: number;
  readonly clientPrice: number | null;
}

/**
 * List a study's Benchmark Items for the analyst QC view (issue #12), including
 * each item's Client Price. Analyst-only: this is the one read path that exposes
 * Client Price, so the role gate lives on the server (ADR-0003 defense-in-depth)
 * — a researcher or client never receives the value, not merely sees it hidden
 * in the UI. Ordered by Country then Client Part Number for a stable display.
 */
export async function listBenchmarkItemsForAnalyst(
  principal: Principal,
  studyId: string,
): Promise<AnalystItemView[]> {
  if (!canMaintainClientPrice(principal)) {
    throw new BenchmarkItemAccessError("Only Analysts may view Client Price");
  }
  const rows = await withTenant(principal, (tx) =>
    tx.benchmarkItem.findMany({
      where: { studyId },
      orderBy: [{ country: "asc" }, { clientItemNumber: "asc" }],
      select: {
        id: true,
        country: true,
        clientItemNumber: true,
        itemDescription: true,
        requiredQuotes: true,
        clientPrice: true,
      },
    }),
  );
  return rows.map((r) => ({
    ...r,
    clientPrice: r.clientPrice === null ? null : Number(r.clientPrice),
  }));
}

export interface SetClientPriceResult {
  /** The Client Price now on the item — a positive USD/unit value, or null (cleared). */
  readonly clientPrice: number | null;
}

/**
 * Set or clear a Benchmark Item's Client Price (issue #12 / ADR-0015).
 *
 * Analyst-only (ADR-0003 — the value is hidden from researchers; the EM runs the
 * study but does not curate the QC benchmark). `value` is the already-parsed
 * price: a number > 0, or null to clear it back to "unpriced". The repository
 * re-checks the > 0 invariant as defense-in-depth so a bad caller can't persist a
 * non-positive benchmark even if the pure parse is bypassed.
 *
 * Throws `BenchmarkItemAccessError` for a non-Analyst principal or an unknown
 * item — neither of which changes any value.
 */
export async function setClientPrice(
  principal: Principal,
  itemId: string,
  value: number | null,
): Promise<SetClientPriceResult> {
  if (!canMaintainClientPrice(principal)) {
    throw new BenchmarkItemAccessError("Only Analysts may maintain Client Price");
  }
  if (value !== null && (!Number.isFinite(value) || value <= 0)) {
    throw new BenchmarkItemAccessError("Client Price must be a number greater than 0");
  }

  await withTenant(principal, async (tx) => {
    // Read the prior value first — both to record the before/after delta and to
    // assert the item exists, inside the same transaction as the change (ADR-0019:
    // the audit write is atomic with the transition). A re-import never overwrites
    // Client Price, so this path is the only writer of its before/after.
    const before = await tx.benchmarkItem.findUnique({
      where: { id: itemId },
      select: { clientPrice: true, studyId: true },
    });
    if (before === null) {
      throw new BenchmarkItemAccessError(`Benchmark Item not found: ${itemId}`);
    }

    await tx.benchmarkItem.update({
      where: { id: itemId },
      data: { clientPrice: value },
    });

    await recordAuditEvents(tx, [
      auditClientPriceChange({
        actorId: principal.userId,
        studyId: before.studyId,
        itemId,
        before: before.clientPrice === null ? null : Number(before.clientPrice),
        after: value,
      }),
    ]);
  });

  return { clientPrice: value };
}

/** Map a validated item to its persisted columns. Used in full for INSERTs; the
 *  update path strips the whole Client Price group first (clientPrice + the raw
 *  seed trio), because the brief only seeds Client Price and the analyst owns it
 *  thereafter (ADR-0015, ADR-0027). */
function toRow(studyId: string, item: ValidatedBenchmarkItem) {
  return {
    studyId,
    country: item.country,
    clientItemNumber: item.clientItemNumber,
    clientItemNumberKey: item.clientItemNumberKey,
    itemDescription: item.itemDescription,
    configurationComment: item.configurationComment,
    quantity: item.quantity,
    clientSourceUnit: item.clientSourceUnit,
    sourceUnitIdentifier: item.sourceUnitIdentifier,
    clientCategory: item.clientCategory,
    clientItemOffering: item.clientItemOffering,
    itemSecondaryDescription: item.itemSecondaryDescription,
    clientSecondaryItemNumber: item.clientSecondaryItemNumber,
    requiredQuotes: item.requiredQuotes,
    qcThreshold: item.qcThreshold,
    requiredCompetitors: item.requiredCompetitors as string[],
    clientPrice: item.clientPrice,
    clientItemPrice: item.clientItemPrice,
    clientItemPriceCurrency: item.clientItemPriceCurrency,
    clientItemPriceQuantity: item.clientItemPriceQuantity,
  };
}
