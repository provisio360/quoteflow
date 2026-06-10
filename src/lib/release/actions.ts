"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/identity/current-principal";
import { releaseCountry, reopenCountry, ReleaseAccessError } from "./repository";
import type { ReleaseEligibility } from "@/domains/release/eligibility";

// Server actions behind the Analyst release gate (#13). Pure wiring: authenticate
// → hand study/country to the principal-scoped repository, which owns the Analyst
// role gate, the atomic re-check-and-upsert (ADR-0016) and the once-only client
// notification (ADR-0020). releaseCountry returns the eligibility verbatim — when
// not releasable it writes nothing, and the UI shows why.

export type ReleaseActionResult =
  | { ok: true; eligibility: ReleaseEligibility }
  | { ok: false; message: string };

export async function releaseCountryAction(
  _prev: ReleaseActionResult | null,
  formData: FormData,
): Promise<ReleaseActionResult> {
  const principal = await requirePrincipal();
  const studyId = String(formData.get("studyId") ?? "");
  const country = String(formData.get("country") ?? "");
  try {
    const eligibility = await releaseCountry(principal, studyId, country);
    revalidatePath(`/studies/${studyId}`);
    return { ok: true, eligibility };
  } catch (error) {
    if (error instanceof ReleaseAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

export type ReopenActionResult = { ok: true } | { ok: false; message: string };

export async function reopenCountryAction(
  _prev: ReopenActionResult | null,
  formData: FormData,
): Promise<ReopenActionResult> {
  const principal = await requirePrincipal();
  const studyId = String(formData.get("studyId") ?? "");
  const country = String(formData.get("country") ?? "");
  try {
    await reopenCountry(principal, studyId, country);
    revalidatePath(`/studies/${studyId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ReleaseAccessError) return { ok: false, message: error.message };
    throw error;
  }
}
