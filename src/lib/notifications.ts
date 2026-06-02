// Notifications port (thin adapter). Real email delivery via Resend is issue #17;
// until then this logs the message so the invite / password-reset flows are fully
// exercisable end-to-end without coupling identity to the email vendor.
//
// Keeping this behind a port means #17 swaps the implementation, not the callers.

export interface OutboundEmail {
  to: string;
  subject: string;
  /** Plain-text body. The link the recipient must click is included inline. */
  body: string;
}

export async function sendEmail(email: OutboundEmail): Promise<void> {
  // TODO(#17): deliver via Resend behind this same signature.
  // For now, log so flows are observable in dev/test. Never logs passwords/hashes.
  console.info(
    `[notifications] (stub) email to=${email.to} subject=${JSON.stringify(
      email.subject,
    )}\n${email.body}`,
  );
}
