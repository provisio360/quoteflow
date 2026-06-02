import { prisma } from "@/lib/prisma";
import type { Principal } from "@/domains/authz/principal";
import { isInternal } from "@/domains/authz/principal";
import {
  canImportBenchmarkItems,
  canSelfAssignBenchmarkItem,
} from "@/domains/authz/benchmark-items";
import { getStudy } from "@/lib/studies/repository";
import {
  validateImport,
  type ImportError,
  type ValidatedBenchmarkItem,
} from "@/domains/benchmark-items/import";
import { resolveUpserts, benchmarkItemKey } from "@/domains/benchmark-items/resolve";

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

  const { inserted, updated } = await prisma.$transaction(async (tx) => {
    const existing = await tx.benchmarkItem.findMany({
      where: { studyId },
      select: { country: true, clientPartNumberKey: true },
    });
    const existingKeys = new Set(existing.map(benchmarkItemKey));

    const { inserts, updates } = resolveUpserts(validation.items, existingKeys);

    if (inserts.length > 0) {
      await tx.benchmarkItem.createMany({
        data: inserts.map((item) => toRow(studyId, item)),
      });
    }
    for (const item of updates) {
      await tx.benchmarkItem.update({
        where: {
          studyId_country_clientPartNumberKey: {
            studyId,
            country: item.country,
            clientPartNumberKey: item.clientPartNumberKey,
          },
        },
        data: toRow(studyId, item),
      });
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
  readonly clientPartNumber: string;
  readonly itemDescription: string;
  readonly configurationComment: string | null;
  readonly quantity: number | null;
  readonly machineModel: string;
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
  clientPartNumber: true,
  itemDescription: true,
  configurationComment: true,
  quantity: true,
  machineModel: true,
  requiredQuotes: true,
  primaryResearcherId: true,
} as const;

/**
 * Load one Benchmark Item as the Client-Price-hidden guidance view, or `null`
 * if it does not exist. Internal staff only — a client user gets an access
 * error (their released-data view is #14, not this work view).
 */
export async function getBenchmarkItemForResearcher(
  principal: Principal,
  itemId: string,
): Promise<ResearcherItemView | null> {
  if (!isInternal(principal)) {
    throw new BenchmarkItemAccessError("Internal staff only");
  }
  return prisma.benchmarkItem.findUnique({
    where: { id: itemId },
    select: RESEARCHER_VIEW_SELECT,
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

  const item = await prisma.benchmarkItem.findUnique({
    where: { id: itemId },
    select: { id: true, studyId: true, country: true },
  });
  if (item === null) {
    throw new BenchmarkItemAccessError(`Benchmark Item not found: ${itemId}`);
  }

  // The caller must be in the item's Country pool (#6). Only Researchers are ever
  // in a pool, so this also re-confirms the role at the data layer.
  const membership = await prisma.countryAssignment.findFirst({
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
  const claimed = await prisma.benchmarkItem.updateMany({
    where: { id: itemId, primaryResearcherId: null },
    data: { primaryResearcherId: principal.userId },
  });
  if (claimed.count === 1) {
    return { primaryResearcherId: principal.userId };
  }

  // The claim matched no row: the item already has a primary researcher.
  const current = await prisma.benchmarkItem.findUnique({
    where: { id: itemId },
    select: { primaryResearcherId: true },
  });
  if (current?.primaryResearcherId === principal.userId) {
    return { primaryResearcherId: principal.userId }; // idempotent re-claim
  }
  throw new BenchmarkItemAccessError(
    `Benchmark Item ${itemId} already has a primary researcher`,
  );
}

/** Map a validated item to its persisted columns (file is the source of truth —
 *  every column is written, including Client Price; ADR-0009). */
function toRow(studyId: string, item: ValidatedBenchmarkItem) {
  return {
    studyId,
    country: item.country,
    clientPartNumber: item.clientPartNumber,
    clientPartNumberKey: item.clientPartNumberKey,
    itemDescription: item.itemDescription,
    configurationComment: item.configurationComment,
    quantity: item.quantity,
    machineModel: item.machineModel,
    requiredQuotes: item.requiredQuotes,
    clientPrice: item.clientPrice,
  };
}
