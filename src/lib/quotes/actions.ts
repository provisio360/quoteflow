"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/identity/current-principal";
import {
  createMarketQuote,
  addQuoteLine,
  seedMarketQuote,
  updateDraftLine,
  batchUpdateDraftLines,
  updateMarketQuote,
  deleteDraftLine,
  submitMarketQuote,
  approveLine,
  rejectLine,
  reviseLine,
  setMarketQuoteManualRate,
  QuoteAccessError,
  type MarketQuoteHeaderFields,
  type QuoteLineFields,
  type SetManualRateResult,
} from "./repository";
import type { TransitionResult, SubmitDocumentResult } from "@/domains/quotes/lifecycle";

/** A verdict/transition result, or an access failure surfaced as a message. */
export type QuoteTransitionActionResult =
  | TransitionResult
  | { readonly ok: false; readonly reason: "access"; readonly message: string };

/** A bulk-submit result, or an access failure surfaced as a message (#88). */
export type SubmitMarketQuoteActionResult =
  | SubmitDocumentResult
  | { readonly ok: false; readonly reason: "access"; readonly message: string };

// Server actions backing the Market Quote entry form (#87). Pure wiring:
// authenticate → hand to the principal-scoped repository, which owns the role
// gate, Country-pool check, atomic numbering, owner-only writes and the lifecycle
// transition. This layer adds no domain logic.

export type CreateMarketQuoteActionResult =
  | { readonly ok: true; readonly id: string; readonly marketQuoteNumber: number }
  | { readonly ok: false; readonly message: string };

