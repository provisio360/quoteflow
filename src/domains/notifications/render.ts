import type { NotificationKind } from "./events";

// Pure rendering of a notification into a plain-text email (issue #17, ADR-0031).
// Kept out of the worker so it is unit-testable without a DB or the email vendor.
// Carries the rejection reason + its quote context (study/country/quote refs and a
// deep-link), or a released country + study name — and NEVER a Client Price or
// quote figure (ADR-0003; the reason states only divergence direction).

export interface RenderedEmail {
  readonly subject: string;
  readonly body: string;
}

/** The fields the worker resolves for a notification: the snapshot reason (a
 *  rejection) and the study name + quote context joined live from the subject
 *  line. The quote refs and link are null for a release. */
export interface RenderInput {
  readonly kind: NotificationKind;
  readonly reason: string | null;
  readonly country: string | null;
  readonly studyName: string;
  readonly marketQuoteNumber: number | null;
  readonly quoteLineNumber: number | null;
  readonly linkUrl: string | null;
}

export function renderNotificationEmail(input: RenderInput): RenderedEmail {
  switch (input.kind) {
    case "quoteRejected":
      return {
        subject: "Your quote was rejected",
        body:
          `Your quote was rejected.\n\n` +
          `Study: ${input.studyName}\n` +
          `Country: ${input.country ?? ""}\n` +
          `Market quote ${input.marketQuoteNumber ?? ""}, line ${input.quoteLineNumber ?? ""}\n\n` +
          `Reason: ${input.reason ?? ""}\n\n` +
          `Revise and resubmit it: ${input.linkUrl ?? ""}`,
      };
    case "countryReleased":
      return {
        subject: `Results released: ${input.country}`,
        body:
          `Approved results for ${input.country} in “${input.studyName}” are now available.\n\n` +
          `Sign in to QuoteFlow to view them.`,
      };
  }
}
