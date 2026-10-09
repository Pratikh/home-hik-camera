import { describe, expect, it } from "vitest";
import {
  canRequestPermission,
  hydrationView,
  isHydrationSafe,
  permissionView,
  readPermission,
  SERVER_SNAPSHOT,
  type NotificationPermission,
} from "@/lib/notification-permission";

/**
 * Regression tests for the login-page reload loop.
 *
 * The loop was caused by a hydration mismatch: the notification permission
 * control read `Notification.permission` during its first render. On the server
 * that read is impossible (it returned "unsupported"), while in the browser it
 * returned "default", so the two trees differed. React regenerated the tree,
 * and the page reloaded repeatedly.
 *
 * The fix is that the render used during hydration must come from a fixed
 * server snapshot, never from the browser. These tests pin that invariant.
 */
describe("notification permission hydration safety", () => {
  it("uses a fixed server snapshot that does not depend on the browser", () => {
    expect(SERVER_SNAPSHOT).toBe("default");
  });

  it("renders the same view during hydration regardless of the real permission", () => {
    // Hydration always uses the server snapshot, so the view is constant.
    expect(hydrationView()).toBe("enable");
    expect(isHydrationSafe(SERVER_SNAPSHOT)).toBe(true);
  });

  it("would flag a browser-dependent snapshot as unsafe", () => {
    // If the snapshot read the live permission, a browser with no Notification
    // API ("unsupported") would render differently from the server ("default").
    expect(isHydrationSafe("unsupported")).toBe(false);
    expect(permissionView("unsupported")).not.toBe(permissionView(SERVER_SNAPSHOT));
  });
});

describe("notification permission view mapping", () => {
  it("offers the enable control for default and denied permissions", () => {
    expect(permissionView("default")).toBe("enable");
    expect(permissionView("denied")).toBe("enable");
  });

  it("shows the enabled state only when permission is granted", () => {
    expect(permissionView("granted")).toBe("on");
  });

  it("shows the unsupported state when the browser has no Notification API", () => {
    expect(permissionView("unsupported")).toBe("unsupported");
  });

  it("only allows a permission request when the API exists", () => {
    expect(canRequestPermission("default")).toBe(true);
    expect(canRequestPermission("denied")).toBe(true);
    expect(canRequestPermission("granted")).toBe(true);
    expect(canRequestPermission("unsupported")).toBe(false);
  });
});

describe("readPermission", () => {
  it("reads each valid browser permission value", () => {
    expect(readPermission({ Notification: { permission: "granted" } })).toBe("granted");
    expect(readPermission({ Notification: { permission: "denied" } })).toBe("denied");
    expect(readPermission({ Notification: { permission: "default" } })).toBe("default");
  });

  it("reports unsupported when there is no Notification API", () => {
    expect(readPermission({})).toBe("unsupported");
  });

  it("reports unsupported for an unexpected permission value", () => {
    expect(readPermission({ Notification: { permission: "something-else" } })).toBe("unsupported");
  });

  it("never throws when there is no window (server-side rendering)", () => {
    expect(() => readPermission()).not.toThrow();
    expect(readPermission()).toBe("unsupported");
  });
});

describe("hydration invariant across every permission", () => {
  const all: NotificationPermission[] = ["unsupported", "default", "granted", "denied"];

  it("keeps the server snapshot stable for all permissions", () => {
    for (const permission of all) {
      // The snapshot used for hydration is constant; only the post-hydration
      // client snapshot varies by permission.
      expect(SERVER_SNAPSHOT).toBe("default");
      expect(typeof permissionView(permission)).toBe("string");
    }
  });
});