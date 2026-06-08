// Notifications email port (thin adapter, ADR-0020). One signature, two backends:
// when RESEND_API_KEY is set it delivers via Resend; otherwise it logs the message
// so invite / password-reset / notification flows stay fully exercisable in
// dev/test without an email vendor. Callers (identity flows, the notification
// worker) never know which backend ran.

export interface OutboundEmail {
  to: string;
  subject: string;
  /** Plain-text body. Any link the recipient must click is included inline. */
  body: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendEmail(email: OutboundEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // No vendor configured (dev/test): log so flows are observable. Never logs
    // passwords/hashes — callers pass links inline, not secrets.
    console.info(
      `[notifications] (stub) email to=${email.to} subject=${JSON.stringify(
        email.subject,
      )}\n${email.body}`,
    );
    return;
  }

  // Resend delivery. A non-2xx is thrown so the graphile job retries (the email
  // channel is at-least-once; the in-app notification already persisted).
  const from = process.env.RESEND_FROM ?? "QuoteFlow <notifications@quoteflow.app>";
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email.to,
      subject: email.subject,
      text: email.body,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend delivery failed (${response.status}): ${detail}`);
  }
}
