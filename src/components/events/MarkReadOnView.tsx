"use client";

import { useEffect } from "react";
import { api } from "@/lib/client-api";

/**
 * Opening an event marks it read. This is a best-effort side effect: a failure
 * never blocks the page.
 */
export function MarkReadOnView({ eventId }: { eventId: string }) {
  useEffect(() => {
    void api(`/api/events/${eventId}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    }).catch(() => undefined);
  }, [eventId]);
  return null;
}