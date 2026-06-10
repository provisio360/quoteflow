import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCurrentPrincipal } from "@/lib/identity/current-principal";
import { logoutAction } from "@/lib/identity/actions";
import { canReviewQuote } from "@/domains/authz/quotes";
import { NotificationsLink } from "@/app/notifications/NotificationsLink";

// Persistent role-aware nav (ADR-0022). Renders nothing for an unauthenticated
// request, so /login and /accept-invite stay chrome-free. Links are filtered by
// role from the live principal — the same predicates the pages enforce, so the
// header never offers a destination the target would just bounce from.

const bar = {
  display: "flex",
  alignItems: "center",
  gap: "1rem",
  padding: "0.6rem 1.25rem",
  borderBottom: "1px solid #ddd",
  fontFamily: "system-ui, sans-serif",
  fontSize: "0.95rem",
} as const;

export async function NavHeader() {
  const principal = await getCurrentPrincipal();
  if (principal === null) return null;

  const session = await auth.api.getSession({ headers: await headers() });
  const name = session?.user?.name ?? "Signed in";

  const isInternal = principal.kind === "internal";
  const who = isInternal
    ? `${name} (${principal.role})`
    : `${name} (Client)`;

  return (
    <header style={bar}>
      <Link href="/" style={{ fontWeight: 700 }}>
        QuoteFlow
      </Link>

      <nav style={{ display: "flex", gap: "0.9rem", flex: 1 }}>
        {isInternal && <Link href="/studies">Studies</Link>}
        {canReviewQuote(principal) && <Link href="/review">Review</Link>}
        {isInternal && principal.role === "Admin" && <Link href="/admin">Admin</Link>}
        <NotificationsLink />
      </nav>

      <span style={{ color: "#555" }}>{who}</span>
      <form action={logoutAction}>
        <button type="submit" style={{ padding: "0.3rem 0.7rem" }}>
          Log out
        </button>
      </form>
    </header>
  );
}
