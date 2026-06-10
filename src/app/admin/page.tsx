import { requireAdminPage } from "@/lib/identity/page-guards";
import { listClients } from "@/lib/clients/repository";
import { listInvites } from "@/lib/identity/invites";
import { NewClientForm } from "./NewClientForm";
import { InviteForm } from "./InviteForm";
import { InviteRow } from "./InviteRow";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720, lineHeight: 1.5 } as const;

// The Admin area (ADR-0022): tenant + identity administration. Clients here;
// Invites land in the next slice. Admin-only — requireAdminPage bounces everyone
// else to /login (ADR-0008: no 403 that confirms what lies beyond).
export default async function AdminPage() {
  const principal = await requireAdminPage();
  const clients = await listClients(principal);
  const invites = await listInvites();

  return (
    <main style={wrap}>
      <h1>Admin</h1>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Clients</h2>
        <p style={{ color: "#555" }}>
          A Client is a tenant company. Create one before setting up its study and inviting its users.
        </p>
        <NewClientForm />
        {clients.length === 0 ? (
          <p style={{ color: "#777" }}>No clients yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {clients.map((c) => (
              <li key={c.id} style={{ padding: "0.3rem 0", borderTop: "1px solid #eee" }}>
                {c.name}
                <span style={{ color: "#999", marginLeft: "0.5rem", fontSize: "0.85rem" }}>
                  added {c.createdAt.toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: "2.5rem" }}>
        <h2>Invites</h2>
        <p style={{ color: "#555" }}>
          Invite staff (with a role) or a client&apos;s users (bound to their company). The accept-link
          is shown here to copy — email delivery turns on when Resend is configured (#42).
        </p>
        <InviteForm clients={clients} />
        {invites.length === 0 ? (
          <p style={{ color: "#777" }}>No invites yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {invites.map((inv) => (
              <InviteRow key={inv.id} invite={inv} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
