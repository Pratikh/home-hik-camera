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
import { Icon } from "@/components/ui/Icon";

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
 *
 * The app bar renders this control; the accessible name stays "Enable
 * notifications" even when the label is hidden on narrow viewports, so the
 * role/name contract is identical at every breakpoint.
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
    return <span className="section__hint">{Messages.notificationsUnsupported}</span>;
  }

  if (view === "on") {
    return (
      <span className="pill" title={Messages.notificationsGranted}>
        <span className="dot dot--online" />
        Notifications on
      </span>
    );
  }

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => void request()}
        disabled={!canRequestPermission(permission)}
        className="btn btn--sm"
        aria-label={Messages.enableNotifications}
        title="Allow this browser to show CCTV event notifications"
      >
        <Icon name="bell" className="icon icon-sm" />
        <span>{Messages.enableNotifications}</span>
      </button>
      {message ? (
        <span
          role="status"
          className="notice notice--accent"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 60,
            whiteSpace: "nowrap",
            padding: "8px 10px",
            fontSize: "var(--fs-12)",
          }}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
