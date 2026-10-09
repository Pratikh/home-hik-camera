import { hasViewerCredentials } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { ADMIN_ONLY_API, PROTECTED_API, PROTECTED_PAGES, PUBLIC_API, ROUTES } from "./support/app";
import { containsSecret, redact } from "./support/redact";

/**
 * SEC — security requirements.
 *
 * Non-destructive: no brute force, no account changes, no session tampering.
 */
test.describe("SEC - security", () => {
  test("SEC-001 the password never appears in the URL", async ({ page, qa, diag }) => {
    await qa.login(page, "admin");
    qa.assertUrlHasNoCredential(page, "URL after login");

    for (const route of [ROUTES.dashboard, ROUTES.playback, ROUTES.events, ROUTES.settings, ROUTES.auditLog]) {
      await page.goto(route);
      qa.assertUrlHasNoCredential(page, `URL at ${route}`);
    }

    expect(await page.evaluate(() => location.search)).not.toMatch(/password|passwd|pwd|username=/i);
    diag.expectNoSecretInConsole();
    diag.expectClean();
  });

  test("SEC-002 the password never appears in visible page content", async ({ page, qa, diag }) => {
    await qa.login(page, "admin");

    for (const route of [ROUTES.dashboard, ROUTES.settings, ROUTES.auditLog]) {
      await page.goto(route);
      const body = (await page.locator("body").innerText()) ?? "";
      expect(containsSecret(body), `no credential may be rendered at ${route}: ${redact(route)}`).toBe(false);
    }

    // The DVR password is masked, never shown.
    await page.goto(ROUTES.settings);
    await expect(page.getByText("********", { exact: true })).toBeVisible();

    diag.expectClean();
  });

  test("SEC-003 unauthenticated users cannot access protected pages", async ({ qa }) => {
    const context = await qa.freshContext();
    try {
      for (const route of PROTECTED_PAGES) {
        const response = await context.request.get(route, { maxRedirects: 0 });
        expect(response.status(), `GET ${route} without a session`).toBe(307);
        const location = response.headers()["location"] ?? "";
        expect(location.startsWith(ROUTES.login), `GET ${route} must redirect to the login page`).toBe(true);
        expect(location).not.toMatch(/password|passwd|pwd=/i);
      }
    } finally {
      await context.close();
    }
  });

  test("SEC-004 a VIEWER cannot access ADMIN routes", async ({ page, qa, diag }) => {
    test.skip(!hasViewerCredentials(), "QA_VIEWER_USERNAME / QA_VIEWER_PASSWORD are not configured");

    await qa.login(page, "viewer");
    for (const route of [ROUTES.users, ROUTES.notificationRules, ROUTES.system, ROUTES.auditLog, ROUTES.settings]) {
      await page.goto(route);
      expect(new URL(page.url()).pathname, `VIEWER must be redirected away from ${route}`).toBe(ROUTES.dashboard);
    }
    for (const endpoint of ADMIN_ONLY_API) {
      const response = await page.request.get(endpoint);
      expect(response.status(), `GET ${endpoint} as VIEWER`).toBe(403);
    }

    diag.expectClean({ allowStatuses: [403] });
  });

  test("SEC-005 logout invalidates the session", async ({ page, qa, diag }) => {
    await qa.login(page, "admin");
    await qa.expectAuthenticated(page, "admin");
    await qa.logout(page);

    const session = await page.request.get("/api/auth/session");
    expect(session.status(), "the server-side session row must be revoked").toBe(401);

    diag.expectClean({ allowStatuses: [401] });
  });

  test("SEC-006 refreshing after logout does not restore access", async ({ page, qa, diag }) => {
    await qa.login(page, "admin");
    await page.goto(ROUTES.playback);
    await qa.logout(page);

    await page.goto(ROUTES.playback);
    await expect(page).toHaveURL(/\/login/);

    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    expect(new URL(page.url()).pathname).toBe(ROUTES.login);

    const session = await page.request.get("/api/auth/session");
    expect(session.status()).toBe(401);

    diag.expectClean({ allowStatuses: [401] });
  });

  test("SEC-007 protected API endpoints enforce authentication", async ({ qa }) => {
    const context = await qa.freshContext();
    try {
      for (const endpoint of PROTECTED_API) {
        const response = await context.request.get(endpoint, { maxRedirects: 0 });
        expect(response.status(), `GET ${endpoint} without a session`).toBe(401);
        const body = await response.text();
        expect(body).not.toMatch(/password|secret/i);
      }
      for (const endpoint of PUBLIC_API) {
        const response = await context.request.get(endpoint, { maxRedirects: 0 });
        expect(response.status(), `GET ${endpoint} is intentionally public`).toBe(200);
      }
    } finally {
      await context.close();
    }
  });

  test("SEC-008 credentials do not appear in console logs", async ({ page, qa, diag }) => {
    await qa.login(page, "admin");
    await page.goto(ROUTES.dashboard);
    await page.waitForTimeout(1000);

    const credentials = qa.credentials("admin");
    for (const message of diag.snapshot().consoleErrors) {
      expect(message.includes(credentials.password), "a console message must not contain the password").toBe(
        false,
      );
    }
    diag.expectNoSecretInConsole();

    diag.expectClean();
  });
});
