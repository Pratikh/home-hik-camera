import { ADMIN_STATE } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { ROUTES } from "./support/app";

/**
 * SYSTEM — audit log and system status.
 *
 * Loading and error states are exercised by delaying or faulting the browser's
 * own request. Nothing in the application, the database or the DVR is changed.
 */
test.use({ storageState: ADMIN_STATE });

test.describe("SYSTEM - audit log and system status", () => {
  test("SYSTEM-001 the audit log loads", async ({ page, diag }) => {
    await page.goto(ROUTES.auditLog);
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Filter" })).toBeVisible();

    await expect
      .poll(
        async () =>
          (await page.locator("li").count()) > 0 ||
          (await page.getByText("No audit entries yet.").count()) > 0,
        { timeout: 20_000, message: "the audit log must resolve to entries or an empty state" },
      )
      .toBe(true);

    if ((await page.locator("li").count()) === 0) {
      test.info().annotations.push({ type: "environment", description: "the audit log has no entries yet" });
    }

    diag.expectClean();
  });

  test("SYSTEM-002 the audit log handles its loading state", async ({ page, diag }) => {
    await page.route("**/api/audit*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await page.goto(ROUTES.auditLog);
    await expect(page.getByText("Loading audit log...")).toBeVisible();
    await expect(page.getByText("Loading audit log...")).toHaveCount(0, { timeout: 25_000 });

    diag.expectClean();
  });

  test("SYSTEM-003 the audit log handles its empty state", async ({ page, diag }) => {
    await page.goto(ROUTES.auditLog);
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();

    // A user filter that matches nothing is a real, data-driven empty result.
    await page.getByLabel("User").fill("qa-no-such-user-9f3c1a");
    const settled = page.waitForResponse(
      (response) => response.url().includes("/api/audit") && response.status() === 200,
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: "Filter" }).click();
    await settled;

    await expect(page.getByText("No audit entries yet.")).toBeVisible();

    diag.expectClean();
  });

  test("SYSTEM-004 the audit log handles an error state and recovers", async ({ page, diag }) => {
    await page.route("**/api/audit*", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Injected failure for the error-state test" }),
      });
    });

    await page.goto(ROUTES.auditLog);
    await expect(page.getByText("Unable to load audit log.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    // Recovery: remove the fault and retry through the UI.
    await page.unroute("**/api/audit*");
    const settled = page.waitForResponse(
      (response) => response.url().includes("/api/audit") && response.status() === 200,
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: "Retry" }).click();
    await settled;
    await expect(page.getByText("Unable to load audit log.")).toHaveCount(0);

    diag.expectClean({ allowStatuses: [500] });
  });

  test("SYSTEM-005 the system page loads", async ({ page, diag }) => {
    await page.goto(ROUTES.system);
    await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
    await expect(page.getByText(/Application:/)).toBeVisible();
    await expect(page.getByText(/Active sessions:/)).toBeVisible();
    diag.expectClean();
  });

  test("SYSTEM-006 the system page handles its loading state", async ({ page, diag }) => {
    await page.route("**/api/health", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await page.goto(ROUTES.system);
    await expect(page.getByText("Loading system status...")).toBeVisible();
    await expect(page.getByText("Loading system status...")).toHaveCount(0, { timeout: 25_000 });

    diag.expectClean();
  });

  test("SYSTEM-007 the system page handles an error state and recovers", async ({ page, diag }) => {
    await page.route("**/api/system/sessions", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Injected failure for the error-state test" }),
      });
    });

    await page.goto(ROUTES.system);
    await expect(page.getByText("Unable to load system status.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    await page.unroute("**/api/system/sessions");
    const settled = page.waitForResponse(
      (response) => response.url().includes("/api/system/sessions") && response.status() === 200,
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: "Retry" }).click();
    await settled;
    await expect(page.getByText("Unable to load system status.")).toHaveCount(0);

    diag.expectClean({ allowStatuses: [500] });
  });
});
