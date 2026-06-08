"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/identity/current-principal";
import { markAllRead } from "./inbox";

// Server action backing the in-app inbox (#17). Read-on-open: the notifications
// page fires this on mount so the unread badge clears once the recipient has
// seen the list. Authenticates → marks only the caller's own unread rows read.
export async function markNotificationsReadAction(): Promise<void> {
  const principal = await requirePrincipal();
  await markAllRead(principal);
  // Refresh the badge (rendered from unreadCount) and the list's unread styling.
  revalidatePath("/notifications");
  revalidatePath("/");
}
