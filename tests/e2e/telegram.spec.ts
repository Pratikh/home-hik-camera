import type { Route } from "@playwright/test";
import { ADMIN_STATE } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { ROUTES } from "./support/app";

/**
 * TELEGRAM-UI — the admin Telegram test button.
 *
 * Desktop only, exactly 1920x1080.
 *
 * The browser's request to the test endpoint is intercepted, so the server never
 * contacts Telegram: no bot and no network are needed, and no real message is
 * sent by the suite. The endpoint's own authorization and failure handling are
 * covered by the hub unit tests.
 */
test.use({ storageState: ADMIN_STATE });

const ENDPOINT = "/api/notifications/telegram/test";

async function answerWith(page: import("@playwright/test").Page, status: number, body: unknown): Promise<string[]> {
  const seen: string[] = [];
  await page.route(
    (url) => url.pathname === ENDPOINT,
    async (route: Route) => {
      seen.push(route.request().method());
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    },
  );
  return seen;
}

const button = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /Send Telegram Test|Sending/ });

test.describe("TELEGRAM-UI - admin Telegram test button", () => {
  test("TELEGRAM-UI-001 an ADMIN sees the test button on the notification settings page", async ({
    page,
    diag,
  }) => {
    await page.goto(ROUTES.notificationRules);
    await expect(page.getByRole("heading", { level: 1, name: "Notification rules" })).toBeVisible();
    await expect(button(page)).toBeVisible();

    // The page never renders a credential, and never claims one exists.
    const body = (await page.locator("body").innerText()) ?? "";
    expect(body).not.toContain("api.telegram.org");
    expect(body.toLowerCase()).not.toContain("bot_token");
    expect(body).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{20,}/);

    diag.expectClean();
  });

  test("TELEGRAM-UI-002 sending shows success, and the request is a POST to the server endpoint", async ({
    page,
    diag,
  }) => {
    const methods = await answerWith(page, 200, { ok: true, message: "Telegram test message sent." });
    await page.goto(ROUTES.notificationRules);

    await button(page).click();

    await expect(page.getByText("Telegram test message sent.")).toBeVisible();
    expect(methods).toEqual(["POST"]);

    diag.expectClean();
  });

  test("TELEGRAM-UI-003 a refusal is shown as a failure, not as a success", async ({ page, diag }) => {
    await answerWith(page, 409, {
      ok: false,
      reason: "disabled",
      error: "Telegram notifications are disabled (set TELEGRAM_NOTIFICATIONS_ENABLED=true on the server).",
    });
    await page.goto(ROUTES.notificationRules);

    await button(page).click();

    await expect(page.getByText(/Telegram notifications are disabled/)).toBeVisible();
    await expect(page.getByText("Telegram test message sent.")).toHaveCount(0);

    // The 409 is the expected outcome of this test.
    diag.expectClean({ allowStatuses: [409] });
  });

  test("TELEGRAM-UI-004 the endpoint refuses an unauthenticated caller", async ({ qa }) => {
    const anonymous = await qa.freshContext();
    try {
      const response = await anonymous.request.post(ENDPOINT, { maxRedirects: 0 });
      expect(response.status(), "unauthenticated Telegram test request").toBe(401);
      const body = await response.text();
      expect(body).not.toContain("api.telegram.org");
      expect(body).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{20,}/);
    } finally {
      await anonymous.close();
    }
  });
});

/**
 * TELEGRAM-UI-005 / TELEGRAM-MEDIA-023 — the media settings are visible, and the
 * temporary clip directory is not reachable over HTTP.
 */
test.describe("TELEGRAM-MEDIA - status and temporary files", () => {
  test("TELEGRAM-UI-005 shows whether the image and the clip are enabled", async ({ page, diag }) => {
    await page.route(
      (url) => url.pathname === "/api/notifications/telegram/status",
      async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            enabled: true,
            configured: true,
            faceNotifications: true,
            eventNotifications: true,
            faceImage: true,
            faceVideo: true,
            videoPreSeconds: 5,
            videoPostSeconds: 5,
            clipSeconds: 10,
            ffmpeg: "available",
            queueDepth: 0,
          }),
        });
      },
    );

    await page.goto(ROUTES.notificationRules);
    const status = page.getByTestId("telegram-status");
    await expect(status).toBeVisible();
    await expect(status).toContainText("Telegram:");
    await expect(status).toContainText("Enabled");
    await expect(status).toContainText("Snapshot: On");
    await expect(status).toContainText("Video: On (10s, 5s before)");
    await expect(status).toContainText("FFmpeg: found");

    // The status line never carries a credential.
    const text = (await status.innerText()) ?? "";
    expect(text).not.toContain("api.telegram.org");
    expect(text).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{20,}/);

    diag.expectClean();
  });

  test("TELEGRAM-UI-005 reports FFmpeg as missing without breaking the page", async ({ page, diag }) => {
    await page.route(
      (url) => url.pathname === "/api/notifications/telegram/status",
      async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            enabled: true,
            configured: true,
            faceNotifications: true,
            eventNotifications: true,
            faceImage: true,
            faceVideo: true,
            videoPreSeconds: 5,
            videoPostSeconds: 5,
            clipSeconds: 10,
            ffmpeg: "unavailable",
            queueDepth: 0,
          }),
        });
      },
    );

    await page.goto(ROUTES.notificationRules);
    await expect(page.getByTestId("telegram-status")).toContainText("FFmpeg: not found");

    diag.expectClean();
  });

  test("TELEGRAM-MEDIA-023 temporary clips and crops are not served as static files", async ({
    page,
    diag,
  }) => {
    // Authenticated: even a signed-in ADMIN cannot fetch these by path.
    for (const path of [
      "/telegram-clips/clip-evt_aaaaaaaaaaaaaaaaaaaaaaaa-1.mp4",
      "/face-crops/2026/10/evt_aaaaaaaaaaaaaaaaaaaaaaaa-face-1.jpg",
      "/data/telegram-clips/clip.mp4",
    ]) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status(), `${path} must not be served`).toBe(404);
      const body = await response.text();
      expect(body).not.toContain("ftyp");
    }

    diag.expectClean();
  });
});
