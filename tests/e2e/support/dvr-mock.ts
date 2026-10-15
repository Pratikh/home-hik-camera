import type { Page } from "@playwright/test";
import { todayInKolkata } from "./app";

/**
 * A deterministic DVR for the playback tests.
 *
 * Those tests used to discover what the real DVR had and then assert the UI
 * matched, so they failed whenever the DVR was offline or had no recordings that
 * day. This installs a fixed recording set into the page and hands the same set
 * to the test, so the assertions are about the *UI*, not about the hardware.
 *
 * Only the DVR-backed endpoints are mocked. `/api/cameras` is left alone: it
 * comes from local configuration and is not part of what is under test.
 */

export type FixtureRecording = {
  id: string;
  camera: number;
  startTime: string;
  endTime: string;
  type: string | null;
  label: string;
};

export type DvrFixture = {
  /** The date the playback view should default to. */
  date: string;
  /** Dates in `month` that have recordings, ascending. */
  dates: string[];
  recordings: FixtureRecording[];
  events: Array<{ id: string; cameraId: number; timestamp: string; priority: string }>;
};

const fixtures = new WeakMap<Page, DvrFixture>();

/** The fixture installed on this page, or null when the test uses the real DVR. */
export function fixtureFor(page: Page): DvrFixture | null {
  return fixtures.get(page) ?? null;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** Recorded dates for the current month: today, plus up to two earlier days. */
function fixtureDates(today: string): string[] {
  const month = today.slice(0, 7);
  const candidates = [`${month}-01`, shiftDate(today, -1), shiftDate(today, -2)]
    .filter((date) => date.startsWith(month) && date <= today);
  return Array.from(new Set([...candidates, today])).sort();
}

export async function installDvrMock(page: Page, camera = 1): Promise<DvrFixture> {
  const today = todayInKolkata();
  const dates = fixtureDates(today);
  const earlier = dates.filter((date) => date !== today);

  const recordingsFor = (date: string): FixtureRecording[] => {
    if (!dates.includes(date)) return [];
    return [
      {
        id: `fixture-${camera}-${date}-a`,
        camera,
        startTime: `${date}T08:15:00+05:30`,
        endTime: `${date}T09:45:00+05:30`,
        type: "continuous",
        label: "Continuous",
      },
      {
        id: `fixture-${camera}-${date}-b`,
        camera,
        startTime: `${date}T12:20:00+05:30`,
        endTime: `${date}T13:18:00+05:30`,
        type: "motion",
        label: "Motion",
      },
    ];
  };

  const events: DvrFixture["events"] = [
    { id: `evt_fixture_a`, cameraId: camera, timestamp: `${today}T08:30:00+05:30`, priority: "high" },
    { id: `evt_fixture_b`, cameraId: camera, timestamp: `${today}T12:45:00+05:30`, priority: "normal" },
  ];

  const fixture: DvrFixture = {
    date: today,
    dates,
    recordings: recordingsFor(today),
    events,
  };
  fixtures.set(page, fixture);

  const json = (route: Parameters<Parameters<Page["route"]>[1]>[0], body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/playback/recording-dates*", async (route) => {
    const url = new URL(route.request().url());
    const month = url.searchParams.get("month") ?? today.slice(0, 7);
    await json(route, { dates: dates.filter((date) => date.startsWith(month)) });
  });

  await page.route("**/api/playback/search*", async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get("date") ?? today;
    await json(route, { recordings: recordingsFor(date) });
  });

  await page.route("**/api/events?*", async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get("date") ?? today;
    await json(route, {
      events: date === today ? events : [],
      page: 1,
      pageSize: 100,
      total: date === today ? events.length : 0,
    });
  });

  // The playback view shows an offline banner when the DVR is down.
  await page.route("**/api/dvr/status*", async (route) => {
    await json(route, {
      dvr: "connected",
      message: "Connected",
      videoGateway: "connected",
      media: { reachable: true, paths: [], drift: false, message: null },
      checkedAt: new Date().toISOString(),
    });
  });

  // Exposed so a test can assert against the same data the page received.
  void earlier;
  return fixture;
}
