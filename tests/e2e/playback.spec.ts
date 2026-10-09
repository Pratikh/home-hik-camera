import { ADMIN_STATE } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { ROUTES, todayInKolkata, type CameraInfo } from "./support/app";
import type { Page } from "@playwright/test";

/**
 * PLAY — playback.
 *
 * Desktop only, exactly 1920x1080. The browser playback source is ~704x576, so
 * nothing here assumes 16:9.
 */
test.use({ storageState: ADMIN_STATE });

type RecordingsResponse = {
  recordings: Array<{ id: string; startTime: string; endTime: string; type: string | null }>;
};
type EventsResponse = { events: Array<{ id: string; priority: string }> };

const dateButton = (page: Page) => page.locator('button[aria-haspopup="dialog"]');
const calendarDialog = (page: Page) => page.getByRole("dialog", { name: "Choose playback date" });
const dayButtons = (page: Page) =>
  calendarDialog(page).getByRole("button", { name: /— (recording available|no recording)$/ });

/** The date the playback view is currently showing. */
async function displayedDate(page: Page): Promise<string> {
  const text = (await dateButton(page).textContent())?.trim() ?? "";
  return text;
}

/** Format a YYYY-MM-DD the same way the calendar labels its day buttons. */
function calendarLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function recordedDates(page: Page, camera: number, month: string): Promise<string[]> {
  const response = await page.request.get(
    `/api/playback/recording-dates?camera=${camera}&month=${encodeURIComponent(month)}`,
  );
  if (response.status() !== 200) return [];
  const body = (await response.json()) as { dates?: string[] };
  return body.dates ?? [];
}

async function recordingsFor(page: Page, camera: number, date: string): Promise<RecordingsResponse["recordings"]> {
  const response = await page.request.get(
    `/api/playback/search?camera=${camera}&date=${date}&startTime=00:00&endTime=23:59`,
  );
  if (response.status() !== 200) return [];
  const body = (await response.json()) as RecordingsResponse;
  return body.recordings ?? [];
}

async function eventsFor(page: Page, camera: number, date: string): Promise<EventsResponse["events"]> {
  const response = await page.request.get(
    `/api/events?camera=${camera}&date=${date}&startTime=00:00&endTime=23:59&pageSize=100`,
  );
  if (response.status() !== 200) return [];
  const body = (await response.json()) as EventsResponse;
  return body.events ?? [];
}

async function firstCamera(page: Page): Promise<CameraInfo> {
  const response = await page.request.get("/api/cameras");
  const body = (await response.json()) as { cameras: CameraInfo[] };
  return body.cameras[0];
}

