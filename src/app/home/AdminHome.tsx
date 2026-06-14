import Link from "next/link";
import { countInviteHygiene } from "@/lib/identity/invites";
import { ZeroState } from "./ZeroState";

// Admin home (#56). User-administration is the Admin's whole remit, so the home
// points at invite work: two derived signals — open offers still awaiting
// acceptance, and the lapsed-unaccepted ones (the resend candidates) — plus a
// launchpad into /admin (the existing revoke/resend surface). Counts come from
// the invites repository (countInviteHygiene), never an ad-hoc query in the
// page. Each signal falls to the shared ZeroState convention at zero.
export async function AdminHome() {
  const { pending, expired } = await countInviteHygiene();

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Admin</h2>

      {pending === 0 ? (
        <ZeroState message="No pending invites." />
      ) : (
        <p style={{ margin: "0.25rem 0" }}>{pending} pending invites</p>
      )}

      {expired === 0 ? (
        <ZeroState message="No expired invites — nothing to resend." />
      ) : (
        <p style={{ margin: "0.25rem 0" }}>{expired} expired invites awaiting resend</p>
      )}

      <p style={{ marginTop: "0.75rem" }}>
        <Link href="/admin" style={{ fontWeight: 600 }}>
          Manage users →
        </Link>
      </p>
    </section>
  );
}
