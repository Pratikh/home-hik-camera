import type { Page, Route } from "@playwright/test";
import { ADMIN_STATE } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { ROUTES } from "./support/app";
import type { DetectedFace } from "@/lib/faces";

/**
 * FACE-UI — the Detected Faces page and the event-detail faces section.
 *
 * Desktop only, exactly 1920x1080.
 *
 * The gallery fixtures are served at the network boundary with `page.route`,
 * never written to the production database. The authentication checks in
 * FACE-UI-004 hit the real server, so they prove the real boundary.
 */
test.use({ storageState: ADMIN_STATE });

const EVENT_ID = "evt_aaaaaaaaaaaaaaaaaaaaaaaa";
const FACE_A = "face_111111111111111111111111";
const FACE_B = "face_222222222222222222222222";

/** A 1x1 JPEG, so the card renders a real image response. */
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

function face(overrides: Partial<DetectedFace> = {}): DetectedFace {
  return {
    id: FACE_A,
    eventId: EVENT_ID,
    personId: null,
    confidence: 0.94,
    x: 100,
    y: 120,
    width: 60,
    height: 60,
    hasCrop: true,
    detector: "yunet",
    model: "face_detection_yunet_2023mar",
    createdAt: "2026-10-09T16:34:00+00:00",
    cameraId: 1,
    eventTimestamp: "2026-10-09T22:04:49+05:30",
    eventType: "motion",
    eventClassification: "person",
    ...overrides,
  };
}

async function serveList(page: Page, body: unknown, onRequest?: (url: URL) => void): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/faces",
    async (route: Route) => {
      onRequest?.(new URL(route.request().url()));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    },
  );
}

async function serveFaceImage(page: Page): Promise<void> {
  await page.route(
    (url) => /^\/api\/faces\/[^/]+\/image$/.test(url.pathname),
    async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "image/jpeg", body: TINY_JPEG });
    },
  );
}

/** A real stored event id, so a link can actually resolve to a page. */
async function realEventId(page: Page): Promise<string | null> {
  const response = await page.request.get("/api/events/recent?limit=1");
  if (response.status() !== 200) return null;
  const body = (await response.json()) as { events?: Array<{ id: string }> };
  return body.events?.[0]?.id ?? null;
}