test.describe("PLAY - playback", () => {
  test("PLAY-001 the playback page loads", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("heading", { level: 1, name: "CCTV Playback" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Search recordings|Searching recordings/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Playback" })).toBeVisible();
    diag.expectClean();
  });

  test("PLAY-002 the default recording date is correct", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Playback" })).toBeVisible();

    const today = todayInKolkata();
    const dates = await recordedDates(page, 1, today.slice(0, 7));

    // The view shows today when today has a recording, otherwise the nearest day
    // that does; with no availability at all it must still show a valid date.
    let expected = today;
    if (dates.length > 0 && !dates.includes(today)) {
      const sorted = [...dates].sort();
      expected = sorted.find((date) => date > today) ?? sorted[sorted.length - 1]!;
    }

    await expect
      .poll(async () => displayedDate(page), { timeout: 15_000 })
      .toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (dates.length > 0) {
      expect(await displayedDate(page), "default date").toBe(expected);
    } else {
      expect(await displayedDate(page)).toBe(today);
    }

    diag.expectClean();
  });

  test("PLAY-003 the calendar opens as a popover from the Date control", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Playback" })).toBeVisible();

    // Not permanently visible: the calendar is absent until the Date control is used.
    await expect(calendarDialog(page)).toHaveCount(0);

    const form = page.locator("form").first();
    const heightBefore = (await form.boundingBox())?.height ?? 0;

    await dateButton(page).click();
    const dialog = calendarDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dateButton(page)).toHaveAttribute("aria-expanded", "true");

    // Popover, not a permanently visible sidebar: absolutely positioned and it
    // adds no height to the filter row.
    const position = await dialog.evaluate((node) => getComputedStyle(node).position);
    expect(position, "the calendar must be an absolutely positioned popover").toBe("absolute");
    const heightAfter = (await form.boundingBox())?.height ?? 0;
    expect(Math.abs(heightAfter - heightBefore), "the popover must not displace the layout").toBeLessThan(4);

    diag.expectClean();
  });

  test("PLAY-004 the calendar renders correctly", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    await dateButton(page).click();
    const dialog = calendarDialog(page);
    await expect(dialog).toBeVisible();

    expect(await dayButtons(page).count(), "day cells in a month grid").toBeGreaterThanOrEqual(28);
    await expect(dialog.getByRole("button", { name: "Previous month" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Next month" })).toBeVisible();
    await expect(dialog).toContainText(/\d{4}/);
    await expect(dialog).toContainText(/Recording available/);

    diag.expectClean();
  });

  test("PLAY-005 unavailable dates are disabled", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    await dateButton(page).click();
    await expect(calendarDialog(page)).toBeVisible();

    const today = todayInKolkata();
    const recorded = await recordedDates(page, 1, today.slice(0, 7));
    const monthStart = `${today.slice(0, 7)}-01`;
    const dayCount = new Date(
      Number(today.slice(0, 4)),
      Number(today.slice(5, 7)),
      0,
    ).getDate();

    let checked = 0;
    for (let day = 1; day <= dayCount; day += 1) {
      const date = new Date(`${monthStart}T12:00:00`);
      date.setDate(day);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate(),
      ).padStart(2, "0")}`;
      if (iso > today || recorded.includes(iso)) continue;
      // A past day with no recording must be disabled.
      await expect(
        calendarDialog(page).getByRole("button", { name: `${calendarLabel(iso)} — no recording`, exact: true }),
        `unavailable date ${iso} must be disabled`,
      ).toBeDisabled();
      checked += 1;
      if (checked >= 3) break;
    }
    if (checked === 0) {
      test.info().annotations.push({
        type: "environment",
        description: "every past day this month has a recording, so no unavailable past date was available to check",
      });
    }

    diag.expectClean();
  });

  test("PLAY-006 future dates are disabled", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    await dateButton(page).click();
    const dialog = calendarDialog(page);
    await expect(dialog).toBeVisible();

    /*
     * Future days are checked inside the displayed month rather than by paging
     * forward: browsing to a month with no recordings deliberately snaps back to
     * the nearest month that has one (see PlaybackView's back-search effect), so
     * a wholly future month cannot be held on screen.
     */
    const today = todayInKolkata();
    const [year, month, day] = today.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    let checked = 0;
    for (let candidate = (day ?? 1) + 1; candidate <= daysInMonth && checked < 5; candidate += 1) {
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(candidate).padStart(2, "0")}`;
      const available = dialog.getByRole("button", {
        name: `${calendarLabel(iso)} — recording available`,
        exact: true,
      });
      const unavailable = dialog.getByRole("button", {
        name: `${calendarLabel(iso)} — no recording`,
        exact: true,
      });
      const cell = (await available.count()) > 0 ? available : unavailable;
      await expect(cell, `future date ${iso} must be disabled`).toBeDisabled();
      checked += 1;
    }

    if (checked === 0) {
      test.info().annotations.push({
        type: "environment",
        description: "today is the last day of the month, so there is no future date in view to check",
      });
    }

    diag.expectClean();
  });

  test("PLAY-007 selecting a recorded date updates the view", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Playback" })).toBeVisible();
    await expect.poll(async () => displayedDate(page), { timeout: 15_000 }).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const today = todayInKolkata();
    const current = await displayedDate(page);
    // A different recorded day than the one already selected: re-clicking the
    // selected day is a no-op in the calendar's single-select mode.
    const recorded = (await recordedDates(page, 1, today.slice(0, 7)))
      .filter((date) => date <= today && date !== current)
      .sort();
    if (recorded.length === 0) {
      test.info().annotations.push({
        type: "environment",
        description: "no second recorded date available this month to switch to",
      });
      diag.expectClean();
      return;
    }
    const target = recorded[recorded.length - 1]!;

    await dateButton(page).click();
    await expect(calendarDialog(page)).toBeVisible();
    const cell = calendarDialog(page).getByRole("button", {
      name: `${calendarLabel(target)} — recording available`,
      exact: true,
    });
    await expect(cell).toBeEnabled();
    await cell.click();

    await expect(calendarDialog(page)).toHaveCount(0);
    await expect.poll(async () => displayedDate(page), { timeout: 10_000 }).toBe(target);

    diag.expectClean();
  });

  test("PLAY-008 the timeline appears", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    const timeline = page.getByRole("region", { name: "Timeline" });
    await expect(timeline).toBeVisible();
    await expect(timeline).toBeInViewport();
    await expect(timeline.getByRole("heading", { name: "Timeline" })).toBeVisible();
    diag.expectClean();
  });

  test("PLAY-009 recording segments are visible when recordings exist", async ({ page, diag }) => {
    // The timeline frame renders before the search response arrives, so wait for
    // the recordings request itself before counting segments.
    const searchLoaded = page
      .waitForResponse(
        (response) => response.url().includes("/api/playback/search?") && response.status() === 200,
        { timeout: 25_000 },
      )
      .catch(() => null);
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
    await searchLoaded;

    const camera = await firstCamera(page);
    const date = await displayedDate(page);
    const recordings = await recordingsFor(page, camera.id, date);

    if (recordings.length === 0) {
      test.info().annotations.push({
        type: "environment",
        description: `no recordings returned for camera ${camera.id} on ${date}`,
      });
    } else {
      const segments = page.getByRole("region", { name: "Timeline" }).locator("span[title]");
      await expect
        .poll(async () => segments.count(), { timeout: 20_000, message: "recording segments on the timeline" })
        .toBeGreaterThan(0);
    }

    diag.expectClean();
  });

  test("PLAY-010 event markers appear when the day has events", async ({ page, diag }) => {
    // The view loads recordings first and the day's events after, so wait for
    // that second request before counting markers.
    const eventsLoaded = page
      .waitForResponse(
        (response) => response.url().includes("/api/events?") && response.status() === 200,
        { timeout: 25_000 },
      )
      .catch(() => null);
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
    await eventsLoaded;

    const camera = await firstCamera(page);
    const date = await displayedDate(page);
    const events = await eventsFor(page, camera.id, date);

    if (events.length === 0) {
      test.info().annotations.push({
        type: "environment",
        description: `no timed events returned for camera ${camera.id} on ${date}`,
      });
    } else {
      const markers = page
        .getByRole("region", { name: "Timeline" })
        .locator('button[aria-label*="priority"]');
      await expect
        .poll(async () => markers.count(), { timeout: 20_000, message: "event markers on the timeline" })
        .toBeGreaterThan(0);
    }

    diag.expectClean();
  });

  test("PLAY-011 playback controls are visible", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    const player = page.getByRole("region", { name: "Playback" });
    await expect(player.getByRole("button", { name: "Seek backward 15 seconds" })).toBeVisible();
    await expect(player.getByRole("button", { name: /Play|Pause/ })).toBeVisible();
    await expect(player.getByRole("button", { name: "Seek forward 15 seconds" })).toBeVisible();
    await expect(player.getByRole("button", { name: /Mute|Unmute/ })).toBeVisible();
    await expect(player.getByRole("slider", { name: "Volume" })).toBeVisible();
    await expect(player.getByRole("button", { name: "Full screen" })).toBeVisible();
    diag.expectClean();
  });

  test("PLAY-012 the video preserves the source aspect ratio", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Playback" })).toBeVisible();
    await page.waitForTimeout(2500);

    const video = page.getByLabel("Recording playback");
    await expect(video).toHaveCount(1);

    // The picture is never stretched or cropped, whatever the source ratio is.
    expect(
      await video.evaluate((node) => getComputedStyle(node).objectFit),
      "the video must use object-fit: contain",
    ).toBe("contain");

    const meta = await video.evaluate((node) => {
      const element = node as HTMLVideoElement;
      const stage = element.parentElement;
      return {
        sourceWidth: element.videoWidth,
        sourceHeight: element.videoHeight,
        elementWidth: element.clientWidth,
        elementHeight: element.clientHeight,
        stageWidth: stage?.clientWidth ?? 0,
        stageHeight: stage?.clientHeight ?? 0,
      };
    });

    if (meta.sourceWidth > 0 && meta.sourceHeight > 0 && meta.elementWidth > 0 && meta.elementHeight > 0) {
      const sourceRatio = meta.sourceWidth / meta.sourceHeight;
      const tolerance = 0.04;
      expect(
        Math.abs(meta.elementWidth / meta.elementHeight - sourceRatio) / sourceRatio,
        `displayed video ratio must match the source ratio (${meta.sourceWidth}x${meta.sourceHeight})`,
      ).toBeLessThan(tolerance);
      if (meta.stageWidth > 0 && meta.stageHeight > 0) {
        expect(
          Math.abs(meta.stageWidth / meta.stageHeight - sourceRatio) / sourceRatio,
          "the player stage must hug the source ratio",
        ).toBeLessThan(tolerance);
      }
    } else {
      test.info().annotations.push({
        type: "environment",
        description: "no decoded video frame available: aspect ratio verified through object-fit: contain only",
      });
    }

    diag.expectClean();
  });

  test("PLAY-013 the full normal layout fits the desktop viewport in order", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
    await page.waitForTimeout(1000);

    const viewport = page.viewportSize()!;
    const filtersBox = (await page.locator("form").first().boundingBox())!;
    const player = page.getByRole("region", { name: "Playback" });
    const playerBox = (await player.boundingBox())!;
    const controlsBox = (await player.getByRole("button", { name: "Full screen" }).boundingBox())!;
    const timelineBox = (await page.getByRole("region", { name: "Timeline" }).boundingBox())!;

    // Date/search controls -> video -> playback controls -> timeline.
    expect(filtersBox.y + filtersBox.height, "filters above the video").toBeLessThanOrEqual(playerBox.y + 1);
    expect(controlsBox.y, "controls below the top of the player").toBeGreaterThan(playerBox.y);
    expect(timelineBox.y, "timeline below the controls").toBeGreaterThan(controlsBox.y);

    // The timeline stays in the normal desktop viewport without page scrolling.
    await expect(page.getByRole("region", { name: "Timeline" })).toBeInViewport();
    expect(timelineBox.y + timelineBox.height, "timeline inside the viewport").toBeLessThanOrEqual(
      viewport.height + 2,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2),
      "the page itself must not need scrolling",
    ).toBe(true);

    diag.expectClean();
  });

  test("PLAY-014 there is no large empty area between the controls and the timeline", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
    await page.waitForTimeout(1000);

    const player = page.getByRole("region", { name: "Playback" });
    const controlsBox = (await player.getByRole("button", { name: "Full screen" }).boundingBox())!;
    const timelineBox = (await page.getByRole("region", { name: "Timeline" }).boundingBox())!;

    const gap = timelineBox.y - (controlsBox.y + controlsBox.height);
    expect(gap, "vertical gap between the controls and the timeline").toBeGreaterThanOrEqual(0);
    expect(gap, "vertical gap between the controls and the timeline").toBeLessThan(120);

    diag.expectClean();
  });

  test("PLAY-015 video sizing does not push the timeline below the fold", async ({ page, diag }) => {
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
    await page.waitForTimeout(1000);

    const viewport = page.viewportSize()!;
    const timelineBox = (await page.getByRole("region", { name: "Timeline" }).boundingBox())!;
    expect(
      timelineBox.y + timelineBox.height,
      "the timeline must end inside the 1080px viewport",
    ).toBeLessThanOrEqual(viewport.height + 2);

    diag.expectClean();
  });
});
