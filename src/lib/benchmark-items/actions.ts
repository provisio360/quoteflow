"use server";

import { requirePrincipal } from "@/lib/identity/current-principal";
import { parseXlsx } from "./parse-xlsx";
import {
  importBenchmarkItems,
  selfAssignBenchmarkItem,
  BenchmarkItemAccessError,
  type ImportOutcome,
} from "./repository";

// Server action backing the (future) brief-upload form. It is pure wiring:
// authenticate → parse the .xlsx to a raw grid (thin adapter) → hand to the
// principal-scoped repository, which validates and upserts all-or-nothing
// (ADR-0009). The repository owns authorization and tenant scoping; this layer
// only turns an uploaded file into the grid the validator expects, and returns
// the outcome (insert/update counts or the per-row error report) for the UI.

export async function importBenchmarkItemsAction(
  formData: FormData,
): Promise<ImportOutcome> {
  const principal = await requirePrincipal();

  const studyId = String(formData.get("studyId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, errors: [{ row: null, field: null, message: "No spreadsheet uploaded" }] };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, errors: [{ row: null, field: null, message: "File must be a .xlsx spreadsheet" }] };
  }

  const grid = await parseXlsx(await file.arrayBuffer());
  return importBenchmarkItems(principal, studyId, grid);
}

// Server action backing the (future) researcher item-list "claim" control (#7).
// Pure wiring: authenticate → hand the item id to the principal-scoped
// repository, which owns the Researcher role gate, the Country-pool check and the
// first-come atomic claim. This layer adds no domain logic.

export type SelfAssignResult =
  | { readonly ok: true; readonly primaryResearcherId: string }
  | { readonly ok: false; readonly message: string };

export async function selfAssignBenchmarkItemAction(
  formData: FormData,
): Promise<SelfAssignResult> {
  const principal = await requirePrincipal();
  const itemId = String(formData.get("itemId") ?? "");

  try {
    const { primaryResearcherId } = await selfAssignBenchmarkItem(principal, itemId);
    return { ok: true, primaryResearcherId };
  } catch (error) {
    // The repository raises BenchmarkItemAccessError for permission/not-found/
    // not-in-pool/already-claimed — surface its message; anything else re-throws.
    if (error instanceof BenchmarkItemAccessError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}