test.describe("FACE-UI - detected faces", () => {
  test("FACE-UI-001 /faces loads for an authorized user", async ({ page, diag }) => {
    const responses: number[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/faces")) responses.push(response.status());
    });

    await page.goto(ROUTES.faces);
    await expect(page.getByRole("heading", { level: 1, name: "Detected Faces" })).toBeVisible();
    // The page always resolves to one of three honest states — never an error,
    // and never a fabricated count.
    await expect
      .poll(
        async () => {
          if ((await page.getByText("Face detection is disabled.").count()) > 0) return "disabled";
          if ((await page.getByText("No detected faces for this period.").count()) > 0) return "empty";
          if ((await page.getByRole("article").count()) > 0) return "faces";
          return "loading";
        },
        { timeout: 15_000, message: "the faces page must resolve to a real state" },
      )
      .not.toBe("loading");
    expect(responses.every((status) => status === 200)).toBe(true);

    diag.expectClean();
  });

  test("FACE-UI-002 detected face cards display correctly", async ({ page, diag }) => {
    await serveFaceImage(page);
    await serveList(page, {
      enabled: true,
      total: 2,
      page: 1,
      pageSize: 24,
      processing: { pending: 1, processing: 0, completed: 5, failed: 0 },
      faces: [
        face(),
        face({ id: FACE_B, confidence: 0.72, hasCrop: false, cameraId: 2, eventTimestamp: "2026-10-08T21:00:00+05:30" }),
      ],
    });

    await page.goto(ROUTES.faces);

    const cards = page.getByRole("article");
    await expect(cards).toHaveCount(2);

    const first = cards.first();
    await expect(first).toContainText("Unassigned");
    await expect(first).toContainText("94% confidence");
    await expect(first.locator("img")).toHaveAttribute("src", `/api/faces/${FACE_A}/image`);
    await expect(first.getByRole("link", { name: "View event" })).toBeVisible();

    const second = cards.nth(1);
    await expect(second).toContainText("72% confidence");
    // A face whose crop is gone says so instead of showing a broken image.
    await expect(second).toContainText("Face image unavailable");
    await expect(second.locator("img")).toHaveCount(0);

    // The page-level counters come from the response, not from a guess.
    await expect(page.getByText(/2 detected faces/)).toBeVisible();
    await expect(page.getByText(/1 snapshot\(s\) queued/)).toBeVisible();

    diag.expectClean();
  });

  test("FACE-UI-003 a face card links to its event", async ({ page, diag }) => {
    const eventId = await realEventId(page);
    if (!eventId) {
      test.info().annotations.push({ type: "environment", description: "no stored event to link to" });
      diag.expectClean();
      return;
    }
    await serveFaceImage(page);
    await serveList(page, {
      enabled: true,
      total: 1,
      page: 1,
      pageSize: 24,
      processing: { pending: 0, processing: 0, completed: 1, failed: 0 },
      faces: [face({ eventId })],
    });
    // The destination page asks for this event's faces too.
    await page.route(
      (url) => url.pathname === `/api/events/${eventId}/faces`,
      async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ enabled: false, eventId, status: "NONE", faces: [] }),
        });
      },
    );

    await page.goto(ROUTES.faces);
    const link = page.getByRole("article").first().getByRole("link", { name: "View event" });
    await expect(link).toHaveAttribute("href", `/events/${eventId}`);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));

    diag.expectClean();
  });

  test("FACE-UI-004 the face image is served only through the authenticated endpoint", async ({ page, qa, diag }) => {
    await serveFaceImage(page);
    await serveList(page, {
      enabled: true,
      total: 1,
      page: 1,
      pageSize: 24,
      processing: { pending: 0, processing: 0, completed: 1, failed: 0 },
      faces: [face()],
    });

    await page.goto(ROUTES.faces);
    const src = await page.getByRole("article").first().locator("img").getAttribute("src");
    // The endpoint, never a static directory or an inline blob.
    expect(src).toBe(`/api/faces/${FACE_A}/image`);
    expect(src).not.toContain("face-crops");
    expect(src).not.toContain("data:");

    // The real server refuses an anonymous request for any face image.
    const anonymous = await qa.freshContext();
    try {
      const denied = await anonymous.request.get(`/api/faces/${FACE_A}/image`, { maxRedirects: 0 });
      expect(denied.status(), "an unauthenticated face image request").toBe(401);
      expect(denied.headers()["content-type"] ?? "").not.toContain("image/jpeg");
    } finally {
      await anonymous.close();
    }

    // Authenticated, but the id does not exist (or the file is gone): 404, not
    // a filesystem error and not an image.
    const missing = await page.request.get("/api/faces/face_999999999999999999999999/image");
    expect(missing.status()).toBe(404);

    diag.expectClean();
  });

  test("FACE-UI-005 the empty state works", async ({ page, diag }) => {
    await serveList(page, {
      enabled: true,
      total: 0,
      page: 1,
      pageSize: 24,
      processing: { pending: 0, processing: 0, completed: 4, failed: 0 },
      faces: [],
    });

    await page.goto(ROUTES.faces);
    await expect(page.getByText("No detected faces for this period.")).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);

    diag.expectClean();
  });

  test("FACE-UI-006 the camera, assignment and confidence filters are applied", async ({ page, diag }) => {
    const requested: URL[] = [];
    await serveList(
      page,
      {
        enabled: true,
        total: 0,
        page: 1,
        pageSize: 24,
        processing: { pending: 0, processing: 0, completed: 0, failed: 0 },
        faces: [],
      },
      (url) => requested.push(url),
    );

    await page.goto(ROUTES.faces);
    await expect(page.getByRole("button", { name: /Apply filters|Loading/ })).toBeVisible();
    requested.length = 0;

    await page.getByLabel("Camera").selectOption("2");
    await page.getByLabel("Assignment").selectOption("false");
    await page.getByLabel("Minimum confidence").selectOption("0.8");
    await page.getByRole("button", { name: /Apply filters|Loading/ }).click();

    await expect.poll(() => requested.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const query = requested[requested.length - 1]!;
    expect(query.searchParams.get("camera")).toBe("2");
    expect(query.searchParams.get("assigned")).toBe("false");
    expect(query.searchParams.get("minConfidence")).toBe("0.8");
    expect(query.searchParams.get("page")).toBe("1");

    diag.expectClean();
  });

  test("FACE-UI-007 the event detail page displays detected faces", async ({ page, diag }) => {
    const eventId = await realEventId(page);
    if (!eventId) {
      test.info().annotations.push({ type: "environment", description: "no stored event to inspect" });
      diag.expectClean();
      return;
    }
    await serveFaceImage(page);
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
                confidence: 0.72,
                x: 270,
                y: 231,
                width: 31,
                height: 42,
                hasCrop: true,
              },
            ],
          }),
        });
      },
    );

    await page.goto(`/events/${eventId}`);

    const section = page.getByRole("region", { name: "Detected faces" });
    await expect(section).toBeVisible();
    await expect(section.getByRole("heading", { name: "Face Detection" })).toBeVisible();
    await expect(section).toContainText("1 face detected");
    await expect(section).toContainText("Confidence: 72%");
    await expect(section).toContainText("Unassigned");
    await expect(section.locator("img")).toHaveAttribute("src", `/api/faces/${FACE_A}/image`);

    diag.expectClean();
  });

  test("FACE-UI-008 a disabled detector never reports zero faces", async ({ page, diag }) => {
    // The event detail panel must be absent when the API says disabled.
    const eventId = await realEventId(page);
    if (eventId) {
      await page.route(
        (url) => url.pathname === `/api/events/${eventId}/faces`,
        async (route: Route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ enabled: false, eventId, status: "NONE", faces: [] }),
          });
        },
      );
      await page.goto(`/events/${eventId}`);
      // The event detail page itself renders normally...
      await expect(page.getByRole("link", { name: "Back to events" })).toBeVisible();
      // ...with no trace of a face section, and no "0 faces" claim.
      await expect(page.getByRole("region", { name: "Detected faces" })).toHaveCount(0);
      await expect(page.getByText(/faces detected/)).toHaveCount(0);
      await expect(page.getByText("Face Detection")).toHaveCount(0);
    }

    // The gallery explains the disabled state and shows no counters at all.
    await page.goto(ROUTES.faces);
    await expect(page.getByText("Face detection is disabled.")).toBeVisible();
    await expect(page.getByText(/0 detected faces/)).toHaveCount(0);
    await expect(page.getByText(/faces detected/)).toHaveCount(0);
    await expect(page.getByRole("article")).toHaveCount(0);

    diag.expectClean();
  });
});
