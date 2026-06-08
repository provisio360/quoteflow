"use client";

import { useEffect } from "react";
import { markNotificationsReadAction } from "@/lib/notifications/actions";

// Read-on-open (#17 / ADR-0020): once the inbox has rendered for the recipient,
// mark their unread notifications read so the badge clears on the next view. The
// list still renders this view's unread styling from server state captured before
// this fires.
export function MarkReadOnMount() {
  useEffect(() => {
    void markNotificationsReadAction();
  }, []);
  return null;
}
