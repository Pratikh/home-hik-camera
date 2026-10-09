"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Messages } from "@/lib/messages";
import {
  canRequestPermission,
  permissionView,
  readPermission,
  SERVER_SNAPSHOT,
  type NotificationPermission,
} from "@/lib/notification-permission";

/** The browser permission is external, mutable state. */
function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !("Notification" in window)) return () => undefined;
  // Permissions can change outside React (browser settings), so poll lightly.
  const timer = setInterval(onChange, 2000);
  return () => clearInterval(timer);
}

/**
 * Enables browser notifications for any signed-in user on an explicit click.
 * This is deliberately separate from notification *rule* management, which is
 * ADMIN-only. A VIEWER can turn notification permission on here but can never
 * create, edit, or delete rules.
 *
 * Permission is never requested on page load — only after the user clicks.
 *
 * The server snapshot is a fixed constant, so the HTML rendered on the server
 * matches the client's hydration render. Reading `Notification.permission`
 * during the initial render instead would cause a hydration mismatch.
 */
export function NotificationPermissionButton() {
  const permission: NotificationPermission = useSyncExternalStore(
    subscribe,
    () => readPermission(),
    () => SERVER_SNAPSHOT,
  );
  const [message, setMessage] = useState<string | null>(null);

  const request = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setMessage(null);
    const next = await Notification.requestPermission();
    setMessage(next === "granted" ? Messages.notificationsGranted : Messages.notificationsDenied);
  }, []);

  const view = permissionView(permission);

  if (view === "unsupported") {
    return <span className="text-xs text-muted">{Messages.notificationsUnsupported}</span>;
  }

  if (view === "on") {
    return <span className="text-xs text-online">Notifications on</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void request()}
        disabled={!canRequestPermission(permission)}
        className="h-9 rounded-lg border border-line px-3 text-xs text-muted hover:bg-white/5 hover:text-ink"
        title="Allow this browser to show CCTV event notifications"
      >
        {Messages.enableNotifications}
      </button>
      {message ? <span className="text-[11px] text-muted" role="status">{message}</span> : null}
    </div>
  );
}