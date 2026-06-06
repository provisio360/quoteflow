"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/identity/current-principal";
import { parseXlsx } from "./parse-xlsx";
import { uploadProblem } from "./upload-validation";
import {
  importBenchmarkItems,
  selfAssignBenchmarkItem,
  setClientPrice,
  BenchmarkItemAccessError,
  type ImportOutcome,
} from "./repository";
import { parseClientPrice } from "@/domains/benchmark-items/client-price";

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

  // Same gate the browser applies before submit (issue #24), so the message is
  // identical whichever side catches it. A non-File form value is treated as no
  // upload.
  const formFile = formData.get("file");
  const file = formFile instanceof File ? formFile : null;
  const problem = uploadProblem(file);
  if (problem !== null || file === null) {
    return {
      ok: false,
      errors: [{ row: null, field: null, message: problem ?? "No spreadsheet uploaded" }],
    };
  }

  const grid = await parseXlsx(await file.arrayBuffer());
  return importBenchmarkItems(principal, studyId, grid);
}

// Adapter to the React `useActionState` signature `(prevState, formData)` for
// the upload form (issue #24). It only reshapes the call — the previous outcome
// is irrelevant to the next import — so #5's tested `importBenchmarkItemsAction`
// surface stays untouched.
export async function importBenchmarkItemsFormAction(
  _prevState: ImportOutcome | null,
  formData: FormData,
): Promise<ImportOutcome> {
  return importBenchmarkItemsAction(formData);
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

// Server action backing the analyst QC list's inline Client Price edit (issue
// #12). Wiring plus the pure value rule: authenticate → parse the raw input
// (blank clears to null, else a number > 0; ADR-0015) → hand the typed value to
// the Analyst-gated repository. On success the study page is revalidated so the
// list reflects the new (or cleared) benchmark. `studyId` is carried only to
// target the revalidation, not for authorization (the repository owns that).
export type SetClientPriceFormResult =
  | { readonly ok: true; readonly clientPrice: number | null }
  | { readonly ok: false; readonly message: string };

export async function setClientPriceAction(
  _prevState: SetClientPriceFormResult | null,
  formData: FormData,
): Promise<SetClientPriceFormResult> {
  const principal = await requirePrincipal();
  const itemId = String(formData.get("itemId") ?? "");
  const studyId = String(formData.get("studyId") ?? "");

  const parsed = parseClientPrice(String(formData.get("clientPrice") ?? ""));
  if (!parsed.ok) return { ok: false, message: parsed.message };

  try {
    const { clientPrice } = await setClientPrice(principal, itemId, parsed.value);
    if (studyId !== "") revalidatePath(`/studies/${studyId}`);
    return { ok: true, clientPrice };
  } catch (error) {
    if (error instanceof BenchmarkItemAccessError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}
