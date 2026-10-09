import { expect, type Page } from "@playwright/test";

/**
 * The actual route map, read from `src/app`.
 *
 * There is deliberately no `/live` route: the four-camera live view is the
 * Dashboard at `/`. The Playback page is `/playback`.
 */
export const ROUTES = {
  login: "/login",
  dashboard: "/",
  cameras: "/cameras",
  playback: "/playback",
  events: "/events",
  eventStats: "/events/stats",
  notifications: "/notifications",
  device: "/device",
  settings: "/settings",
  users: "/settings/users",
  notificationRules: "/settings/notifications",
  auditLog: "/settings/audit-log",
  system: "/settings/system",
} as const;

/** Every page the session cookie is required for. */
export const PROTECTED_PAGES: string[] = Object.values(ROUTES).filter(
  (route) => route !== ROUTES.login,
);

/** Endpoints that must reject an unauthenticated caller with 401. */
export const PROTECTED_API: string[] = [
  "/api/auth/session",
  "/api/cameras",
  "/api/cameras/1",
  "/api/dvr/status",
  "/api/dvr/info",
  "/api/events",
  "/api/events/recent",
  "/api/events/stats",
  "/api/events/health",
  "/api/notifications",
  "/api/notifications/stats",
  "/api/audit",
  "/api/users",
  "/api/settings",
  "/api/system/sessions",
  "/api/notification-rules",
  "/api/streams/presence",
  "/api/playback/recording-dates?camera=1&month=2026-01",
];

/** Endpoints that must additionally reject a VIEWER with 403. */
export const ADMIN_ONLY_API: string[] = [
  "/api/audit",
  "/api/users",
  "/api/settings",
  "/api/system/sessions",
  "/api/notification-rules",
];

/** The only intentionally public endpoint. */
export const PUBLIC_API: string[] = ["/api/health"];

export type CameraInfo = {
  id: number;
  name: string;
  online: boolean | null;
  mainChannel: number;
  subChannel: number;
  mainPath: string;
  subPath: string;
};

/**
 * Discover the real camera ids, names and stream paths from the application.
 * No camera name is hardcoded in this suite.
 */
export async function getCameras(page: Page): Promise<CameraInfo[]> {
  const response = await page.request.get("/api/cameras");
  expect(response.status(), "GET /api/cameras").toBe(200);
  const body = (await response.json()) as { cameras?: CameraInfo[] };
  expect(Array.isArray(body.cameras)).toBe(true);
  const cameras = body.cameras ?? [];
  expect(cameras.length, "the application must expose at least one camera").toBeGreaterThan(0);
  return cameras;
}

/** Today's calendar date in Asia/Kolkata, the zone the whole application uses. */
export function todayInKolkata(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}

/**
 * Give late console/network events a moment to arrive before diagnostics are
 * asserted. The event stream keeps one request open forever, so `networkidle`
 * is not usable here.
 */
export async function settle(page: Page, ms = 750): Promise<void> {
  await page.waitForTimeout(ms);
}
