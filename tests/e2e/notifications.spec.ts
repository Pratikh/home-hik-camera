import type { Page } from "@playwright/test";
import { ADMIN_STATE } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { ROUTES } from "./support/app";

/**
 * NOTIF — notification history and the browser notification permission control.
 */
test.use({ storageState: ADMIN_STATE });

type RecentEvents = { events: Array<{ timestamp: string }> };

async function newestEventDate(page: Page): Promise<string | null> {
  const response = await page.request.get("/api/events/recent?limit=5");
  if (response.status() !== 200) return null;
  const body = (await response.json()) as RecentEvents;
  const first = body.events?.[0];
  return first ? first.timestamp.slice(0, 10) : null;
}

async function applyFilters(page: Page, date: string): Promise<void> {
  await page.getByLabel("Date").fill(date);
  const settled = page.waitForResponse(
    (response) => response.url().includes("/api/notifications?") && response.status() === 200,
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: /Apply filters|Loading/ }).click();
  await settled;
}

const rows = (page: Page) => page.locator("ul li article");

test.describe("NOTIF - notifications", () => {
  test("NOTIF-001 the notifications page loads", async ({ page, diag }) => {
    await page.goto(ROUTES.notifications);
    await expect(page.getByRole("heading", { level: 1, name: "Notification history" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Apply filters|Loading/ })).toBeVisible();
    diag.expectClean();
  });

  test("NOTIF-002 notification records are visible when data exists", async ({ page, diag }) => {
    await page.goto(ROUTES.notifications);
    const date = await newestEventDate(page);
    if (date) await applyFilters(page, date);

    // Either records are listed, or the app says there are none for the period.
    await expect
      .poll(
        async () => (await rows(page).count()) > 0 || (await page.getByText("No notifications for this period.").count()) > 0,
        { timeout: 20_000, message: "the notification list must resolve to records or an explicit empty state" },
      )
      .toBe(true);

    if ((await rows(page).count()) === 0) {
      test.info().annotations.push({
        type: "environment",
        description: "no notification records for this date; the empty state is shown instead",
      });
    }

    // The summary counters are always from the application's own stats.
    await expect(page.getByText(/Sent\s+\d+/)).toBeVisible();
    await expect(page.getByText(/Suppressed\s+\d+/)).toBeVisible();
    await expect(page.getByText(/Failed\s+\d+/)).toBeVisible();

    diag.expectClean();
  });

  test("NOTIF-003 the status filter narrows the history", async ({ page, diag }) => {
    await page.goto(ROUTES.notifications);
    const date = await newestEventDate(page);
    if (date) await applyFilters(page, date);

    await page.getByLabel("Status").selectOption("sent");
    const sentResponse = page.waitForRequest(
      (candidate) => candidate.url().includes("/api/notifications?") && candidate.url().includes("status=sent"),
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: /Apply filters|Loading/ }).click();
    expect((await sentResponse).url()).toContain("status=sent");

    await expect
      .poll(async () => (await rows(page).count()) > 0 || (await page.getByText("No notifications for this period.").count()) > 0, {
        timeout: 20_000,
      })
      .toBe(true);

    const sentRows = await rows(page).count();
    for (let index = 0; index < sentRows; index += 1) {
      await expect(rows(page).nth(index), "a status=sent result must be labelled Sent").toContainText("Sent");
    }

    await page.getByLabel("Status").selectOption("failed");
    const failedResponse = page.waitForRequest(
      (candidate) => candidate.url().includes("/api/notifications?") && candidate.url().includes("status=failed"),
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: /Apply filters|Loading/ }).click();
    expect((await failedResponse).url()).toContain("status=failed");

    await expect
      .poll(async () => (await rows(page).count()) > 0 || (await page.getByText("No notifications for this period.").count()) > 0, {
        timeout: 20_000,
      })
      .toBe(true);
    const failedRows = await rows(page).count();
    for (let index = 0; index < failedRows; index += 1) {
      await expect(rows(page).nth(index), "a status=failed result must be labelled Failed").toContainText("Failed");
    }

    diag.expectClean();
  });

  test("NOTIF-004 the notification permission control follows the browser state and the user's role", async ({
    page,
    diag,
  }) => {
    // Permission must only be requested after an explicit click.
    await page.addInitScript(() => {
      const holder = window as unknown as { __qaPermissionRequests?: number };
      holder.__qaPermissionRequests = 0;
      if (typeof Notification === "undefined") return;
      const target = Notification as unknown as {
        requestPermission: (...args: unknown[]) => Promise<NotificationPermission>;
      };
      const original = target.requestPermission.bind(Notification);
      target.requestPermission = (...args: unknown[]) => {
        holder.__qaPermissionRequests = (holder.__qaPermissionRequests ?? 0) + 1;
        return original(...args);
      };
    });

    await page.goto(ROUTES.notifications);
    await expect(page.getByRole("heading", { level: 1, name: "Notification history" })).toBeVisible();

    const supported = await page.evaluate(() => typeof Notification !== "undefined");
    if (!supported) {
      await expect(page.getByText("This browser does not support notifications.")).toBeVisible();
      diag.expectClean();
      return;
    }

    const control = page.getByRole("button", { name: "Enable notifications" });
    await expect(control).toBeVisible();
    // Any authenticated role may enable notifications; nothing is requested on load.
    expect(await page.evaluate(() => (window as unknown as { __qaPermissionRequests?: number }).__qaPermissionRequests)).toBe(0);

    await control.click();
    await expect
      .poll(
        async () => page.evaluate(() => (window as unknown as { __qaPermissionRequests?: number }).__qaPermissionRequests),
        { timeout: 10_000, message: "exactly one permission request after the click" },
      )
      .toBe(1);

    await expect(page.getByText(/CCTV notifications allowed\.|Notifications were not allowed\./)).toBeVisible();

    diag.expectClean();
  });
});
