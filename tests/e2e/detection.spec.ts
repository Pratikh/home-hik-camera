import type { APIRequestContext } from "@playwright/test";
import { ADMIN_STATE } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { ROUTES } from "./support/app";

/**
 * DETECTION-UI — the Admin object-detection settings page.
 *
 * The feature ships OFF. Each mutating test starts from a known "everything
 * off" configuration and restores it, so the suite can never leave detection
 * enabled on a real hub.
 *
 * The worker itself is a separate service; this page only proves the settings
 * round-trip and the status display. No model is loaded and no frame is analysed
 * by these tests.
 */

test.use({ storageState: ADMIN_STATE });

/** The live configuration, captured so a test always puts it back exactly. */
let originalConfig: DetectionBody | null = null;

type DetectionBody = {
  settings: Record<string, unknown>;
  cameras: Array<Record<string, unknown>>;
};

async function readConfig(request: APIRequestContext): Promise<DetectionBody> {
  const response = await request.get("/api/settings/detection");
  expect(response.status(), "GET /api/settings/detection").toBe(200);
  return (await response.json()) as DetectionBody;
}

/** Deterministic baseline for every test: off, 70 %, default sampling. */
function baseline(body: DetectionBody): DetectionBody {
  return {
    settings: {
      ...body.settings,
      enabled: false,
      personConfidence: 0.7,
      vehicleConfidence: 0.7,
      baseFps: 1,
      activeFps: 3,
      maxFps: 5,
      detectionSource: "ai_only",
    },
    cameras: body.cameras.map((camera) => ({
      ...camera,
      enabled: false,
      personConfidence: null,
      vehicleConfidence: null,
    })),
  };
}

async function saveConfig(request: APIRequestContext, body: DetectionBody): Promise<void> {
  const response = await request.put("/api/settings/detection", { data: body });
  expect(response.status(), "PUT /api/settings/detection").toBe(200);
}

test.describe("DETECTION-UI - object detection settings", () => {
  test.beforeEach(async ({ request }) => {
    // Snapshot the live configuration, then apply a known baseline so the
    // assertions never depend on whatever the operator or a worker last saved.
    originalConfig = await readConfig(request);
    await saveConfig(request, baseline(originalConfig));
  });

  test.afterEach(async ({ request }) => {
    // Restore exactly what was there before the test; QA must not silently
    // reconfigure a real deployment.
    if (originalConfig) await saveConfig(request, originalConfig);
    originalConfig = null;
  });

  test("DETECTION-UI-001 the ADMIN page shows every section and the worker status", async ({ page, diag }) => {
    await page.goto(ROUTES.detection);

    await expect(page.getByRole("heading", { level: 1, name: "Object detection" })).toBeVisible();
    await expect(page.getByTestId("detection-enabled")).toBeVisible();
    await expect(page.getByTestId("detection-enabled")).not.toBeChecked();
    await expect(page.getByTestId("person-confidence")).toHaveValue("70");
    await expect(page.getByTestId("vehicle-confidence")).toHaveValue("70");
    await expect(page.getByTestId("detection-worker-status")).toContainText(/Running|Stopped|Disabled|Overloaded|Error|Not running/);
    await expect(page.getByTestId("base-fps")).toHaveValue("1");
    await expect(page.getByTestId("detection-source")).toHaveValue("ai_only");
    await expect(page.getByTestId("detection-test-button")).toBeVisible();
    // Every camera has an independent switch; names come from the app, not this file.
    for (const cameraId of [1, 2, 3, 4]) {
      await expect(page.getByTestId(`camera-${cameraId}-enabled`)).toBeVisible();
    }

    diag.expectClean();
  });

  test("DETECTION-UI-002 saving persists across a reload", async ({ page, request, diag }) => {
    await page.goto(ROUTES.detection);
    await page.getByTestId("detection-enabled").check();
    await page.getByTestId("camera-1-enabled").check();
    await page.getByTestId("person-confidence").fill("73");
    await page.getByTestId("person-confidence").blur();
    await page.getByTestId("detection-save").click();
    await expect(page.getByText(/Saved\. The detection worker/)).toBeVisible();

    // Server-side truth, not just the form state.
    const stored = await readConfig(request);
    expect(stored.settings.enabled).toBe(true);
    expect(stored.settings.personConfidence).toBe(0.73);
    expect(stored.cameras.find((camera) => camera.cameraId === 1)?.enabled).toBe(true);

    await page.reload();
    await expect(page.getByTestId("detection-worker-status")).toBeVisible();
    await expect(page.getByTestId("detection-enabled")).toBeChecked();
    await expect(page.getByTestId("camera-1-enabled")).toBeChecked();
    await expect(page.getByTestId("person-confidence")).toHaveValue("73");

    // Put it back while the page is open, through the UI, so the "off" state is
    // also proven to save.
    await page.getByTestId("detection-enabled").uncheck();
    await page.getByTestId("camera-1-enabled").uncheck();
    await page.getByTestId("person-confidence").fill("70");
    await page.getByTestId("person-confidence").blur();
    await page.getByTestId("detection-save").click();
    await expect(page.getByText(/Saved\. The detection worker/)).toBeVisible();
    expect((await readConfig(request)).settings.enabled).toBe(false);

    diag.expectClean();
  });

  test("DETECTION-UI-003 a per-camera threshold override round-trips", async ({ page, request, diag }) => {
    await page.goto(ROUTES.detection);
    await page.getByTestId("camera-2-enabled").check();
    await page.getByTestId("camera-2-person-global").uncheck();
    await page.getByTestId("camera-2-person-confidence").fill("85");
    await page.getByTestId("camera-2-person-confidence").blur();
    await page.getByTestId("detection-save").click();
    await expect(page.getByText(/Saved\. The detection worker/)).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("camera-2-person-global")).not.toBeChecked();
    await expect(page.getByTestId("camera-2-person-confidence")).toHaveValue("85");

    // Restore this camera through the API so the afterEach hook has a clean base.
    const stored = await readConfig(request);
    await saveConfig(request, {
      ...stored,
      cameras: stored.cameras.map((camera) =>
        camera.cameraId === 2
          ? { ...camera, enabled: false, personConfidence: null, vehicleConfidence: null }
          : camera,
      ),
    });

    diag.expectClean();
  });

  test("DETECTION-UI-004 the API rejects invalid settings even when the UI would clamp", async ({ request }) => {
    const response = await request.put("/api/settings/detection", {
      data: { settings: { enabled: true, personConfidence: 1.5 }, cameras: [] },
    });
    expect(response.status()).toBe(400);

    const untouched = await readConfig(request);
    expect(untouched.settings.enabled).toBe(false);
  });

  test("DETECTION-UI-005 detection is off by default and the model is named", async ({ page, request }) => {
    const stored = await readConfig(request);
    expect(stored.settings.enabled).toBe(false);

    await page.goto(ROUTES.detection);
    await expect(page.getByTestId("detection-worker-status")).toContainText("YOLOX-Nano");
    await expect(page.getByTestId("detection-enabled")).not.toBeChecked();
    await expect(page.getByText("Detection is off.")).toBeVisible();
  });
});
