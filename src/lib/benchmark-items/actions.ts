"use server";

import { requirePrincipal } from "@/lib/identity/current-principal";
import { parseXlsx } from "./parse-xlsx";
import { importBenchmarkItems, type ImportOutcome } from "./repository";

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