export async function createMarketQuoteAction(
  studyId: string,
  country: string,
  header: MarketQuoteHeaderFields,
): Promise<CreateMarketQuoteActionResult> {
  const principal = await requirePrincipal();
  try {
    const { id, marketQuoteNumber } = await createMarketQuote(principal, studyId, country, header);
    return { ok: true, id, marketQuoteNumber };
  } catch (error) {
    if (error instanceof QuoteAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Seed a new Market Quote from a Quote Group selection (ADR-0038, #140/#141): one
 *  document + one Draft line per selected part, atomically. The dealer + batch step's
 *  transient values arrive as one document-uniform `fields`, stamped onto every line
 *  at creation (#141); it defaults to blank. Reuses CreateMarketQuoteActionResult —
 *  the caller gets the new document's id/number. */
export async function seedMarketQuoteAction(
  studyId: string,
  country: string,
  header: MarketQuoteHeaderFields,
  itemIds: readonly string[],
  fields: QuoteLineFields = {},
): Promise<CreateMarketQuoteActionResult> {
  const principal = await requirePrincipal();
  try {
    const { id, marketQuoteNumber } = await seedMarketQuote(
      principal,
      studyId,
      country,
      header,
      itemIds,
      fields,
    );
    revalidatePath("/studies");
    return { ok: true, id, marketQuoteNumber };
  } catch (error) {
    if (error instanceof QuoteAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

export type AddQuoteLineActionResult =
  | { readonly ok: true; readonly id: string; readonly quoteLineNumber: number }
  | { readonly ok: false; readonly message: string };

export async function addQuoteLineAction(
  marketQuoteId: string,
  benchmarkItemId: string,
  fields: QuoteLineFields,
): Promise<AddQuoteLineActionResult> {
  const principal = await requirePrincipal();
  try {
    const { id, quoteLineNumber } = await addQuoteLine(principal, marketQuoteId, benchmarkItemId, fields);
    return { ok: true, id, quoteLineNumber };
  } catch (error) {
    if (error instanceof QuoteAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function updateDraftLineAction(
  lineId: string,
  fields: QuoteLineFields,
): Promise<{ readonly ok: boolean; readonly message?: string }> {
  const principal = await requirePrincipal();
  try {
    await updateDraftLine(principal, lineId, fields);
    return { ok: true };
  } catch (error) {
    if (error instanceof QuoteAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Author convenience: batch line-fill (#128 / ADR-0036). Stamps one group of line
 *  fields onto every Draft line of the document at once; the repository gates it
 *  owner-only + Draft-only. Unlike the single-line edit (optimistic), a batch write
 *  touches many lines, so it revalidates the study screen the researcher fills from. */
export async function batchUpdateDraftLinesAction(
  marketQuoteId: string,
  group: QuoteLineFields,
): Promise<{ readonly ok: boolean; readonly message?: string }> {
  const principal = await requirePrincipal();
  try {
    await batchUpdateDraftLines(principal, marketQuoteId, group);
    revalidatePath("/studies");
    return { ok: true };
  } catch (error) {
    if (error instanceof QuoteAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Author action: edit a Draft Market Quote's header (source/date/currency). The
 *  repository gates it owner-only + unconverted-only (#97). */
export async function updateMarketQuoteAction(
  marketQuoteId: string,
  header: MarketQuoteHeaderFields,
): Promise<{ readonly ok: boolean; readonly message?: string }> {
  const principal = await requirePrincipal();
  try {
    await updateMarketQuote(principal, marketQuoteId, header);
    return { ok: true };
  } catch (error) {
    if (error instanceof QuoteAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function deleteDraftLineAction(
  lineId: string,
): Promise<{ readonly ok: boolean; readonly message?: string }> {
  const principal = await requirePrincipal();
  try {
    await deleteDraftLine(principal, lineId);
    return { ok: true };
  } catch (error) {
    if (error instanceof QuoteAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Bulk-submit a Market Quote document (#88): all its Draft lines together, all-or-
 *  nothing. Returns the core's result so the UI can show the per-line missing-field
 *  report, the no-draft-lines case, or success. Revalidates the study screen the
 *  researcher submits from. */
export async function submitMarketQuoteAction(
  marketQuoteId: string,
): Promise<SubmitMarketQuoteActionResult> {
  const principal = await requirePrincipal();
  try {
    const result = await submitMarketQuote(principal, marketQuoteId);
    if (result.ok) revalidatePath("/studies");
    return result;
  } catch (error) {
    if (error instanceof QuoteAccessError) {
      return { ok: false, reason: "access", message: error.message };
    }
    throw error;
  }
}

/** Analyst verdict: approve a Submitted Quote Line. */
export async function approveLineAction(
  lineId: string,
): Promise<QuoteTransitionActionResult> {
  const principal = await requirePrincipal();
  try {
    const result = await approveLine(principal, lineId);
    if (result.ok) revalidatePath("/review");
    return result;
  } catch (error) {
    if (error instanceof QuoteAccessError) {
      return { ok: false, reason: "access", message: error.message };
    }
    throw error;
  }
}

/** Analyst verdict: reject a Submitted Quote Line with a reason. */
export async function rejectLineAction(
  lineId: string,
  reason: string,
): Promise<QuoteTransitionActionResult> {
  const principal = await requirePrincipal();
  try {
    const result = await rejectLine(principal, lineId, reason);
    if (result.ok) revalidatePath("/review");
    return result;
  } catch (error) {
    if (error instanceof QuoteAccessError) {
      return { ok: false, reason: "access", message: error.message };
    }
    throw error;
  }
}

/** A manual-rate result, or an access failure surfaced as a message (#70). */
export type SetManualRateActionResult =
  | SetManualRateResult
  | { readonly ok: false; readonly reason: "access"; readonly message: string };

/** Analyst action: set a manual Exchange Rate on a pending Market Quote (#70). */
export async function setMarketQuoteManualRateAction(
  marketQuoteId: string,
  rate: string,
): Promise<SetManualRateActionResult> {
  const principal = await requirePrincipal();
  try {
    const result = await setMarketQuoteManualRate(principal, marketQuoteId, rate);
    if (result.ok) revalidatePath("/review");
    return result;
  } catch (error) {
    if (error instanceof QuoteAccessError) {
      return { ok: false, reason: "access", message: error.message };
    }
    throw error;
  }
}

/** Author action: return a Rejected Quote Line to Draft to revise and resubmit. */
export async function reviseLineAction(
  lineId: string,
): Promise<QuoteTransitionActionResult> {
  const principal = await requirePrincipal();
  try {
    const result = await reviseLine(principal, lineId);
    if (result.ok) revalidatePath("/review");
    return result;
  } catch (error) {
    if (error instanceof QuoteAccessError) {
      return { ok: false, reason: "access", message: error.message };
    }
    throw error;
  }
}
