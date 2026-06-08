import type { NotificationKind } from "./events";

// Pure rendering of a notification into a plain-text email (issue #17). Kept out
// of the worker so it is unit-testable without a DB or the email vendor. Carries
// only what the in-app notification snapshots — a rejection reason, or a released
// country + study name — and NEVER a Client Price or quote figure (ADR-0003).

export interface RenderedEmail {
  readonly subject: string;
  readonly body: string;
}

/** The snapshot fields the worker resolves for a notification, plus the study
 *  name it joins for context. */
export interface RenderInput {
  readonly kind: NotificationKind;
  readonly reason: string | null;
  readonly country: string | null;
  readonly studyName: string;
}

export function renderNotificationEmail(input: RenderInput): RenderedEmail {
  switch (input.kind) {
    case "quoteRejected":
      return {
        subject: "Your quote was rejected",
        body:
          `Your quote in “${input.studyName}” was rejected.\n\n` +
          `Reason: ${input.reason ?? ""}\n\n` +
          `Sign in to QuoteFlow to revise and resubmit it.`,
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
