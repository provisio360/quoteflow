import { loginAction } from "@/lib/identity/actions";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 420, lineHeight: 1.5 } as const;
const field = { display: "block", width: "100%", padding: "0.5rem", marginTop: "0.25rem" } as const;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main style={wrap}>
      <h1>Sign in to QuoteFlow</h1>
      {error === "invalid-credentials" && (
        <p role="alert" style={{ color: "#b00" }}>
          Incorrect email or password.
        </p>
      )}
      <form action={loginAction}>
        <label>
          Email
          <input style={field} type="email" name="email" autoComplete="username" required />
        </label>
        <label style={{ display: "block", marginTop: "1rem" }}>
          Password
          <input style={field} type="password" name="password" autoComplete="current-password" required />
        </label>
        <button type="submit" style={{ marginTop: "1.25rem", padding: "0.5rem 1rem" }}>
          Sign in
        </button>
      </form>
      <p style={{ marginTop: "1.5rem", fontSize: "0.9rem", color: "#555" }}>
        QuoteFlow is invite-only — there is no public sign-up. Ask an admin for an invite.
      </p>
    </main>
  );
}
