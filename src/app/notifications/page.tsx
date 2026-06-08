import Link from "next/link";
import { requirePage } from "@/lib/identity/page-guards";
import { listNotifications, type NotificationView } from "@/lib/notifications/inbox";
import { MarkReadOnMount } from "./MarkReadOnMount";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720, lineHeight: 1.5 } as const;

// The in-app inbox (#17 / ADR-0020). Pull-based, any authenticated principal —
// a Researcher's rejections, a Client User's releases. Each notification is
// private to its recipient (the read is scoped to the caller). Unread rows are
// highlighted on this view, then marked read on mount so the badge clears next time.
export default async function NotificationsPage() {
  const principal = await requirePage();
  const items = await listNotifications(principal);

  return (
    <main style={wrap}>
      <MarkReadOnMount />
      <p style={{ marginTop: 0 }}>
        <Link href="/">← Home</Link>
      </p>
      <h1>Notifications</h1>
      {items.length === 0 ? (
        <p style={{ color: "#555" }}>No notifications yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {items.map((n) => (
            <NotificationRow key={n.id} notification={n} />
          ))}
        </ul>
      )}
    </main>
  );
}

function NotificationRow({ notification: n }: { notification: NotificationView }) {
  const unread = n.readAt === null;
  return (
    <li
      style={{
        padding: "0.7rem 0.9rem",
        marginBottom: "0.5rem",
        borderRadius: 6,
        border: "1px solid #eee",
        background: unread ? "#f3f7ff" : "white",
        display: "flex",
        gap: "0.7rem",
        alignItems: "baseline",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          marginTop: 6,
          borderRadius: "50%",
          background: unread ? "#2563eb" : "transparent",
          flex: "0 0 auto",
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{title(n)}</div>
        {n.kind === "quoteRejected" && n.reason && (
          <div style={{ color: "#555" }}>Reason: {n.reason}</div>
        )}
        {n.kind === "countryReleased" && (
          <div style={{ color: "#555" }}>
            <Link href={`/studies/${n.studyId}/dashboard`}>View released results →</Link>
          </div>
        )}
        <div style={{ color: "#999", fontSize: "0.85rem", marginTop: "0.2rem" }}>
          {n.createdAt.toLocaleString()}
        </div>
      </div>
    </li>
  );
}

function title(n: NotificationView): string {
  switch (n.kind) {
    case "quoteRejected":
      return "Your quote was rejected";
    case "countryReleased":
      return `Results released: ${n.country}`;
  }
}
