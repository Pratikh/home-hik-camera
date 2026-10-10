import type { Page, Route } from "@playwright/test";
import { ADMIN_STATE } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { getCameras, ROUTES } from "./support/app";
import type { DetectedFace, FaceTestNotificationStatus } from "@/lib/faces";

/**
 * FACE-NOTIFY-UI — the visible side of the temporary face-notification test mode.
 *
 * Desktop only, exactly 1920x1080.
 *
 * Native browser notifications are deliberately not driven here: permission and
 * the OS notification centre are not reliably observable in a headless browser.
 * What is observable, and what a tester actually watches during the 48 hour
 * trial, is the read-only status, the gallery and the event detail panel.
 * Fixtures are served at the network boundary, so nothing is written to the
 * production database.
 */
test.use({ storageState: ADMIN_STATE });

const FACE_A = "face_111111111111111111111111";
const TEST_UNTIL = "2026-10-12T10:00:00+05:30";

const ACTIVE_STATUS: FaceTestNotificationStatus = {
  enabled: true,
  active: true,
  until: TEST_UNTIL,
  cooldownSeconds: 300,
  reason: "ACTIVE",
};

const EXPIRED_STATUS: FaceTestNotificationStatus = {
  enabled: true,
  active: false,
  until: "2026-10-09T10:00:00+05:30",
  cooldownSeconds: 300,
  reason: "TEST_WINDOW_EXPIRED",
};

function face(overrides: Partial<DetectedFace> = {}): DetectedFace {
  return {
    id: FACE_A,
    eventId: "evt_aaaaaaaaaaaaaaaaaaaaaaaa",
    personId: null,
    confidence: 0.82,
    x: 100,
    y: 120,
    width: 60,
    height: 60,
    hasCrop: true,
    detector: "yunet",
    model: "face_detection_yunet_2023mar",
    createdAt: "2026-10-10T04:29:30.000Z",
    cameraId: 1,
    eventTimestamp: "2026-10-10T09:59:00+05:30",
    eventType: "motion",
    eventClassification: "person",
    ...overrides,
  };
}

const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

async function serveFaces(
  page: Page,
  input: { testNotifications: FaceTestNotificationStatus; faces?: DetectedFace[]; total?: number },
): Promise<void> {
  const faces = input.faces ?? [];
  await page.route(
    (url) => url.pathname === "/api/faces",
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          faces,
          total: input.total ?? faces.length,
          page: 1,
          pageSize: 24,
          processing: { pending: 0, processing: 0, completed: faces.length, failed: 0 },
          testNotifications: input.testNotifications,
        }),
      });
    },
  );
  await page.route(
    (url) => /^\/api\/faces\/[^/]+\/image$/.test(url.pathname),
    async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "image/jpeg", body: TINY_JPEG });
    },
  );
}

async function realEventId(page: Page): Promise<string | null> {
  const response = await page.request.get("/api/events/recent?limit=1");
  if (response.status() !== 200) return null;
  const body = (await response.json()) as { events?: Array<{ id: string }> };
  return body.events?.[0]?.id ?? null;
}

test.describe("FACE-NOTIFY-UI - test mode status", () => {
  test("FACE-NOTIFY-UI-001 the status is represented correctly, and absent when inactive", async ({
    page,
    diag,
  }) => {
    await serveFaces(page, { testNotifications: ACTIVE_STATUS });
    await page.goto(ROUTES.faces);

    const status = page.getByRole("status").filter({ hasText: "Face test notifications" });
    await expect(status).toBeVisible();
    await expect(status).toContainText("Face test notifications active until");
    // Rendered in the application's India-time convention.
    await expect(status).toContainText("12 Oct 2026, 10:00:00");
    await expect(status).toContainText("cooldown 5 minutes / camera");

    // An expired window shows no status at all: nothing claims to be active.
    await page.unroute((url) => url.pathname === "/api/faces");
    await serveFaces(page, { testNotifications: EXPIRED_STATUS });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Detected Faces" })).toBeVisible();
    await expect(page.getByText("Face test notifications")).toHaveCount(0);
    await expect(page.getByText(/Face detection is disabled/)).toHaveCount(0);

    diag.expectClean();
  });

  test("FACE-NOTIFY-UI-002 a detection is visible in the gallery while the test mode runs", async ({
    page,
    diag,
  }) => {
    await serveFaces(page, { testNotifications: ACTIVE_STATUS, faces: [face()], total: 1 });
    await page.goto(ROUTES.faces);
    // The card uses the DVR's real camera name, discovered rather than assumed.
    const cameras = await getCameras(page);
    const cameraName = cameras.find((camera) => camera.id === 1)?.name ?? "Camera 1";

    // Both halves a tester correlates during the trial: the status, and the
    // detection it is supposed to notify about.
    await expect(page.getByText("Face test notifications active until")).toBeVisible();
    const card = page.getByRole("article").first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Unassigned");
    await expect(card).toContainText("82% confidence");
    await expect(card).toContainText(cameraName);
    await expect(card.locator("img")).toHaveAttribute("src", `/api/faces/${FACE_A}/image`);

    diag.expectClean();
  });

  test("FACE-NOTIFY-UI-003 the event detail page shows the detected face behind the notification", async ({
    page,
    diag,
  }) => {
    const eventId = await realEventId(page);
    if (!eventId) {
      test.info().annotations.push({ type: "environment", description: "no stored event to inspect" });
      diag.expectClean();
      return;
    }
    await page.route(
      (url) => url.pathname === `/api/events/${eventId}/faces`,
      async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            enabled: true,
            eventId,
            status: "COMPLETED",
            faces: [
              {
                id: FACE_A,
                eventId,
                personId: null,
                confidence: 0.82,
                x: 100,
                y: 120,
                width: 60,
                height: 60,
                hasCrop: true,
              },
            ],
          }),
        });
      },
    );
    await page.route(
      (url) => /^\/api\/faces\/[^/]+\/image$/.test(url.pathname),
      async (route: Route) => {
        await route.fulfill({ status: 200, contentType: "image/jpeg", body: TINY_JPEG });
      },
    );

    // This is exactly where a notification click lands.
    await page.goto(`/events/${eventId}`);

    const section = page.getByRole("region", { name: "Detected faces" });
    await expect(section).toBeVisible();
    await expect(section).toContainText("1 face detected");
    await expect(section).toContainText("Confidence: 82%");
    await expect(section).toContainText("Unassigned");
    await expect(section.locator("img")).toHaveAttribute("src", `/api/faces/${FACE_A}/image`);
    // Anonymous, as required: no identity is claimed anywhere on the page.
    await expect(section).not.toContainText(/Priyanka|recognis|recogniz|identified person/i);

    diag.expectClean();
  });
});
