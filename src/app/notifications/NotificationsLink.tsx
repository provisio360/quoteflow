import Link from "next/link";
import { getCurrentPrincipal } from "@/lib/identity/current-principal";
import { unreadCount } from "@/lib/notifications/inbox";

// The notifications entry point + unread badge (#17). A small server component
// dropped onto authenticated landing screens (there is no shared nav in v1).
// Renders nothing for an unauthenticated request; shows the unread count when > 0.
export async function NotificationsLink() {
  const principal = await getCurrentPrincipal();
  if (principal === null) return null;

  const count = await unreadCount(principal);
  return (
    <Link href="/notifications">
      🔔 Notifications
      {count > 0 && (
        <span
          aria-label={`${count} unread`}
          style={{
            marginLeft: "0.4rem",
            padding: "0 0.45rem",
            borderRadius: "999px",
            background: "#d33",
            color: "white",
            fontSize: "0.8rem",
            fontWeight: 600,
          }}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
