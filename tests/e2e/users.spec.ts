import { ADMIN_STATE, hasViewerCredentials } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { ROUTES } from "./support/app";

/**
 * USER — users and roles.
 *
 * The Users route is `/settings/users` (discovered from `src/app`, not assumed).
 * ADMIN tests are non-destructive: no user is created, changed or deleted. The
 * VIEWER tests sign in with credentials supplied through `QA_VIEWER_*`; when
 * those are not configured they report themselves as skipped rather than
 * creating a user in the production database.
 */
type UserRow = { id: string; username: string; role: string; enabled: boolean };

test.describe("USER - ADMIN", () => {
  test.use({ storageState: ADMIN_STATE });

  test("USER-001 an ADMIN can access user management", async ({ page, diag }) => {
    await page.goto(ROUTES.users);
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(ROUTES.users);
    diag.expectClean();
  });

  test("USER-002 an ADMIN can see the existing users", async ({ page, diag }) => {
    await page.goto(ROUTES.users);
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();

    const response = await page.request.get("/api/users");
    expect(response.status(), "GET /api/users as ADMIN").toBe(200);
    const body = (await response.json()) as { users: UserRow[] };
    expect(body.users.length, "at least the bootstrap administrator exists").toBeGreaterThan(0);

    const list = page.locator("ul").first();
    for (const user of body.users) {
      await expect(list.getByText(user.username, { exact: true })).toBeVisible();
    }
    // Both roles are real and rendered.
    await expect(list).toContainText(/ADMIN|VIEWER/);

    diag.expectClean();
  });

  test("USER-003 the implemented user-management controls are usable without mutating data", async ({
    page,
    diag,
  }) => {
    await page.goto(ROUTES.users);
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();

    // The create form is implemented.
    await expect(page.getByRole("heading", { name: "Create user" })).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByLabel("Role")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create user" })).toBeVisible();

    const deletions: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "DELETE" && request.url().includes("/api/users/")) deletions.push(request.url());
    });

    // Destructive actions are confirmed, and cancelling performs no request.
    const lastRow = page.locator("ul > li").last();
    await lastRow.getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("cannot be undone");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    expect(deletions, "cancelling the confirmation must not delete a user").toEqual([]);

    diag.expectClean();
  });
});

test.describe("USER - VIEWER", () => {
  test.skip(!hasViewerCredentials(), "QA_VIEWER_USERNAME / QA_VIEWER_PASSWORD are not configured");

  test("USER-004 a VIEWER can sign in", async ({ page, qa, diag }) => {
    const submissions = await qa.login(page, "viewer");
    expect(submissions, "POSTs to /api/auth/login for a single click").toBe(1);
    await qa.expectAuthenticated(page, "viewer");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    diag.expectClean();
  });

  test("USER-005 a VIEWER can use the permitted live view", async ({ page, qa, diag }) => {
    await qa.login(page, "viewer");
    await page.goto(ROUTES.dashboard);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.locator("article").first()).toBeVisible();

    const navigation = page.getByRole("navigation", { name: "Primary" }).first();
    await expect(navigation.getByRole("link", { name: "Playback" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Settings" })).toHaveCount(0);

    diag.expectClean();
  });

  test("USER-006 a VIEWER can use the permitted playback page", async ({ page, qa, diag }) => {
    await qa.login(page, "viewer");
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("heading", { level: 1, name: "CCTV Playback" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(ROUTES.playback);
    diag.expectClean();
  });

  test("USER-007 a VIEWER cannot access user management", async ({ page, qa, diag }) => {
    await qa.login(page, "viewer");
    await page.goto(ROUTES.users);
    await expect(page).toHaveURL(new RegExp(`${ROUTES.dashboard}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toHaveCount(0);

    const api = await page.request.get("/api/users");
    expect(api.status(), "GET /api/users as VIEWER").toBe(403);

    diag.expectClean({ allowStatuses: [403] });
  });

  test("USER-008 a VIEWER cannot access notification rule management", async ({ page, qa, diag }) => {
    await qa.login(page, "viewer");
    await page.goto(ROUTES.notificationRules);
    await expect(page).toHaveURL(new RegExp(`${ROUTES.dashboard}$`));

    const api = await page.request.get("/api/notification-rules");
    expect(api.status(), "GET /api/notification-rules as VIEWER").toBe(403);

    diag.expectClean({ allowStatuses: [403] });
  });

  test("USER-009 a VIEWER cannot access admin-only system functionality", async ({ page, qa, diag }) => {
    await qa.login(page, "viewer");
    await page.goto(ROUTES.system);
    await expect(page).toHaveURL(new RegExp(`${ROUTES.dashboard}$`));

    for (const endpoint of ["/api/system/sessions", "/api/audit", "/api/settings"]) {
      const api = await page.request.get(endpoint);
      expect(api.status(), `GET ${endpoint} as VIEWER`).toBe(403);
    }

    diag.expectClean({ allowStatuses: [403] });
  });
});
