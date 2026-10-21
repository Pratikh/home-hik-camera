import { ADMIN_STATE, hasViewerCredentials } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { ROUTES } from "./support/app";

/**
 * ACCOUNT — self-service password change and session management.
 *
 * The success path is exercised at the API/store layer in
 * `src/app/api/auth/password-lifecycle.test.ts`, because changing the shared QA
 * administrator's password would break every later spec. This suite verifies
 * the real page, its session list, and the safe failure path.
 */
test.describe("ACCOUNT - password lifecycle", () => {
  test.use({ storageState: ADMIN_STATE });

  test("ACCT-001 the account page loads with the password form and current session", async ({ page, diag }) => {
    await page.goto(ROUTES.account);
    await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
    await expect(page.getByLabel("Current password")).toBeVisible();
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Confirm new password")).toBeVisible();
    await expect(page.getByText(/Signed-in sessions/)).toBeVisible();
    await expect(page.getByText("This device")).toBeVisible();
    // The page never renders a session token.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/cctv_session|Bearer\s/);
    diag.expectClean();
  });

  test("ACCT-002 a wrong current password is rejected without signing the user out", async ({ page, qa, diag }) => {
    const credentials = qa.credentials("admin");
    await page.goto(ROUTES.account);
    await page.getByLabel("Current password").fill(`${credentials.password}-not-the-password`);
    await page.getByLabel("New password", { exact: true }).fill("a-new-password-123");
    await page.getByLabel("Confirm new password").fill("a-new-password-123");
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page.getByRole("alert").filter({ hasText: /Current password is incorrect/i })).toBeVisible();
    await expect(page).toHaveURL(/\/account/);
    // The session is still valid: a 401 would have redirected to /login.
    const session = await page.request.get("/api/auth/session");
    expect(session.status()).toBe(200);

    diag.expectClean({ allowStatuses: [400] });
  });

  test("ACCT-003 mismatched new passwords are caught before a request", async ({ page, qa, diag }) => {
    const credentials = qa.credentials("admin");
    let passwordPosts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/auth/password") passwordPosts += 1;
    });

    await page.goto(ROUTES.account);
    await page.getByLabel("Current password").fill(credentials.password);
    await page.getByLabel("New password", { exact: true }).fill("a-new-password-123");
    await page.getByLabel("Confirm new password").fill("a-different-password-123");
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page.getByRole("alert").filter({ hasText: /do not match/i })).toBeVisible();
    expect(passwordPosts, "no API call is made for a local validation failure").toBe(0);

    diag.expectClean();
  });
});

test.describe("ACCOUNT - VIEWER", () => {
  test.skip(!hasViewerCredentials(), "QA_VIEWER_USERNAME / QA_VIEWER_PASSWORD are not configured");

  test("ACCT-004 a VIEWER can reach their own account page", async ({ page, qa, diag }) => {
    await qa.login(page, "viewer");
    await page.goto(ROUTES.account);
    await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
    await expect(page.getByLabel("Current password")).toBeVisible();

    // The page is self-service only: it does not expose admin user management.
    const users = await page.request.get("/api/users");
    expect(users.status()).toBe(403);

    diag.expectClean({ allowStatuses: [403] });
  });
});
