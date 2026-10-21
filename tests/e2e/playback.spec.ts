import { ADMIN_STATE } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { ROUTES, todayInKolkata, type CameraInfo } from "./support/app";
import type { Page } from "@playwright/test";
import { fixtureFor, installDvrMock } from "./support/dvr-mock";

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
  // When a fixture is installed the page is mocked, so read the same data the
  // page received instead of asking the real DVR (APIRequestContext bypasses routes).
  const fixture = fixtureFor(page);
  if (fixture) return fixture.dates.filter((date) => date.startsWith(month));
  const response = await page.request.get(
    `/api/playback/recording-dates?camera=${camera}&month=${encodeURIComponent(month)}`,
  );
  if (response.status() !== 200) return [];
  const body = (await response.json()) as { dates?: string[] };
  return body.dates ?? [];
}

async function recordingsFor(page: Page, camera: number, date: string): Promise<RecordingsResponse["recordings"]> {
  const fixture = fixtureFor(page);
  if (fixture) return fixture.dates.includes(date) ? fixture.recordings : [];
  const response = await page.request.get(
    `/api/playback/search?camera=${camera}&date=${date}&startTime=00:00&endTime=23:59`,
  );
  if (response.status() !== 200) return [];
  const body = (await response.json()) as RecordingsResponse;
  return body.recordings ?? [];
}

