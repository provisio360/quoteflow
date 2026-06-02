import { acceptInviteAction } from "@/lib/identity/actions";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 420, lineHeight: 1.5 } as const;
const field = { display: "block", width: "100%", padding: "0.5rem", marginTop: "0.25rem" } as const;

const ERRORS: Record<string, string> = {
  "invalid-token": "This invite link is not valid.",
  revoked: "This invite has been revoked. Ask an admin for a new one.",
  "already-accepted": "This invite has already been used.",
  expired: "This invite has expired. Ask an admin to resend it.",
  malformed: "This invite is misconfigured. Ask an admin for a new one.",
  "email-in-use": "An account already exists for this email.",
  "missing-fields": "Please enter your name and a password.",
};

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  if (!token) {
    return (
      <main style={wrap}>
        <h1>Accept your invite</h1>
        <p role="alert" style={{ color: "#b00" }}>Missing invite token.</p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1>Accept your invite</h1>
      {error && (
        <p role="alert" style={{ color: "#b00" }}>
          {ERRORS[error] ?? "Something went wrong."}
        </p>
      )}
      <p>Set your name and a password to activate your QuoteFlow account.</p>
      <form action={acceptInviteAction}>
        <input type="hidden" name="token" value={token} />
        <label>
          Full name
          <input style={field} type="text" name="name" required />
        </label>
        <label style={{ display: "block", marginTop: "1rem" }}>
          Password (min 12 characters)
          <input
            style={field}
            type="password"
            name="password"
            minLength={12}
            autoComplete="new-password"
            required
          />
        </label>
        <button type="submit" style={{ marginTop: "1.25rem", padding: "0.5rem 1rem" }}>
          Activate account
        </button>
      </form>
    </main>
  );
}
