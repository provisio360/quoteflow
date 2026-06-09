"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/identity/current-principal";
import {
  assignResearchers,
  AssignmentAccessError,
  type AssignmentResult,
} from "./repository";

// Server action backing the (future) Country-assignment UI. Pure wiring:
// authenticate → pull the study/country/researcher selections off the form →
// hand to the principal-scoped repository, which owns authorization (EM-only),
// the study/country existence checks, researcher eligibility and the additive,
// all-or-nothing write (#6). This layer adds no domain logic.

export type AssignResearchersResult =
  | { readonly ok: true; readonly assigned: number }
  | { readonly ok: false; readonly message: string };

export async function assignResearchersAction(
  formData: FormData,
): Promise<AssignResearchersResult> {
  const principal = await requirePrincipal();

  const studyId = String(formData.get("studyId") ?? "");
  const country = String(formData.get("country") ?? "");
  const researcherIds = formData
    .getAll("researcherId")
    .map((v) => String(v))
    .filter((v) => v.length > 0);

  if (researcherIds.length === 0) {
    return { ok: false, message: "Select at least one researcher to assign" };
  }

  try {
    const result: AssignmentResult = await assignResearchers(
      principal,
      studyId,
      country,
      researcherIds,
    );
    return { ok: true, assigned: result.assigned };
  } catch (error) {
    // The repository raises AssignmentAccessError for permission/existence/
    // eligibility failures — surface its message; anything else re-throws.
    if (error instanceof AssignmentAccessError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

// Adapter to the React `useActionState` signature for the per-Country assign
// form. Revalidates the study page so the new assignment shows on refresh.
export async function assignResearchersFormAction(
  _prev: AssignResearchersResult | null,
  formData: FormData,
): Promise<AssignResearchersResult> {
  const result = await assignResearchersAction(formData);
  if (result.ok) revalidatePath(`/studies/${String(formData.get("studyId") ?? "")}`);
  return result;
}