async function eventsFor(page: Page, camera: number, date: string): Promise<EventsResponse["events"]> {
  const fixture = fixtureFor(page);
  if (fixture) return date === fixture.date ? fixture.events : [];
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
    await installDvrMock(page);
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
    await installDvrMock(page);
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
    await installDvrMock(page);
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
    await installDvrMock(page);
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
    await installDvrMock(page);
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

  test("PLAY-016 selecting a recorded time starts real video", async ({ page, diag }) => {
    /*
     * The bug this guards: playback used to ask the DVR for the H.265 main track
     * (...1). MediaMTX's MPEG-TS HLS variant carries H.264 only, so a remote
     * browser got a 500 and an error panel while the page itself still looked
     * healthy. Nothing short of "does a frame ever arrive" catches that, so this
     * test selects a recorded instant and waits for decoded frames.
     */
    const searchLoaded = page
      .waitForResponse(
        (response) => response.url().includes("/api/playback/search?") && response.status() === 200,
        { timeout: 25_000 },
      )
      .catch(() => null);
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Playback" })).toBeVisible();
    await searchLoaded;

    const camera = await firstCamera(page);
    const date = await displayedDate(page);
    const recordings = await recordingsFor(page, camera.id, date);
    if (recordings.length === 0) {
      test.info().annotations.push({
        type: "environment",
        description: `no recordings returned for camera ${camera.id} on ${date}`,
      });
      diag.expectClean();
      return;
    }

    // The default zoom is the whole day, so a recorded instant maps to a
    // fraction of the timeline's width: aim a minute inside the first segment.
    const first = recordings[0]!;
    const dayStartMs = new Date(`${date}T00:00:00+05:30`).getTime();
    const instant = Math.min(new Date(first.startTime).getTime() + 60_000, new Date(first.endTime).getTime() - 1_000);
    const fraction = Math.min(0.98, Math.max(0.02, (instant - dayStartMs) / 86_400_000));

    const slider = page.getByRole("slider", { name: "Recording timeline. Use the arrow keys to seek." });
    await expect(slider).toBeVisible();
    const box = (await slider.boundingBox())!;
    await slider.click({ position: { x: Math.round(box.width * fraction), y: 12 } });

    const video = page.getByLabel("Recording playback");
    const state = () =>
      video.evaluate((node) => {
        const element = node as HTMLVideoElement;
        return {
          width: element.videoWidth,
          height: element.videoHeight,
          time: element.currentTime,
          mediaError: element.error?.message ?? null,
        };
      });

    await expect
      .poll(async () => (await state()).width, {
        timeout: 45_000,
        message: "a decoded video frame from the DVR playback stream",
      })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await state()).time, { timeout: 30_000, message: "the playback clock advancing" })
      .toBeGreaterThan(0);

    const settled = await state();
    expect(settled.mediaError, "the video element must not hold a MediaError").toBeNull();
    // H.264 sub-track frames, not the H.265 main track: the fix, pinned.
    expect(settled.width, "playback must come from the H.264 sub stream").toBe(704);
    expect(settled.height).toBe(576);

    diag.expectClean();

    /*
     * Leave the page the way a person would, so the client's own teardown closes
     * the DVR playback session. This DVR serves one playback stream at a time, so
     * a session left open by an abruptly killed context would make the next
     * playback run answer 453 Not Enough Bandwidth.
     */
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByRole("region", { name: "Playback" })).toHaveCount(0);
  });

  test("PLAY-017 hovering the timeline previews a frame without seeking or storming the DVR", async ({ page, diag }) => {
    /*
     * Previews are pre-generated, so the promises are now: a card appears with
     * the time under the cursor, hovering never seeks, and a sweep across the
     * track costs a handful of index/sprite reads and no DVR work at all. The
     * browser must not be running frame extraction — there is nothing left that
     * could.
     */
    const searchLoaded = page
      .waitForResponse(
        (response) => response.url().includes("/api/playback/search?") && response.status() === 200,
        { timeout: 25_000 },
      )
      .catch(() => null);
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Playback" })).toBeVisible();
    await searchLoaded;

    const camera = await firstCamera(page);
    const date = await displayedDate(page);
    const recordings = await recordingsFor(page, camera.id, date);
    if (recordings.length === 0) {
      test.info().annotations.push({
        type: "environment",
        description: `no recordings returned for camera ${camera.id} on ${date}`,
      });
      return;
    }

    const previewRequests: { url: string; status: number | null }[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/playback/thumbnail")) previewRequests.push({ url: request.url(), status: null });
    });
    page.on("response", (response) => {
      if (!response.url().includes("/api/playback/thumbnail")) return;
      const entry = previewRequests.find((item) => item.url === response.url() && item.status === null);
      if (entry) entry.status = response.status();
    });

    const slider = page.getByRole("slider", { name: "Recording timeline. Use the arrow keys to seek." });
    await expect(slider).toBeVisible();
    /*
     * The page autoplays, so the playhead moves on its own. Pause first, or the
     * "hover must not seek" check would be racing the clock rather than testing
     * the pointer.
     */
    const pause = page.getByRole("button", { name: "Pause" });
    if (await pause.count()) {
      await pause.first().click().catch(() => undefined);
      await page.waitForTimeout(600);
    }
    const box = (await slider.boundingBox())!;
    const pointerBefore = await slider.getAttribute("aria-valuenow");
    const beforeSweep = previewRequests.length;

    const dayStartMs = new Date(`${date}T00:00:00+05:30`).getTime();
    const first = recordings[0]!;
    const inside = Math.min(new Date(first.startTime).getTime() + 60_000, new Date(first.endTime).getTime() - 1_000);
    const fraction = Math.min(0.97, Math.max(0.03, (inside - dayStartMs) / 86_400_000));
    const y = box.y + 30;

    // Sweep rapidly across the recorded span: dozens of pointer moves.
    for (let step = 0; step <= 24; step += 1) {
      const x = box.x + Math.round(box.width * (0.2 + (0.6 * step) / 24));
      await page.mouse.move(x, y);
    }
    // Settle on one recorded instant.
    await page.mouse.move(box.x + Math.round(box.width * fraction), y);

    // The preview card names itself "Preview at HH:MM:SS"; the marker popover does
    // not, so the two role="tooltip" elements can never be confused.
    const card = page.getByRole("tooltip", { name: /^Preview at / });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/\d{2}:\d{2}:\d{2}/);

    await page.waitForTimeout(900);
    const duringSweep = previewRequests.length - beforeSweep;
    /*
     * Each unseen 12-minute sheet costs exactly one fetch, and caching makes the
     * next hover in it free — so the count tracks *sheets crossed*, never pointer
     * moves. A sweep of 25 moves must stay far below one request per move.
     */
    expect(
      duringSweep,
      `a 25 step sweep must not request per pointer move (got ${duringSweep})`,
    ).toBeLessThanOrEqual(12);

    // Only pre-generated data is ever read: an index and, at most, sprite sheets.
    for (const request of previewRequests) {
      expect(request.url, "hover must only read pre-generated previews").toMatch(
        /\/api\/playback\/thumbnail\/(index|sprite)/,
      );
      expect(request.status ?? 200, request.url).toBeLessThan(500);
    }

    // Hovering must never move the playhead: only a click may seek.
    expect(await slider.getAttribute("aria-valuenow"), "hover must not change the playhead").toBe(pointerBefore);

    const picture = card.locator('[role="img"], div[style*="background-image"]');
    if ((await picture.count()) > 0) {
      const style = (await picture.first().getAttribute("style")) ?? "";
      expect(style, "the preview must be a window onto a generated sprite sheet").toContain(
        "/api/playback/thumbnail/sprite",
      );
    } else {
      /*
       * Nothing generated here yet (or the DVR is busy with the player, which the
       * generator stands down for). The card must still show the time and say so
       * rather than block the timeline.
       */
      await expect(card).toContainText(/Preview generating|Preview unavailable|Pause to preview|No recording/i);
      test.info().annotations.push({
        type: "environment",
        description: "no generated frame near this instant yet; the card degraded to its timestamp",
      });
    }

    diag.expectClean({ allowStatuses: [404, 409, 502] });
  });

  test("PLAY-018 the preview follows the hovered instant and never reuses a distant frame", async ({ page, diag }) => {
    /*
     * The bug this pins: hovering anywhere on the timeline showed one frozen
     * image whose clock was a generated frame from hours away. The selector used
     * to fall back to "the nearest bucket" when nothing was generated nearby, so
     * 02:17 and 04:48 both resolved to the same 11:52 frame at crop 0,0.
     */
    const clock = (ms: number) =>
      new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false });

    const searchLoaded = page
      .waitForResponse(
        (response) => response.url().includes("/api/playback/search?") && response.status() === 200,
        { timeout: 25_000 },
      )
      .catch(() => null);
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Playback" })).toBeVisible();
    await searchLoaded;

    const camera = await firstCamera(page);
    const date = await displayedDate(page);
    type Index = { buckets: { start: number; version: number; frames: number[] }[]; progress: { generated: number } };
    const index = (await page.request
      .get(`/api/playback/thumbnail/index?camera=${camera.id}&date=${date}&focus=${Date.now()}`)
      .then((r) => r.json())) as Index;
    const frames = index.buckets.flatMap((bucket) => bucket.frames).sort((a, b) => a - b);
    if (frames.length < 2) {
      test.info().annotations.push({
        type: "environment",
        description: `only ${frames.length} generated frame(s) for this day; nothing to compare yet`,
      });
      return;
    }

    const dayStartMs = new Date(`${date}T00:00:00+05:30`).getTime();
    const slider = page.getByRole("slider", { name: "Recording timeline. Use the arrow keys to seek." });
    const box = (await slider.boundingBox())!;
    const y = box.y + 30;
    const hoverAt = async (ms: number) => {
      const ratio = Math.min(0.995, Math.max(0.005, (ms - dayStartMs) / 86_400_000));
      await page.mouse.move(box.x + Math.round(box.width * ratio), y);
      await page.waitForTimeout(500);
    };
    const read = async () => {
      const card = page.getByRole("tooltip", { name: /^Preview at / });
      await expect(card).toBeVisible();
      const picture = card.locator('[role="img"]');
      const shown = await picture.count();
      return {
        shown,
        style: shown > 0 ? ((await picture.first().getAttribute("style")) ?? "") : "",
        text: ((await card.textContent()) ?? "").replace(/\s+/g, " "),
      };
    };

    // Two instants that really are generated, as far apart as the data allows.
    const firstFrame = frames[0]!;
    const lastFrame = frames[frames.length - 1]!;

    await hoverAt(firstFrame);
    const a = await read();
    await hoverAt(lastFrame);
    const b = await read();

    expect(a.shown, "a generated instant must show a picture").toBeGreaterThan(0);
    expect(b.shown, "a generated instant must show a picture").toBeGreaterThan(0);
    // TEST 1/2/3: different instants produce different sources or different crops.
    expect(a.style, `${clock(firstFrame)} and ${clock(lastFrame)} must not render the same tile`).not.toBe(b.style);
    /*
     * The caption describes the hovered instant, which is a pixel-rounded point
     * on a 24-hour timeline. One pixel is roughly a minute here, so allow that
     * quantisation; the bug this pins was a caption hours away, not a few
     * seconds. The style assertion above is the exact source-of-frame check.
     */
    const captionMs = (text: string): number | null => {
      const stamp = /\d{2}:\d{2}:\d{2}/.exec(text)?.[0];
      if (!stamp) return null;
      const [h, m, s] = stamp.split(":").map(Number);
      return dayStartMs + h! * 3600_000 + m! * 60_000 + s! * 1000;
    };
    expect(Math.abs((captionMs(a.text) ?? -Infinity) - firstFrame)).toBeLessThanOrEqual(90_000);
    expect(Math.abs((captionMs(b.text) ?? -Infinity) - lastFrame)).toBeLessThanOrEqual(90_000);

    // TEST: an instant with nothing generated nearby shows no stale picture.
    // Pick the middle of the biggest empty stretch inside the day, so the check
    // never drifts outside the day (or onto a generated cell by accident).
    const dayEndMs = dayStartMs + 86_400_000;
    const edges = [dayStartMs, ...frames, dayEndMs];
    let gapStart = dayStartMs;
    let gapEnd = dayStartMs;
    for (let i = 1; i < edges.length; i += 1) {
      const from = edges[i - 1]!;
      const to = edges[i]!;
      if (to - from > gapEnd - gapStart) {
        gapStart = from;
        gapEnd = to;
      }
    }
    if (gapEnd - gapStart < 60 * 60_000) {
      test.info().annotations.push({
        type: "environment",
        description: "generated frames are spread across the whole day; no hour-long empty stretch to probe",
      });
      return;
    }
    const far = Math.round((gapStart + gapEnd) / 2);
    await hoverAt(far);
    const c = await read();
    expect(c.shown, "an ungenerated instant must not recycle a distant frame").toBe(0);
    expect(c.text, "the caption must describe the hovered instant").not.toContain(clock(firstFrame));
    // The caption tracks the pointer (within the few minutes a pixel spans).
    const stamp = /\d{2}:\d{2}:\d{2}/.exec(c.text)?.[0];
    expect(stamp).toBeTruthy();
    if (stamp) {
      const [h, m, sec] = stamp.split(":").map(Number);
      const shownMs = dayStartMs + h! * 3600_000 + m! * 60_000 + sec! * 1000;
      expect(Math.abs(shownMs - far), `caption ${stamp} should describe ${clock(far)}`).toBeLessThan(3 * 60_000);
    }

    diag.expectClean({ allowStatuses: [404, 409, 502] });
  });

  test("PLAY-019 crossing an event marker keeps one stable preview", async ({ page, diag }) => {
    /*
     * The bug this pins: an event marker owned the preview. Entering it snapped
     * the preview to the event's own instant and leaving it deleted the preview
     * outright, so sweeping across a "Person detected" marker flickered the card
     * away until the next pointermove. The marker detail popover also sat in the
     * flow, growing the timeline section by its own height and shoving the whole
     * timeline (and the card) up by ~225 px.
     */
    const searched = page
      .waitForResponse(
        (response) => response.url().includes("/api/playback/search?") && response.status() === 200,
        { timeout: 25_000 },
      )
      .catch(() => null);
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("region", { name: "Playback" })).toBeVisible();
    await searched;

    // Markers only exist once the day's events have loaded.
    await page
      .waitForResponse((response) => response.url().includes("/api/events?") && response.status() === 200, {
        timeout: 20_000,
      })
      .catch(() => null);

    const markers = page.locator('button[aria-label*="priority"]');
    await expect(markers.first()).toBeVisible({ timeout: 20_000 }).catch(() => undefined);
    if ((await markers.count()) === 0) {
      test.info().annotations.push({ type: "environment", description: "this day has no event markers" });
      return;
    }

    const pause = page.getByRole("button", { name: "Pause" });
    if (await pause.count()) {
      await pause.first().click().catch(() => undefined);
      await page.waitForTimeout(500);
    }

    const slider = page.getByRole("slider", { name: "Recording timeline. Use the arrow keys to seek." });
    const card = page.getByRole("tooltip", { name: /^Preview at / });
    const sliderBox = (await slider.boundingBox())!;
    /*
     * Use a marker with room on both sides. The first event of the day can sit
     * within 40 px of the timeline start; probing markerX - 40 there lands
     * outside the slider and tests the page margin, not the app.
     */
    let markerIndex = -1;
    let markerBox: { x: number; y: number; width: number; height: number } | null = null;
    for (let index = 0; index < (await markers.count()); index += 1) {
      const box = await markers.nth(index).boundingBox();
      if (!box) continue;
      const centerX = box.x + box.width / 2;
      if (centerX - sliderBox.x >= 80 && sliderBox.x + sliderBox.width - centerX >= 80) {
        markerIndex = index;
        markerBox = box;
        break;
      }
    }
    if (!markerBox) {
      test.info().annotations.push({
        type: "environment",
        description: "every event marker sits at the timeline edge; no room to probe both sides",
      });
      return;
    }
    const marker = markers.nth(markerIndex);
    const markerX = markerBox.x + markerBox.width / 2;
    // The preview tracks the pointer over the timeline track, not over the
    // marker button's popover.
    const trackY = sliderBox.y + 30;

    // 1. Opening the marker popover must not move the timeline.
    const before = (await slider.boundingBox())!;
    await page.mouse.move(markerX, markerBox.y + markerBox.height / 2);
    await page.waitForTimeout(500);
    const after = (await slider.boundingBox())!;
    expect(Math.abs(after.y - before.y), "the marker popover must not shift the timeline").toBeLessThanOrEqual(2);
    expect(Math.abs(after.height - before.height), "the marker popover must not resize the timeline").toBeLessThanOrEqual(2);

    // 2. The timestamp follows the pointer, not the marker's own instant.
    const caption = async () => {
      await expect(card).toBeVisible();
      return /\d{2}:\d{2}:\d{2}/.exec((await card.textContent()) ?? "")?.[0] ?? "";
    };
    await page.mouse.move(markerX - 40, trackY);
    await page.waitForTimeout(120);
    const left = await caption();
    await page.mouse.move(markerX, trackY);
    await page.waitForTimeout(120);
    const middle = await caption();
    await page.mouse.move(markerX + 40, trackY);
    await page.waitForTimeout(120);
    const right = await caption();
    expect(left && middle && right, "a hover over the timeline must always name an instant").toBeTruthy();
    expect(left < middle, `caption must advance with the pointer (${left} < ${middle})`).toBe(true);
    expect(middle < right, `caption must advance with the pointer (${middle} < ${right})`).toBe(true);

    // 3. Crossing the marker repeatedly must never remove the preview.
    await page.evaluate(() => {
      const state = { gaps: 0, timer: 0 };
      (window as unknown as { __cross: typeof state }).__cross = state;
      state.timer = window.setInterval(() => {
        if (!document.querySelector('[role="tooltip"][aria-label^="Preview at "]')) state.gaps += 1;
      }, 16);
    });
    const previewRequests: string[] = [];
    const onRequest = (request: { url: () => string }) => {
      if (request.url().includes("/api/playback/thumbnail")) previewRequests.push(request.url());
    };
    page.on("request", onRequest);

    for (const dx of [-40, -20, 0, 20, 40, 20, 0, -20, -40, -20, 0, 20, 40]) {
      await page.mouse.move(markerX + dx, trackY);
      await page.waitForTimeout(70);
    }
    const gaps = await page.evaluate(() => {
      const state = (window as unknown as { __cross: { gaps: number; timer: number } }).__cross;
      clearInterval(state.timer);
      return state.gaps;
    });
    page.off("request", onRequest);
    expect(gaps, "the preview must not disappear while crossing a marker").toBe(0);

    // 4. Crossing a marker must not ask the server for anything.
    expect(previewRequests.length, "crossing a marker must not request previews").toBeLessThanOrEqual(2);

    // 5. The marker is still clickable and still seeks.
    const playheadBefore = await slider.getAttribute("aria-valuenow");
    await marker.click();
    await expect
      .poll(async () => slider.getAttribute("aria-valuenow"), { timeout: 10_000 })
      .not.toBe(playheadBefore);

    diag.expectClean({ allowStatuses: [404, 409, 502] });
  });
});
