import { requireAdminPage } from "@/lib/identity/page-guards";
import { listClients } from "@/lib/clients/repository";
import { NewClientForm } from "./NewClientForm";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720, lineHeight: 1.5 } as const;

// The Admin area (ADR-0022): tenant + identity administration. Clients here;
// Invites land in the next slice. Admin-only — requireAdminPage bounces everyone
// else to /login (ADR-0008: no 403 that confirms what lies beyond).
export default async function AdminPage() {
  const principal = await requireAdminPage();
  const clients = await listClients(principal);

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
    </main>
  );
}
