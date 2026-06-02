import { prisma } from "@/lib/prisma";
import type { Principal } from "@/domains/authz/principal";
import { canImportBenchmarkItems } from "@/domains/authz/benchmark-items";
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
