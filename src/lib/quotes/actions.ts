"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/identity/current-principal";
import {
  createDraftQuote,
  updateDraftQuote,
  deleteDraftQuote,
  submitQuote,
  approveQuote,
  rejectQuote,
  reviseQuote,
  QuoteAccessError,
  type QuoteFields,
} from "./repository";
import type { TransitionResult } from "@/domains/quotes/lifecycle";

/** A verdict/transition result, or an access failure surfaced as a message. */
export type QuoteTransitionActionResult =
  | TransitionResult
  | { readonly ok: false; readonly reason: "access"; readonly message: string };

// Server actions backing the (future) Quote entry form (#8). Pure wiring:
// authenticate → hand to the principal-scoped repository, which owns the role
// gate, Country-pool check, atomic numbering, owner-only writes and the
// lifecycle transition. This layer adds no domain logic.

export type QuoteActionResult =
  | { readonly ok: true; readonly id: string; readonly quoteNumber: number }
  | { readonly ok: false; readonly message: string };

export async function createDraftQuoteAction(
  itemId: string,
  fields: QuoteFields,
): Promise<QuoteActionResult> {
  const principal = await requirePrincipal();
  try {
    const { id, quoteNumber } = await createDraftQuote(principal, itemId, fields);
    return { ok: true, id, quoteNumber };
  } catch (error) {
    if (error instanceof QuoteAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function updateDraftQuoteAction(
  quoteId: string,
  fields: QuoteFields,
): Promise<{ readonly ok: boolean; readonly message?: string }> {
  const principal = await requirePrincipal();
  try {
    await updateDraftQuote(principal, quoteId, fields);
    return { ok: true };
  } catch (error) {
    if (error instanceof QuoteAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function deleteDraftQuoteAction(
  quoteId: string,
): Promise<{ readonly ok: boolean; readonly message?: string }> {
  const principal = await requirePrincipal();
  try {
    await deleteDraftQuote(principal, quoteId);
    return { ok: true };
  } catch (error) {
    if (error instanceof QuoteAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Submit a Draft Quote. Returns the lifecycle core's result so the UI can show
 * the missing-fields list or the illegal-transition case; throws-as-access-error
 * only for permission/not-found, surfaced as a message.
 */
export async function submitQuoteAction(
  quoteId: string,
): Promise<QuoteTransitionActionResult> {
  const principal = await requirePrincipal();
  try {
    return await submitQuote(principal, quoteId);
  } catch (error) {
    if (error instanceof QuoteAccessError) {
      return { ok: false, reason: "access", message: error.message };
    }
    throw error;
  }
}

/**
 * Analyst verdict: approve a Submitted Quote. The conversion-pending and
 * flagged-needs-justification gates live in the repository/core; this layer only
 * authenticates and refreshes the queue on success.
 */
export async function approveQuoteAction(
  quoteId: string,
): Promise<QuoteTransitionActionResult> {
  const principal = await requirePrincipal();
  try {
    const result = await approveQuote(principal, quoteId);
    if (result.ok) revalidatePath("/review");
    return result;
  } catch (error) {
    if (error instanceof QuoteAccessError) {
      return { ok: false, reason: "access", message: error.message };
    }
    throw error;
  }
}

/**
 * Analyst verdict: reject a Submitted Quote with a reason (also the
 * "return for justification" path). The reason must be non-blank (core guard).
 */
export async function rejectQuoteAction(
  quoteId: string,
  reason: string,
): Promise<QuoteTransitionActionResult> {
  const principal = await requirePrincipal();
  try {
    const result = await rejectQuote(principal, quoteId, reason);
    if (result.ok) revalidatePath("/review");
    return result;
  } catch (error) {
    if (error instanceof QuoteAccessError) {
      return { ok: false, reason: "access", message: error.message };
    }
    throw error;
  }
}

/** Author action: return a Rejected Quote to Draft to revise and resubmit. */
export async function reviseQuoteAction(
  quoteId: string,
): Promise<QuoteTransitionActionResult> {
  const principal = await requirePrincipal();
  try {
    const result = await reviseQuote(principal, quoteId);
    if (result.ok) revalidatePath("/review");
    return result;
  } catch (error) {
    if (error instanceof QuoteAccessError) {
      return { ok: false, reason: "access", message: error.message };
    }
    throw error;
  }
}
