"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/identity/current-principal";
import {
  setStudyRate,
  ExchangeRateAccessError,
  ExchangeRateValidationError,
} from "./repository";
import { rateValidationMessage } from "@/domains/exchange-rates/rates";

// Server action backing the Study Exchange Rate setup form (#160, ADR-0041). Pure
// wiring: authenticate → hand the raw fields to the principal-scoped repository,
// which owns authorization, validation and the upsert-by-key + audit. The action
// only reshapes the result for the same screen to render (a saved confirmation or
// the refusal message) and revalidates the page so the list reflects the write.

/** The outcome the /rates form renders. */
export type SetStudyRateOutcome =
  | { readonly ok: true; readonly currency: string; readonly rateDate: string; readonly changed: boolean }
  | { readonly ok: false; readonly message: string };

export async function setStudyRateAction(
  _prevState: SetStudyRateOutcome | null,
  formData: FormData,
): Promise<SetStudyRateOutcome> {
  const principal = await requirePrincipal();
  const studyId = String(formData.get("studyId") ?? "");
  const input = {
    currency: String(formData.get("currency") ?? ""),
    rateDate: String(formData.get("rateDate") ?? ""),
    rate: String(formData.get("rate") ?? ""),
  };

  try {
    const result = await setStudyRate(principal, studyId, input);
    revalidatePath(`/studies/${studyId}/rates`);
    return {
      ok: true,
      currency: result.rate.currency,
      rateDate: result.rate.rateDate,
      changed: result.changed,
    };
  } catch (error) {
    if (error instanceof ExchangeRateValidationError) {
      return { ok: false, message: rateValidationMessage(error.code) };
    }
    if (error instanceof ExchangeRateAccessError) {
      return { ok: false, message: "You may not set exchange rates for this study." };
    }
    throw error;
  }
}
