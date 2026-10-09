/**
 * Browser notification permission handling.
 *
 * Kept as pure, dependency-free logic so it can be unit tested without a DOM.
 * The component that uses it is `NotificationPermissionButton`.
 */

export type NotificationPermission = "unsupported" | "default" | "granted" | "denied";

/** What the control should render for a given permission. */
export type PermissionView = "unsupported" | "on" | "enable";

/**
 * The value rendered during server-side rendering and the client's first paint.
 *
 * This MUST be a single fixed value. `Notification.permission` cannot be read on
 * the server, so using a browser-dependent value for the initial render causes a
 * hydration mismatch, which React resolves by regenerating the tree and which
 * previously made the login page reload in a loop.
 */
export const SERVER_SNAPSHOT: NotificationPermission = "default";

export function permissionView(permission: NotificationPermission): PermissionView {
  if (permission === "unsupported") return "unsupported";
  if (permission === "granted") return "on";
  return "enable";
}

/** Whether the component should call Notification.requestPermission(). */
export function canRequestPermission(permission: NotificationPermission): boolean {
  return permission !== "unsupported";
}

/** Read the live permission safely, including when there is no browser. */
export function readPermission(source?: { Notification?: { permission?: string } }): NotificationPermission {
  const target = source ?? (typeof window !== "undefined" ? (window as unknown as { Notification?: { permission?: string } }) : undefined);
  if (!target || !target.Notification) return "unsupported";
  const value = target.Notification.permission;
  if (value === "granted" || value === "denied" || value === "default") return value;
  return "unsupported";
}

/**
 * The hydration render must use a value that does not depend on the browser.
 *
 * React renders `getServerSnapshot()` during hydration and only switches to
 * `getSnapshot()` after hydration completes, so the client's hydration render
 * matches the server's as long as the server snapshot is a fixed constant.
 *
 * This is the invariant that prevents the mismatch: if the snapshot used for
 * hydration varied by environment, the two trees would differ.
 */
export function isHydrationSafe(snapshot: NotificationPermission): boolean {
  return snapshot === SERVER_SNAPSHOT;
}

/** The view rendered during hydration on any environment. */
export function hydrationView(): PermissionView {
  return permissionView(SERVER_SNAPSHOT);
}