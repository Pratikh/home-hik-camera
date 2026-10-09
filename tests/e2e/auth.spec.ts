import { test, expect, createDiagnostics } from "./support/fixtures";
import { ROUTES } from "./support/app";

/**
 * AUTH — authentication.
 *
 * All of these run in the default, freshly created (unauthenticated) browser
 * context, except AUTH-002/AUTH-008/AUTH-009 which deliberately create an extra
 * isolated context of their own.
 *
 * No test prints a credential. Failures show redacted URLs only.
 */
test.describe("AUTH - authentication", () => {
  test.afterEach(async ({ diag }) => {
    diag.expectNoSecretInConsole();
  });

  test("AUTH-001 fresh context: one click signs an ADMIN in", async ({ page, qa, diag }) => {
    const submissions = await qa.login(page, "admin");

    // The suspected regression submitted twice (or once natively, then again).
    expect(submissions, "POSTs to /api/auth/login for a single click").toBe(1);

    await qa.expectAuthenticated(page, "admin");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    qa.assertUrlHasNoCredential(page, "URL after a successful login");

    diag.expectClean();
  });

  test("AUTH-002 an isolated fresh context also signs in with one click", async ({ qa }) => {
    const context = await qa.freshContext();
    const page = await context.newPage();
    const diagnostics = createDiagnostics(page);
    try {
      const submissions = await qa.login(page, "admin");
      expect(submissions, "POSTs to /api/auth/login for a single click").toBe(1);
      await qa.expectAuthenticated(page, "admin");
      qa.assertUrlHasNoCredential(page, "URL in the isolated context");
      diagnostics.expectClean();
    } finally {
      await context.close();
    }
  });

  test("AUTH-003 the password never appears in the URL", async ({ page, qa, diag }) => {
    await qa.login(page, "admin");
    qa.assertUrlHasNoCredential(page, "URL after login");

    for (const route of [ROUTES.playback, ROUTES.events, ROUTES.settings, ROUTES.users]) {
      await page.goto(route);
      qa.assertUrlHasNoCredential(page, `URL at ${route}`);
      expect(new URL(page.url()).search).not.toMatch(/password|passwd|pwd|username=/i);
    }

    diag.expectClean();
  });

  test("AUTH-004 a wrong password fails, keeps the session unauthenticated and stays out of the URL", async ({
    page,
    qa,
    diag,
  }) => {
    const credentials = qa.credentials("admin");
    await page.goto(ROUTES.login);
    await page.getByLabel("Username", { exact: true }).fill(credentials.username);
    await page.getByLabel("Password", { exact: true }).fill(`${credentials.password}qa-wrong`);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert").filter({ hasText: /Authentication failed/i })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    qa.assertUrlHasNoCredential(page, "URL after a rejected login");

    const session = await page.request.get("/api/auth/session");
    expect(session.status(), "session endpoint without a valid login").toBe(401);

    await page.goto(ROUTES.dashboard);
    await expect(page).toHaveURL(/\/login/);

    diag.expectClean({ allowStatuses: [401] });
  });

  test("AUTH-005 logout invalidates the session", async ({ page, qa, diag }) => {
    await qa.login(page, "admin");
    await qa.expectAuthenticated(page, "admin");

    await qa.logout(page);
    await expect(page).toHaveURL(/\/login/);

    const session = await page.request.get("/api/auth/session");
    expect(session.status(), "session endpoint after logout").toBe(401);

    await page.goto(ROUTES.playback);
    await expect(page).toHaveURL(/\/login/);

    diag.expectClean({ allowStatuses: [401] });
  });

  test("AUTH-006 login, logout, then login again", async ({ page, qa, diag }) => {
    await qa.login(page, "admin");
    await qa.logout(page);
    await expect(page).toHaveURL(/\/login/);

    const submissions = await qa.login(page, "admin");
    expect(submissions, "POSTs to /api/auth/login on the second login").toBe(1);
    await qa.expectAuthenticated(page, "admin");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

    diag.expectClean({ allowStatuses: [401] });
  });

  test("AUTH-007 refreshing a protected page keeps the session valid", async ({ page, qa, diag }) => {
    await qa.login(page, "admin");
    await page.goto(ROUTES.playback);
    await expect(page.getByRole("heading", { level: 1, name: "CCTV Playback" })).toBeVisible();

    await page.reload();

    await expect(page).toHaveURL(/\/playback/);
    await expect(page.getByRole("heading", { level: 1, name: "CCTV Playback" })).toBeVisible();
    await qa.expectAuthenticated(page, "admin");

    diag.expectClean();
  });

  test("AUTH-008 an unauthenticated context is redirected from every protected page", async ({ qa }) => {
    const context = await qa.freshContext();
    const page = await context.newPage();
    const diagnostics = createDiagnostics(page);
    try {
      for (const route of [ROUTES.dashboard, ROUTES.playback, ROUTES.users]) {
        await page.goto(route);
        await expect(page, `route ${route} must redirect to the login page`).toHaveURL(/\/login/);
        expect(new URL(page.url()).pathname).toBe(ROUTES.login);
        qa.assertUrlHasNoCredential(page, `redirect URL for ${route}`);
      }
      diagnostics.expectClean();
    } finally {
      await context.close();
    }
  });

  /**
   * AUTH-009 — the cold-start regression.
   *
   * Reported symptom: in a fresh Incognito window, one click on Login failed and
   * the URL became `/login?username=…&password=…`; a second click then worked.
   *
   * JavaScript is disabled here on purpose. That reproduces the pre-hydration
   * window deterministically: the browser performs the form's *native*
   * submission with no React handler attached, exactly as it did before React
   * hydrated in the report. If the form is not a POST to the login endpoint, this
   * test fails on the first click and the password lands in the URL.
   */
  test("AUTH-009 REGRESSION cold un-hydrated submit signs in on the first click", async ({ qa }) => {
    const context = await qa.freshContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto(ROUTES.login);

      const form = page.locator("form");
      await expect(form, "the login form must declare a POST method").toHaveAttribute("method", /post/i);
      await expect(form, "the login form must post to the login endpoint").toHaveAttribute(
        "action",
        "/api/auth/login",
      );

      const credentials = qa.credentials("admin");
      await page.getByLabel("Username", { exact: true }).fill(credentials.username);
      await page.getByLabel("Password", { exact: true }).fill(credentials.password);

      const submissions: string[] = [];
      page.on("request", (request) => {
        if (request.method() !== "POST") return;
        try {
          if (new URL(request.url()).pathname === "/api/auth/login") submissions.push("post");
        } catch {
          /* ignore */
        }
      });

      // Exactly one click.
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL((url) => !url.pathname.startsWith(ROUTES.login), { timeout: 20_000 });

      expect(submissions.length, "native submissions to /api/auth/login").toBe(1);
      qa.assertUrlHasNoCredential(page, "URL after the native submit");
      expect(new URL(page.url()).search, "no query string may carry the credentials").not.toMatch(
        /password|passwd|pwd|username=/i,
      );
      // Signed in without JavaScript: the server rendered the dashboard.
      await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
