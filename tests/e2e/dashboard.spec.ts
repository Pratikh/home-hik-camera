import { ADMIN_STATE } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { getCameras, ROUTES } from "./support/app";

/**
 * DASH — the Dashboard at `/`, which is also the four-camera live view.
 * Desktop only, exactly 1920x1080.
 */
test.use({ storageState: ADMIN_STATE });

test.describe("DASH - dashboard", () => {
  test("DASH-001 the dashboard loads", async ({ page, diag }) => {
    await page.goto(ROUTES.dashboard);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    diag.expectClean();
  });

  test("DASH-002 the navigation, sidebar and header are visible", async ({ page, diag }) => {
    await page.goto(ROUTES.dashboard);

    const banner = page.getByRole("banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Home CCTV");

    const navigation = page.getByRole("navigation", { name: "Primary" }).first();
    await expect(navigation).toBeVisible();
    // "/cameras" configures cameras; the live view is the dashboard.
    for (const label of ["Dashboard", "Camera setup", "Playback", "Events", "Faces", "Notifications", "Device", "Settings"]) {
      await expect(navigation.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(navigation.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Log out" }).first()).toBeVisible();

    diag.expectClean();
  });

  test("DASH-003 the camera tiles are visible", async ({ page, diag }) => {
    await page.goto(ROUTES.dashboard);
    const cameras = await getCameras(page);

    await expect(page.locator("article")).toHaveCount(cameras.length);
    for (const camera of cameras) {
      await expect(page.getByRole("heading", { level: 2, name: camera.name })).toBeVisible();
    }
    await expect(page.getByRole("region", { name: "Recent security events" })).toBeVisible();

    diag.expectClean();
  });

  test("DASH-004 no unexpected console errors", async ({ page, diag }) => {
    await page.goto(ROUTES.dashboard);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await page.waitForTimeout(1000);
    diag.expectClean();
  });

  test("DASH-005 no unexpected failed network requests", async ({ page, diag }) => {
    await page.goto(ROUTES.dashboard);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await page.waitForTimeout(1000);

    const snapshot = diag.snapshot();
    expect(snapshot.failedRequests, "failed requests on the dashboard").toEqual([]);
    expect(
      snapshot.httpErrors.filter((entry) => entry.status >= 400),
      "HTTP error responses on the dashboard",
    ).toEqual([]);
    diag.expectClean();
  });
});
