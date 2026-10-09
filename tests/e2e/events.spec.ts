import { ADMIN_STATE } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { ROUTES } from "./support/app";

/**
 * EVENT — the events list and detail.
 *
 * This DVR produces motion events only; person and vehicle are classification
 * labels on a motion event, not separate types. The tests only exercise filters
 * the UI actually exposes.
 */
test.use({ storageState: ADMIN_STATE });

type RecentEvents = { events: Array<{ id: string; timestamp: string }> };

/** The date of the newest stored event, so the tests never depend on the clock. */
async function newestEventDate(page: import("@playwright/test").Page): Promise<string | null> {
  const response = await page.request.get("/api/events/recent?limit=5");
  if (response.status() !== 200) return null;
  const body = (await response.json()) as RecentEvents;
  const first = body.events?.[0];
  return first ? first.timestamp.slice(0, 10) : null;
}

async function searchDate(page: import("@playwright/test").Page, date: string): Promise<void> {
  await page.getByLabel("Date").fill(date);
  const settled = page.waitForResponse(
    (response) => response.url().includes("/api/events?") && response.status() === 200,
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: "Search" }).click();
  await settled;
}

test.describe("EVENT - events", () => {
  test("EVENT-001 the events page loads", async ({ page, diag }) => {
    await page.goto(ROUTES.events);
    await expect(page.getByRole("heading", { level: 1, name: "Events" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Event list" })).toBeVisible();
    diag.expectClean();
  });

  test("EVENT-002 the event list is visible", async ({ page, diag }) => {
    await page.goto(ROUTES.events);
    const list = page.getByRole("region", { name: "Event list" });
    await expect(list).toBeVisible();
    await expect(list).toContainText(/\d+ events/);
    diag.expectClean();
  });

  test("EVENT-003 the priority filter is applied to the search", async ({ page, diag }) => {
    await page.goto(ROUTES.events);
    await expect(page.getByRole("region", { name: "Event list" })).toBeVisible();

    const priority = page.getByLabel("Priority");
    await priority.selectOption("HIGH");
    await expect(priority).toHaveValue("HIGH");

    const request = page.waitForRequest(
      (candidate) => candidate.url().includes("/api/events?") && candidate.url().includes("priority=HIGH"),
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: "Search" }).click();
    const observed = await request;
    expect(observed.url()).toContain("priority=HIGH");

    diag.expectClean();
  });

  test("EVENT-004 the event type filters are applied to the search", async ({ page, diag }) => {
    await page.goto(ROUTES.events);
    await expect(page.getByRole("region", { name: "Event list" })).toBeVisible();

    // Quick filter: Person is a classification on a motion event.
    const personRequest = page.waitForRequest(
      (candidate) => candidate.url().includes("/api/events?") && candidate.url().includes("classification=person"),
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: "Person", exact: true }).click();
    expect((await personRequest).url()).toContain("classification=person");

    const motionRequest = page.waitForRequest(
      (candidate) => candidate.url().includes("/api/events?") && candidate.url().includes("classification=none"),
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: "Motion", exact: true }).click();
    expect((await motionRequest).url()).toContain("classification=none");

    // Explicit classification select. Reset the quick filter first: while the
    // "Motion" quick filter is active it takes precedence over the select.
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByLabel("Classification").selectOption("vehicle");
    const vehicleRequest = page.waitForRequest(
      (candidate) => candidate.url().includes("/api/events?") && candidate.url().includes("classification=vehicle"),
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: "Search" }).click();
    expect((await vehicleRequest).url()).toContain("classification=vehicle");

    diag.expectClean();
  });

  test("EVENT-005 an event can be opened", async ({ page, diag }) => {
    await page.goto(ROUTES.events);
    const date = await newestEventDate(page);
    if (!date) {
      test.info().annotations.push({ type: "environment", description: "no stored events to open" });
      diag.expectClean();
      return;
    }
    await searchDate(page, date);

    const list = page.getByRole("region", { name: "Event list" });
    const firstEvent = list.locator("li button").first();
    await expect(firstEvent).toBeVisible();
    await firstEvent.click();

    await expect(page.getByRole("article", { name: "Event details" })).toBeVisible();

    diag.expectClean();
  });

  test("EVENT-006 the event detail metadata is visible", async ({ page, diag }) => {
    await page.goto(ROUTES.events);
    const date = await newestEventDate(page);
    if (!date) {
      test.info().annotations.push({ type: "environment", description: "no stored events to inspect" });
      diag.expectClean();
      return;
    }
    await searchDate(page, date);
    await page.getByRole("region", { name: "Event list" }).locator("li button").first().click();

    const detail = page.getByRole("article", { name: "Event details" });
    await expect(detail).toBeVisible();
    for (const label of ["Camera", "Time", "Duration", "Type", "Classification", "Confidence", "Notified"]) {
      await expect(detail, `event metadata must include "${label}"`).toContainText(label);
    }
    await expect(detail.getByRole("link", { name: "View recording" })).toBeVisible();
    await expect(detail.getByRole("link", { name: "Open details" })).toBeVisible();

    diag.expectClean();
  });

  test("EVENT-007 the snapshot area is determinate", async ({ page, diag }) => {
    await page.goto(ROUTES.events);
    const date = await newestEventDate(page);
    if (!date) {
      test.info().annotations.push({ type: "environment", description: "no stored events to inspect" });
      diag.expectClean();
      return;
    }
    await searchDate(page, date);
    await page.getByRole("region", { name: "Event list" }).locator("li button").first().click();

    const detail = page.getByRole("article", { name: "Event details" });
    await expect(detail).toBeVisible();

    // Either the snapshot loads, or the app says it is unavailable. Both are
    // determinate; a permanent "Checking" or a broken image is not.
    await expect
      .poll(
        async () => {
          const image = detail.locator('img[alt^="Snapshot for"]');
          if ((await image.count()) === 0) {
            return (await detail.getByText("Snapshot not available").count()) > 0 ? "unavailable" : "pending";
          }
          const loaded = await image.first().evaluate((node) => {
            const element = node as HTMLImageElement;
            return element.complete && element.naturalWidth > 0;
          });
          return loaded ? "loaded" : "pending";
        },
        { timeout: 20_000, message: "the snapshot area must resolve to an image or an explicit unavailable state" },
      )
      .not.toBe("pending");

    if ((await detail.locator('img[alt^="Snapshot for"]').count()) === 0) {
      test.info().annotations.push({
        type: "environment",
        description: "no snapshot available for this event; the UI reports it explicitly",
      });
    }

    diag.expectClean();
  });

  test("EVENT-008 no unexpected console errors", async ({ page, diag }) => {
    await page.goto(ROUTES.events);
    await expect(page.getByRole("region", { name: "Event list" })).toBeVisible();
    await page.waitForTimeout(1000);
    diag.expectClean();
  });
});
