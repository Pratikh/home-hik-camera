import { defineConfig, devices } from "@playwright/test";
import { VIEWPORT, baseURL, loadQaEnv } from "./tests/e2e/support/qa-env";

loadQaEnv();

/**
 * Home CCTV Hub end-to-end browser QA.
 *
 * Scope: DESKTOP ONLY, Chromium, exactly 1920x1080. Responsive, mobile and
 * tablet coverage is intentionally out of scope for this suite.
 *
 * The suite targets an already-running hub. It never starts, restarts or
 * reconfigures the application, MediaMTX or the DVR.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  globalSetup: "./tests/e2e/support/global-setup.ts",

  /* One worker: the target is a live single-user hub talking to a real DVR. */
  fullyParallel: false,
  workers: 1,
  retries: process.env.QA_RETRIES ? Number(process.env.QA_RETRIES) : 1,
  forbidOnly: Boolean(process.env.CI),

  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],

  use: {
    baseURL: baseURL(),
    viewport: VIEWPORT,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium-desktop-1920x1080",
      use: {
        ...devices["Desktop Chrome"],
        viewport: VIEWPORT,
      },
    },
  ],
});
