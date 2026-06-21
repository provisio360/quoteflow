"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/identity/current-principal";
import { createStudy, StudyAccessError } from "./repository";

// Server action behind the "new study" form. Pure wiring: authenticate → parse →
// hand to the principal-scoped repository, which owns the EM/Analyst role gate
// (domains/authz/studies). The QC Threshold is captured at setup because flagging
// needs it from day one (ADR-0014).

export type CreateStudyResult = { ok: true; id: string } | { ok: false; error: string };

export async function createStudyAction(
  _prev: CreateStudyResult | null,
  formData: FormData,
): Promise<CreateStudyResult> {
  const principal = await requirePrincipal();
  const name = String(formData.get("name") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "");
  // The form takes a percentage (EM-friendly), but the QC Threshold is stored and
  // compared as a FRACTION everywhere (#86) — convert at this boundary.
  const qcThresholdPct = Number(String(formData.get("qcThresholdPct") ?? ""));

  if (name === "") return { ok: false, error: "Enter a study name." };
  if (clientId === "") return { ok: false, error: "Pick a client." };
  if (!Number.isFinite(qcThresholdPct) || qcThresholdPct <= 0) {
    return { ok: false, error: "QC threshold must be a number greater than 0." };
  }

  try {
    const study = await createStudy(principal, { name, clientId, qcThreshold: qcThresholdPct / 100 });
    revalidatePath("/studies");
    return { ok: true, id: study.id };
  } catch (error) {
    if (error instanceof StudyAccessError) return { ok: false, error: error.message };
    throw error;
  }
}
